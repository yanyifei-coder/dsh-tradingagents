/**
 * 腾讯行情源（web.ifzq.gtimg.cn）：A股/港股/美股前复权日线，CN 部署环境实测可达（DESIGN §7.1）。
 *
 * 代码转换规则（已实测）：
 * - `600519.SS` → `sh600519`，`000001.SZ` → `sz000001`，裸 6 位代码按首位推断（6→SH，0/3→SZ）
 * - `00700.HK` → `hk00700`
 * - `NVDA` → `usNVDA.OQ`（纳斯达克），备选 `usNVDA.N`（纽交所）
 * - 基准指数：`^HSI` → `hkHSI`，`000001.SS` → `sh000001`，`^GSPC` → `usINX`（此端点美股指数仅返回最新
 *   1 根，alpha 计算优雅降级为 null）；`^N225` 无映射（alpha null）。
 */
import type { Bar } from './indicators.ts'
import { fetchJson } from './http.ts'

/** 已实测可用的基准指数映射（Yahoo 风格 → 腾讯代码）。 */
const TENCENT_INDEX_CODES: Readonly<Record<string, string>> = {
  '^GSPC': 'usINX',
  '^HSI': 'hkHSI',
  '000001.SS': 'sh000001',
}

/** Config 的 range 枚举 → 请求的交易日根数（近似）。 */
const RANGE_TO_COUNT: Readonly<Record<string, number>> = {
  '1mo': 25,
  '3mo': 70,
  '6mo': 135,
  '1y': 260,
  '2y': 520,
}

/** Yahoo 风格代码 → 腾讯源候选代码（按优先级；美股先 NASDAQ 后 NYSE）。 */
export function tencentCodes(symbol: string): readonly string[] {
  const s = symbol.toUpperCase()
  if (Object.prototype.hasOwnProperty.call(TENCENT_INDEX_CODES, s)) {
    return [TENCENT_INDEX_CODES[s] as string]
  }
  if (s.endsWith('.SS')) {
    return [`sh${s.slice(0, -3)}`]
  }
  if (s.endsWith('.SZ')) {
    return [`sz${s.slice(0, -3)}`]
  }
  if (s.endsWith('.HK')) {
    // 腾讯港股代码为 5 位补零（00700）；Yahoo 风格可能是 4 位（0700.HK）——补零在前，原样在后（相同则去重）。
    const digits = s.slice(0, -3)
    const padded = `hk${digits.padStart(5, '0')}`
    const raw = `hk${digits}`
    return padded === raw ? [padded] : [padded, raw]
  }
  if (s.startsWith('^')) {
    throw new Error(`腾讯行情源无指数代码映射：${symbol}（alpha 将记为 null）`)
  }
  if (/^\d{6}$/.test(s)) {
    return [s.startsWith('6') ? `sh${s}` : `sz${s}`]
  }
  return [`us${s}.OQ`, `us${s}.N`]
}

interface TencentKlineNode {
  readonly qfqday?: readonly unknown[][]
  readonly day?: readonly unknown[]
}

interface TencentKlineResponse {
  readonly code?: number
  readonly data?: Readonly<Record<string, TencentKlineNode | undefined>>
}

/** 解析腾讯 fqkline 响应为 Bar[]（wire 边界：逐字段运行时校验，畸形行跳过）。 */
export function parseTencentKline(payload: unknown, code: string): readonly Bar[] {
  const root = payload as TencentKlineResponse
  if (root.code !== undefined && root.code !== 0) {
    throw new Error(`腾讯行情响应 code=${String(root.code)}：${code}`)
  }
  const node = root.data?.[code]
  if (node === undefined) {
    throw new Error(`腾讯行情响应缺少代码节点：${code}`)
  }
  const rows = node.qfqday ?? node.day
  if (rows === undefined || rows.length === 0) {
    throw new Error(`腾讯行情响应无 K 线数据：${code}`)
  }
  const bars: Bar[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) {
      continue
    }
    const date = row[0]
    const open = Number(row[1])
    const close = Number(row[2])
    const high = Number(row[3])
    const low = Number(row[4])
    const volume = Number(row[5])
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(open) ||
      !Number.isFinite(close) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(volume)
    ) {
      continue
    }
    bars.push({ date, open, high, low, close, volume })
  }
  if (bars.length === 0) {
    throw new Error(`腾讯行情响应无有效 K 线：${code}`)
  }
  return bars
}

/** 按候选代码逐个尝试（美股 .OQ 不存在时自动换 .N）；全部失败 fail loud。 */
export async function fetchBarsTencent(symbol: string, range: string, signal?: AbortSignal): Promise<readonly Bar[]> {
  const count = RANGE_TO_COUNT[range]
  if (count === undefined) {
    throw new Error(`腾讯行情源不支持的区间：${range}（可用：${Object.keys(RANGE_TO_COUNT).join(' / ')}）`)
  }
  let lastError = '无候选代码'
  for (const code of tencentCodes(symbol)) {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${String(count)},qfq`
    try {
      const payload = await fetchJson<unknown>(url, { signal })
      return parseTencentKline(payload, code)
    } catch (error) {
      // 单个候选失败（如美股 .OQ 无此代码）→ 尝试下一候选；全部失败才抛出。
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`腾讯行情源获取失败：${symbol} —— ${lastError}`)
}
