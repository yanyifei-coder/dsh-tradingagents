/** 技术指标纯函数单测（node:test 零依赖；落地 DSH 仓库后可迁移到仓库测试栈）。 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { macd, rsi, sma } from '../src/tools/indicators.ts'

describe('sma', () => {
  it('计算末端窗口均值', () => {
    assert.equal(sma([1, 2, 3, 4], 2), 3.5)
  })

  it('样本不足窗口返回 null', () => {
    assert.equal(sma([1], 2), null)
  })

  it('非法窗口抛错', () => {
    assert.throws(() => sma([1, 2], 0))
    assert.throws(() => sma([1, 2], 1.5))
  })
})

describe('rsi', () => {
  it('样本不足周期返回 null', () => {
    assert.equal(rsi([1, 2, 3], 14), null)
  })

  it('单边上涨收敛到 100', () => {
    const rising = Array.from({ length: 20 }, (_, i) => i + 1)
    assert.equal(rsi(rising, 14), 100)
  })

  it('单边下跌收敛到 0', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 20 - i)
    assert.equal(rsi(falling, 14), 0)
  })

  it('非法周期抛错', () => {
    assert.throws(() => rsi([1, 2, 3], 0))
  })
})

describe('macd', () => {
  it('样本不足返回 null', () => {
    assert.equal(macd([1, 2, 3], 12, 26, 9), null)
  })

  it('单边上涨序列 DIF 为正', () => {
    const rising = Array.from({ length: 60 }, (_, i) => 10 + i)
    const result = macd(rising)
    assert.ok(result !== null)
    assert.ok(result.macd > 0)
  })

  it('非整数参数抛错', () => {
    assert.throws(() => macd(Array.from({ length: 60 }, (_, i) => i), 12.5, 26, 9))
  })
})
