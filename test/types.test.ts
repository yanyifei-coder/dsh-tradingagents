/** 领域类型与区域映射单测。 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { regionOfTicker, toAnalystKind } from '../src/types.ts'

describe('toAnalystKind', () => {
  it('接受四种已知类型', () => {
    for (const kind of ['market', 'news', 'sentiment', 'fundamentals']) {
      assert.equal(toAnalystKind(kind), kind)
    }
  })

  it('拒绝未知类型', () => {
    assert.throws(() => toAnalystKind('quant'))
  })
})

describe('regionOfTicker', () => {
  it('按交易所后缀映射区域', () => {
    assert.equal(regionOfTicker('NVDA'), 'US')
    assert.equal(regionOfTicker('0700.HK'), 'HK')
    assert.equal(regionOfTicker('7203.T'), 'JP')
    assert.equal(regionOfTicker('600519.SS'), 'CN')
    assert.equal(regionOfTicker('600519.SZ'), 'CN')
    assert.equal(regionOfTicker('AZN.L'), 'OTHER')
    assert.equal(regionOfTicker('BTC-USD'), 'US')
  })
})
