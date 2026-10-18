/** 记忆纯函数单测（parse/build；IO 路径需要 fs stub，落地后接真实存储再补）。 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildMemoryInjection, parseDecisions } from '../src/memory.ts'
import type { MemoryRecord } from '../src/types.ts'

const record: MemoryRecord = {
  runId: 'run-abc123',
  ticker: 'NVDA',
  date: '2026-09-23',
  action: 'BUY',
  confidence: 0.62,
  entryRefPrice: 150,
  evaluation: { evaluated: true, rawReturn: 0.05, alphaVsBenchmark: 0.02 },
  reflection: '动量信号有效，但应更早设置止损。',
}

describe('parseDecisions', () => {
  it('空内容得到空记录', () => {
    assert.deepEqual(parseDecisions(''), { records: [], malformed: 0 })
  })

  it('跳过坏行并计数', () => {
    const content = `${JSON.stringify(record)}\nnot-json\n\n`
    const parsed = parseDecisions(content)
    assert.equal(parsed.records.length, 1)
    assert.equal(parsed.malformed, 1)
  })
})

describe('buildMemoryInjection', () => {
  it('无历史给出首次运行说明', () => {
    assert.match(buildMemoryInjection([]), /No prior decisions/)
  })

  it('包含决策结果与反思', () => {
    const text = buildMemoryInjection([record])
    assert.match(text, /2026-09-23 BUY/)
    assert.match(text, /\+5\.0%/)
    assert.match(text, /alpha vs benchmark 2\.0%/)
    assert.match(text, /Reflection:/)
  })
})
