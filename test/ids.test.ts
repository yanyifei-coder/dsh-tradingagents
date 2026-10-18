/** branded id 校验单测。 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { newRunId, toAnalysisDate, toRunId, toTickerSymbol } from '../src/ids.ts'

describe('toTickerSymbol', () => {
  it('归一化为大写', () => {
    assert.equal(toTickerSymbol('nvda'), 'NVDA')
    assert.equal(toTickerSymbol('0700.hk'), '0700.HK')
    assert.equal(toTickerSymbol('^gspc'), '^GSPC')
    assert.equal(toTickerSymbol('brk-b'), 'BRK-B')
  })

  it('拒绝空值与非法字符', () => {
    assert.throws(() => toTickerSymbol(''))
    assert.throws(() => toTickerSymbol('NVDA?'))
  })
})

describe('toAnalysisDate', () => {
  it('接受真实日期', () => {
    assert.equal(toAnalysisDate('2026-09-23'), '2026-09-23')
  })

  it('拒绝格式错误与不存在的日期', () => {
    assert.throws(() => toAnalysisDate('2026-9-23'))
    assert.throws(() => toAnalysisDate('2026-02-31'))
  })
})

describe('runId', () => {
  it('newRunId 生成合法 id', () => {
    const id = newRunId()
    assert.ok(id.startsWith('run-'))
    assert.equal(id.length, 16)
    assert.equal(toRunId(id), id)
  })

  it('toRunId 拒绝非法值', () => {
    assert.throws(() => toRunId('x'))
  })
})
