/** 极简 asar 提取器：dump 索引 / 按归档内路径抽取文件。用法：
 *   node scripts/asar.mjs <archive> --index <out.json>
 *   node scripts/asar.mjs <archive> --extract <in-archive-path> [<more>...]
 */
import fs from 'node:fs'
import path from 'node:path'

const [archive, mode, ...targets] = process.argv.slice(2)
if (archive === undefined || !mode) {
  console.error('usage: node scripts/asar.mjs <archive> --index <out.json> | --extract <path>...')
  process.exit(1)
}

const fd = fs.openSync(archive, 'r')
const sizeBuf = Buffer.alloc(8)
fs.readSync(fd, sizeBuf, 0, 8, 0)
if (sizeBuf.readUInt32LE(0) !== 4) {
  throw new Error('不是合法的 asar 归档（pickle 头不符）')
}
const headerSize = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 8)
const jsonLen = headerBuf.readUInt32LE(0)
let jsonStart = 4
let json = ''
try {
  json = headerBuf.slice(jsonStart, jsonStart + jsonLen).toString('utf8')
  JSON.parse(json)
} catch {
  // 某些 asar 变体在 pickle 头后还有一层长度字段：再试 8 字节起点
  jsonStart = 8
  json = headerBuf.slice(jsonStart, jsonStart + jsonLen).toString('utf8')
}
const header = JSON.parse(json)
const dataStart = 8 + headerSize

function nodeAt(inArchivePath) {
  const parts = inArchivePath.split('/').filter(part => part !== '')
  let node = header
  for (const part of parts) {
    if (node.files === undefined) {
      return undefined
    }
    node = node.files[part]
    if (node === undefined) {
      return undefined
    }
  }
  return node
}

if (mode === '--index') {
  fs.writeFileSync(targets[0] ?? 'asar-index.json', JSON.stringify(header, null, 1))
  console.log(`index dumped: ${String(headerSize)} bytes header`)
} else if (mode === '--extract') {
  for (const target of targets) {
    const node = nodeAt(target)
    if (node === undefined || node.files !== undefined) {
      console.log(`SKIP  ${target}（不存在或是目录）`)
      continue
    }
    const buf = Buffer.alloc(node.size)
    fs.readSync(fd, buf, 0, node.size, dataStart + Number(node.offset))
    const out = path.basename(target)
    fs.writeFileSync(out, buf)
    console.log(`OK    ${out}（${String(node.size)} bytes）`)
  }
} else {
  throw new Error(`未知模式：${mode}`)
}
