/**
 * 技术指标纯函数（无 IO，单测直接覆盖）。
 * 数值约定：输入不足窗口长度返回 null，不抛错；非法窗口抛错。
 */

export interface Bar {
  readonly date: string
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}

/** 简单移动平均（取序列末端值）。 */
export function sma(values: readonly number[], window: number): number | null {
  if (!Number.isInteger(window) || window <= 0) {
    throw new Error(`非法 SMA 窗口：${window}`)
  }
  if (values.length < window) {
    return null
  }
  let sum = 0
  for (let i = values.length - window; i < values.length; i += 1) {
    const value = values[i]
    if (value === undefined) {
      return null
    }
    sum += value
  }
  return sum / window
}

/** RSI（Wilder 平滑），取序列末端值。 */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(`非法 RSI 周期：${period}`)
  }
  if (closes.length <= period) {
    return null
  }
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i += 1) {
    const prev = closes[i - 1]
    const curr = closes[i]
    if (prev === undefined || curr === undefined) {
      return null
    }
    const diff = curr - prev
    avgGain += Math.max(diff, 0)
    avgLoss += Math.max(-diff, 0)
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period + 1; i < closes.length; i += 1) {
    const prev = closes[i - 1]
    const curr = closes[i]
    if (prev === undefined || curr === undefined) {
      return null
    }
    const diff = curr - prev
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100
  }
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function emaSeries(values: readonly number[], period: number): readonly number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev: number | undefined
  for (const value of values) {
    prev = prev === undefined ? value : value * k + prev * (1 - k)
    if (prev !== undefined) {
      out.push(prev)
    }
  }
  return out
}

export interface MacdResult {
  readonly macd: number
  readonly signal: number
  readonly histogram: number
}

/** MACD(12,26,9)：DIF=EMA12-EMA26，DEA=EMA(DIF,9)，柱=DIF-DEA。 */
export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult | null {
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || !Number.isInteger(signalPeriod)) {
    throw new Error('MACD 参数必须是整数')
  }
  if (closes.length < slow + signalPeriod) {
    return null
  }
  const emaFast = emaSeries(closes, fast)
  const emaSlow = emaSeries(closes, slow)
  const offset = emaSlow.length - emaFast.length
  if (offset < 0) {
    return null
  }
  const dif: number[] = []
  for (let i = 0; i < emaFast.length; i += 1) {
    const f = emaFast[i]
    const s = emaSlow[i + offset]
    if (f === undefined || s === undefined) {
      return null
    }
    dif.push(f - s)
  }
  const dea = emaSeries(dif, signalPeriod)
  const lastDif = dif[dif.length - 1]
  const lastDea = dea[dea.length - 1]
  if (lastDif === undefined || lastDea === undefined) {
    return null
  }
  return { macd: lastDif, signal: lastDea, histogram: lastDif - lastDea }
}
