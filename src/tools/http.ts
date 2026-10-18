/**
 * HTTP 基础设施：与部署环境一致的 JSON GET（统一 UA、超时由调用方 signal 控制）。
 * 从 data.ts 抽出以消除 data.ts ↔ tencent.ts 的循环依赖。
 */

export const BASE_UA = 'dsh-tradingagents-teams/0.1.0 (DeepSeek Harness plugin; research use)'

export interface FetchOptions {
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal | undefined
}

/** JSON GET；非 2xx fail loud。若部署要求统一网络出口，此函数是唯一替换点（换 ctx.web.fetch）。 */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetch(url, {
    headers: { 'user-agent': BASE_UA, accept: 'application/json', ...options.headers },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} GET ${url}`)
  }
  return (await response.json()) as T
}
