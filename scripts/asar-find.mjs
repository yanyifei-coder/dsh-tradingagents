/** 在 asar 索引里列出指定包的 lib 文件（>500 bytes）。用法：node scripts/asar-find.mjs <pkg-name> */
import fs from 'node:fs'

const pkg = process.argv[2]
const header = JSON.parse(fs.readFileSync('asar-index.json', 'utf8'))
const base = header.files.dsh.files.node_modules.files['@deepseek-ai'].files[pkg]
if (base === undefined) {
  console.log(`not found: ${pkg}`)
  process.exit(0)
}
const walk = (node, prefix) => {
  for (const [key, value] of Object.entries(node.files ?? {})) {
    if (value.files !== undefined) {
      walk(value, `${prefix}/${key}`)
    } else if (value.size > 500) {
      console.log(`${prefix}/${key} (${String(value.size)})`)
    }
  }
}
walk(base, `dsh/node_modules/@deepseek-ai/${pkg}`)
