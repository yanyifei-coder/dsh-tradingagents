/**
 * Branded id 与输入校验。
 *
 * 落地时：`Brand` 改用 `dsh-brand` 的 `Branded<B>`（对照仓库内真实包名），删除本地实现。
 * 所有构造函数 fail loud：非法输入在解析层即拒绝，不流入运行时。
 */

declare const brandSymbol: unique symbol

export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B }

/** 一次完整分析的运行 id。 */
export type RunId = Brand<string, 'RunId'>

/** 归一化后的 Yahoo Finance 代码（含交易所后缀，如 `0700.HK`、`^GSPC`、`BTC-USD`）。 */
export type TickerSymbol = Brand<string, 'TickerSymbol'>

/** `YYYY-MM-DD` 的分析日期（真实日期，非未来）。 */
export type AnalysisDate = Brand<string, 'AnalysisDate'>

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/
const TICKER_RE = /^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 校验并构造 RunId；非法输入抛错。 */
export function toRunId(value: string): RunId {
  if (!RUN_ID_RE.test(value)) {
    throw new Error(`非法 runId：“${value}”（期望 [a-z0-9-]{8,64}）`)
  }
  return value as RunId
}

/** 生成新的 RunId。 */
export function newRunId(): RunId {
  const raw = `run-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  return toRunId(raw)
}

/** 校验并构造 TickerSymbol；输入先大写归一化。 */
export function toTickerSymbol(value: string): TickerSymbol {
  const normalized = value.trim().toUpperCase()
  if (!TICKER_RE.test(normalized)) {
    throw new Error(`非法 ticker：“${value}”（期望 Yahoo Finance 代码，如 NVDA、0700.HK、600519.SS）`)
  }
  return normalized as TickerSymbol
}

/** 校验并构造 AnalysisDate；拒绝非真实日期（如 02-31）与未来日期。 */
export function toAnalysisDate(value: string): AnalysisDate {
  if (!DATE_RE.test(value)) {
    throw new Error(`非法分析日期：“${value}”（期望 YYYY-MM-DD）`)
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`非法分析日期：“${value}”（不是真实日历日期）`)
  }
  return value as AnalysisDate
}

/** 当前 UTC 日期（`YYYY-MM-DD`）。 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
