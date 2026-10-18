/**
 * 记忆协议：decisions.jsonl 的读写与注入文本构建。
 * 文件追加用“读全文 + 重写”实现（规模为每次 run 一行，无并发写者：
 * 只有编排器在 memory 阶段追加），不做通用存储抽象。
 */
import type { DshFs, FsTarget } from './dsh-types.ts'
import type { MemoryRecord } from './types.ts'
import { toTickerSymbol } from './ids.ts'

/** 记忆文件路径（相对 dataDir）。 */
export const MEMORY_FILE = 'memory/decisions.jsonl'

function memoryPath(dataDir: string): string {
  return `${dataDir}/${MEMORY_FILE}`
}

/** 解析 jsonl；跳过坏行并计数（不静默吞掉：坏行数计入返回值）。 */
export function parseDecisions(content: string): { readonly records: MemoryRecord[]; readonly malformed: number } {
  const records: MemoryRecord[] = []
  let malformed = 0
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    try {
      records.push(JSON.parse(trimmed) as MemoryRecord)
    } catch (error) {
      // 坏行只计数并跳过：记忆是辅助输入，单行损坏不应终止一次分析。
      malformed += 1
      console.warn(`decisions.jsonl 存在坏行（已跳过）：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { records, malformed }
}

/** 读取指定 ticker 的最近 N 条已评估/未评估决策（时间顺序，末尾最新）。 */
export async function loadRecentDecisions(
  fs: DshFs,
  dataDir: string,
  ticker: string,
  maxInject: number,
): Promise<readonly MemoryRecord[]> {
  if (maxInject <= 0) {
    return []
  }
  let target: FsTarget
  try {
    target = await fs.resolve(memoryPath(dataDir))
  } catch {
    // 首次运行无记忆文件：返回空，不是错误。
    return []
  }
  let content: string
  try {
    content = await fs.readText(target)
  } catch {
    return []
  }
  const { records } = parseDecisions(content)
  return records.filter(record => record.ticker === ticker).slice(-maxInject)
}

/** 组装注入文本（给 trader 与 portfolio-manager 的提示词附件）。 */
export function buildMemoryInjection(decisions: readonly MemoryRecord[]): string {
  if (decisions.length === 0) {
    return '(No prior decisions recorded for this ticker. This is a first run.)'
  }
  const lines = decisions.map(record => {
    const outcome = record.evaluation.evaluated
      ? `realized raw return ${(record.evaluation.rawReturn ?? 0) * 100 >= 0 ? '+' : ''}${((record.evaluation.rawReturn ?? 0) * 100).toFixed(1)}%` +
        (record.evaluation.alphaVsBenchmark === null
          ? ''
          : `, alpha vs benchmark ${(record.evaluation.alphaVsBenchmark * 100).toFixed(1)}%`)
      : 'not yet evaluated'
    return `- ${record.date} ${record.action} (confidence ${record.confidence.toFixed(2)}): ${outcome}. Reflection: ${record.reflection}`
  })
  return `Recent decisions for this ticker (oldest first), with realized outcomes and reflections:\n${lines.join('\n')}`
}

/** 追加一条记忆（读改写 jsonl）。 */
export async function appendDecision(fs: DshFs, dataDir: string, record: MemoryRecord): Promise<void> {
  const path = memoryPath(dataDir)
  let existing = ''
  try {
    existing = await fs.readText(await fs.resolve(path))
  } catch {
    // 文件不存在：从空内容开始。
  }
  const next = `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}${JSON.stringify(record)}\n`
  await fs.writeText(await fs.resolve(path), next)
}
