/** 腾讯行情源纯函数单测：代码转换 + 响应解析（fixture 来自 2026-10-02 实测响应）。 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseTencentKline, tencentCodes } from '../src/tools/tencent.ts'

describe('tencentCodes', () => {
  it('A 股按后缀与首位推断', () => {
    assert.deepEqual(tencentCodes('600519.SS'), ['sh600519'])
    assert.deepEqual(tencentCodes('000001.SZ'), ['sz000001'])
    assert.deepEqual(tencentCodes('600519'), ['sh600519'])
    assert.deepEqual(tencentCodes('300750'), ['sz300750'])
  })

  it('港股与美股', () => {
    assert.deepEqual(tencentCodes('00700.HK'), ['hk00700'])
    assert.deepEqual(tencentCodes('0700.HK'), ['hk00700', 'hk0700'])
    assert.deepEqual(tencentCodes('NVDA'), ['usNVDA.OQ', 'usNVDA.N'])
  })

  it('已实测的基准指数映射', () => {
    assert.deepEqual(tencentCodes('^HSI'), ['hkHSI'])
    assert.deepEqual(tencentCodes('000001.SS'), ['sh000001'])
    assert.deepEqual(tencentCodes('^GSPC'), ['usINX'])
  })

  it('未映射的指数抛错', () => {
    assert.throws(() => tencentCodes('^N225'))
  })
})

describe('parseTencentKline', () => {
  const payload = {
    code: 0,
    data: {
      sh600519: {
        qfqday: [
          ['2026-09-29', '1244.600', '1235.580', '1245.870', '1230.880', '2636600.00'],
          ['2026-09-30', '1239.530', '1258.620', '1268.000', '1236.050', '3833100.00'],
        ],
      },
    },
  }

  it('解析 [date, open, close, high, low, volume] 顺序并转数值', () => {
    const bars = parseTencentKline(payload, 'sh600519')
    assert.equal(bars.length, 2)
    const last = bars[1]
    assert.ok(last !== undefined)
    assert.equal(last.date, '2026-09-30')
    assert.equal(last.open, 1239.53)
    assert.equal(last.close, 1258.62)
    assert.equal(last.high, 1268.0)
    assert.equal(last.low, 1236.05)
    assert.equal(last.volume, 3833100)
  })

  it('美股节点字段为 day（非 qfqday）', () => {
    const usPayload = {
      code: 0,
      data: { 'usNVDA.OQ': { day: [['2026-09-30', '229.270', '228.380', '232.370', '228.160', '121732188.000']] } },
    }
    const bars = parseTencentKline(usPayload, 'usNVDA.OQ')
    assert.equal(bars.length, 1)
    assert.equal(bars[0]?.close, 228.38)
  })

  it('code 非零 fail loud', () => {
    assert.throws(() => parseTencentKline({ code: 404, data: {} }, 'sh600519'))
  })

  it('缺代码节点 / 无 K 线 fail loud', () => {
    assert.throws(() => parseTencentKline({ code: 0, data: {} }, 'sh600519'))
    assert.throws(() => parseTencentKline({ code: 0, data: { sh600519: { qfqday: [] } } }, 'sh600519'))
  })

  it('畸形行跳过，全畸形 fail loud', () => {
    const bad = {
      code: 0,
      data: {
        sh600519: {
          qfqday: [
            ['not-a-date'],
            ['2026-09-30', '1239.530', '1258.620', '1268.000', '1236.050', '3833100.00'],
          ],
        },
      },
    }
    assert.equal(parseTencentKline(bad, 'sh600519').length, 1)
    assert.throws(() => parseTencentKline({ code: 0, data: { sh600519: { qfqday: [['x']] } } }, 'sh600519'))
  })
})
