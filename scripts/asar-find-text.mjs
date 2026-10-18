/** 在 asar 数据区搜索文本，并定位包含命中的文件节点。用法：
 *   node scripts/asar-find-text.mjs <archive> "text to find"
 * 依赖 asar-index.json（先用 --index 生成）。
 */
import fs from 'node:fs'

const archive = process.argv[2]
const needle = process.argv[3]
if (archive === undefined || needle === undefined) {
  console.error('usage: node scripts/asar-find-text.mjs <archive> "<text>"')
  process.exit(1)
}

const header = JSON.parse(fs.readFileSync('asar-index.json', 'utf8'))
const sizeBuf = Buffer.alloc(8)
{
  const fd = fs.openSync(archive, 'r')
  fs.readSync(fd, sizeBuf, 0, 8, 0)
  fs.closeSync(fd)
}
const headerSize = sizeBuf.readUInt32LE(4)
const dataStart = 8 + headerSize

const files = []
const walk = (node, prefix) => {
  for (const [key, value] of Object.entries(node.files ?? {})) {
    const p = `${prefix}/${key}`
    if (value.files !== undefined) {
      walk(value, p)
    } else {
      files.push({ path: p, start: dataStart + Number(value.offset), end: dataStart + Number(value.offset) + value.size })
    }
  }
}
walk(header, '')

const fd = fs.openSync(archive, 'r')
const size = fs.fstatSync(fd).size
const chunkSize = 8 * 1024 * 1024
const overlap = needle.length - 1
const hits = []
let base = 0
while (base < size) {
  const readLen = Math.min(chunkSize + overlap, size - base)
  const buf = Buffer.alloc(readLen)
  fs.readSync(fd, buf, 0, readLen, base)
  let idx = buf.indexOf(needle, 0, 'utf8')
  while (idx >= 0 && hits.length < 12) {
    const abs = base + idx
    const file = files.find(f => abs >= f.start && abs < f.end)
    hits.push({ abs, file: file?.path ?? '???' })
    idx = buf.indexOf(needle, idx + 1, 'utf8')
  }
  if (base + chunkSize >= size) break
  base += chunkSize
}
for (const hit of hits) {
  console.log(`${String(hit.abs)}: ${hit.file}`)
}
if (hits.length === 0) {
  console.log('no hits')
}
