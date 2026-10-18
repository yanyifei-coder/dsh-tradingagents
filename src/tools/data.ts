/**
 * 数据工具：行情 / 基本面 / 新闻 / 情绪（无 Python，公共 HTTP）。
 *
 * 真实 ToolDefinition 契约（从宿主 dsh-tools register 校验源码实证）：
 * - parameters：裸 JSON Schema 对象根（{ type:'object', properties, required }）
 * - output：{ schema（原始 JSON Schema）, render(args, value) }
 * - execute 返回值必须符合 output.schema —— 本插件统一返回 JSON 字符串
 * 约定：核心数据源（行情/EDGAR）字段缺失即 fail loud；外围源（StockTwits/Reddit/搜索兜底）
 * 单源失败降级并在输出中注明。若部署要求统一网络出口，替换点在 http.ts 的 fetchJson。
 */
import type { TradingAgentsConfig } from '../config.ts'
import type { DshContext, ToolDefinition } from '../dsh-types.ts'
import { REGION_BENCHMARK, regionOfTicker, type MarketDataSource, type Region } from '../types.ts'
import { type Bar, macd, rsi, sma } from './indicators.ts'
import { fetchJson } from './http.ts'
import { fetchBarsTencent } from './tencent.ts'

// ---------- Yahoo chart（海外部署备选源） ----------

interface YahooChartResponse {
  readonly chart: {
    readonly result?: readonly {
      readonly meta?: { readonly symbol?: string; readonly regularMarketPrice?: number }
      readonly timestamp?: readonly number[]
      readonly indicators?: {
        readonly quote?: readonly {
          readonly open?: readonly (number | null)[]
          readonly high?: readonly (number | null)[]
          readonly low?: readonly (number | null)[]
          readonly close?: readonly (number | null)[]
          readonly volume?: readonly (number | null)[]
        }[]
      }
    }[]
    readonly error?: { readonly code?: string; readonly description?: string } | null
  }
}

/** Yahoo 日线 OHLCV。海外部署备选；大陆环境不可达（DESIGN §7.1）。 */
async function fetchBarsYahoo(symbol: string, range: string, signal?: AbortSignal): Promise<readonly Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
  const payload = await fetchJson<YahooChartResponse>(url, { signal })
  const apiError = payload.chart.error
  if (apiError !== undefined && apiError !== null) {
    throw new Error(`Yahoo chart 错误 ${apiError.code ?? '?'}：${apiError.description ?? ''}`)
  }
  const result = payload.chart.result?.[0]
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0]
  if (result === undefined || timestamps === undefined || quote === undefined) {
    throw new Error(`Yahoo chart 返回缺少关键字段：${symbol}（端点字段漂移？）`)
  }
  const bars: Bar[] = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    const open = quote.open?.[i]
    const high = quote.high?.[i]
    const low = quote.low?.[i]
    const close = quote.close?.[i]
    const volume = quote.volume?.[i]
    if (ts === undefined || open === undefined || open === null || high === undefined || high === null || low === undefined || low === null || close === undefined || close === null) {
      continue
    }
    bars.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), open, high, low, close, volume: volume ?? 0 })
  }
  if (bars.length === 0) {
    throw new Error(`Yahoo chart 无有效 OHLC 数据：${symbol}`)
  }
  return bars
}

/** 按源分发日线取数（同一 Bar 契约，DESIGN §7）：tencent（默认，CN 可达）| yahoo（海外）。 */
export async function fetchBars(symbol: string, range: string, source: MarketDataSource, signal?: AbortSignal): Promise<readonly Bar[]> {
  switch (source) {
    case 'tencent':
      return fetchBarsTencent(symbol, range, signal)
    case 'yahoo':
      return fetchBarsYahoo(symbol, range, signal)
  }
}

export interface RealizedEvaluation {
  readonly evaluated: boolean
  readonly rawReturn: number | null
  readonly alphaVsBenchmark: number | null
}

/** 计算入场日到 asOf 的 realized return 与相对区域基准的 alpha。持有窗不足 2 个交易日则未评估。 */
export async function realizedReturns(
  symbol: string,
  entryDate: string,
  asOf: string,
  source: MarketDataSource,
  signal?: AbortSignal,
): Promise<RealizedEvaluation> {
  const bars = await fetchBars(symbol, '1y', source, signal)
  const entry = bars.find(bar => bar.date >= entryDate)
  const exit = [...bars].reverse().find(bar => bar.date <= asOf)
  if (entry === undefined || exit === undefined || exit.date <= entry.date) {
    return { evaluated: false, rawReturn: null, alphaVsBenchmark: null }
  }
  const rawReturn = exit.close / entry.close - 1
  const region: Region = regionOfTicker(symbol)
  const benchmark = region === 'OTHER' ? undefined : REGION_BENCHMARK[region]
  if (benchmark === undefined) {
    return { evaluated: true, rawReturn, alphaVsBenchmark: null }
  }
  try {
    const benchBars = await fetchBars(benchmark, '1y', source, signal)
    const benchEntry = benchBars.find(bar => bar.date >= entry.date)
    const benchExit = [...benchBars].reverse().find(bar => bar.date <= exit.date)
    if (benchEntry === undefined || benchExit === undefined || benchExit.date <= benchEntry.date) {
      return { evaluated: true, rawReturn, alphaVsBenchmark: null }
    }
    return { evaluated: true, rawReturn, alphaVsBenchmark: rawReturn - (benchExit.close / benchEntry.close - 1) }
  } catch (error) {
    // 基准取数失败不掩盖已算出的 rawReturn：alpha 记 null 并注明。
    console.warn(`基准 ${benchmark} 取数失败（alpha 记 null）：${error instanceof Error ? error.message : String(error)}`)
    return { evaluated: true, rawReturn, alphaVsBenchmark: null }
  }
}

// ---------- EDGAR ----------

const edgarHeaders = (config: TradingAgentsConfig): Record<string, string> => {
  if (config.secEdgarUserAgent === '') {
    throw new Error('fundamentals 的 EDGAR 源需要配置 secEdgarUserAgent（SEC 合规要求联系方式，非密钥）；当前为空。请在 cordis.yml 配置，或改用其他分析师。')
  }
  return { 'user-agent': config.secEdgarUserAgent, accept: 'application/json' }
}

interface CompanyTickers {
  readonly [key: string]: { readonly cik_str: number; readonly ticker: string; readonly title: string }
}

interface SecSubmissions {
  readonly name?: string
  readonly filings?: {
    readonly recent?: {
      readonly form?: readonly string[]
      readonly filingDate?: readonly string[]
    }
  }
}

interface SecFact {
  readonly end: string
  readonly val: number
  readonly form?: string
}

interface SecCompanyFacts {
  readonly facts?: {
    readonly 'us-gaap'?: Readonly<Record<string, { readonly units?: Readonly<Record<string, readonly SecFact[]>> }>>
  }
}

let cikCache: ReadonlyMap<string, string> | undefined

async function lookupCik(ticker: string, config: TradingAgentsConfig, signal?: AbortSignal): Promise<string | undefined> {
  if (cikCache === undefined) {
    const raw = await fetchJson<CompanyTickers>('https://www.sec.gov/files/company_tickers.json', {
      headers: edgarHeaders(config),
      signal,
    })
    const map = new Map<string, string>()
    for (const entry of Object.values(raw)) {
      map.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, '0'))
    }
    cikCache = map
  }
  return cikCache.get(ticker.toUpperCase())
}

/** 取某 XBRL 指标最近 4 个财年（10-K，按期末日去重）。 */
function annualSeries(facts: SecCompanyFacts, keys: readonly string[]): readonly { readonly end: string; readonly val: number }[] {
  const gaap = facts.facts?.['us-gaap']
  for (const key of keys) {
    const usd = gaap?.[key]?.units?.USD
    if (usd === undefined) {
      continue
    }
    const byEnd = new Map<string, number>()
    for (const fact of usd) {
      if (fact.form === '10-K') {
        byEnd.set(fact.end, fact.val)
      }
    }
    return [...byEnd.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(-4)
      .map(([end, val]) => ({ end, val }))
  }
  return []
}

interface EdgarFundamentals {
  readonly source: 'edgar'
  readonly ticker: string
  readonly cik: string
  readonly company: string | null
  readonly annual: {
    readonly revenues: readonly { readonly end: string; readonly val: number }[]
    readonly netIncome: readonly { readonly end: string; readonly val: number }[]
    readonly assets: readonly { readonly end: string; readonly val: number }[]
    readonly equity: readonly { readonly end: string; readonly val: number }[]
  }
  readonly recentFilings: readonly { readonly form: string; readonly filed: string }[]
}

/** EDGAR 基本面；UA 未配置或无登记返回 null（调用方走 Yahoo quoteSummary 回退）。 */
async function edgarFundamentals(ticker: string, config: TradingAgentsConfig, signal?: AbortSignal): Promise<EdgarFundamentals | null> {
  if (config.secEdgarUserAgent === '') {
    return null
  }
  const cik = await lookupCik(ticker, config, signal)
  if (cik === undefined) {
    return null
  }
  const [submissions, facts] = await Promise.all([
    fetchJson<SecSubmissions>(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: edgarHeaders(config), signal }),
    fetchJson<SecCompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: edgarHeaders(config), signal }),
  ])
  const recent = submissions.filings?.recent
  const filings: { readonly form: string; readonly filed: string }[] = []
  const forms = recent?.form
  const dates = recent?.filingDate
  if (forms !== undefined && dates !== undefined) {
    for (let i = 0; i < Math.min(forms.length, dates.length, 8); i += 1) {
      const form = forms[i]
      const filed = dates[i]
      if (form !== undefined && filed !== undefined) {
        filings.push({ form, filed })
      }
    }
  }
  return {
    source: 'edgar',
    ticker,
    cik,
    company: submissions.name ?? null,
    annual: {
      revenues: annualSeries(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']),
      netIncome: annualSeries(facts, ['NetIncomeLoss']),
      assets: annualSeries(facts, ['Assets']),
      equity: annualSeries(facts, ['StockholdersEquity']),
    },
    recentFilings: filings,
  }
}

// ---------- Yahoo quoteSummary（非美回退） ----------

interface YahooQuoteSummaryResponse {
  readonly quoteSummary?: {
    readonly result?: readonly {
      readonly financialData?: {
        readonly totalRevenue?: { readonly raw?: number }
        readonly netIncomeToCommon?: { readonly raw?: number }
        readonly ebitda?: { readonly raw?: number }
        readonly returnOnEquity?: { readonly raw?: number }
        readonly currentPrice?: { readonly raw?: number }
        readonly debtToEquity?: { readonly raw?: number }
      }
    }[]
  }
}

interface QuoteMetrics {
  readonly totalRevenue: number | null
  readonly netIncome: number | null
  readonly ebitda: number | null
  readonly returnOnEquity: number | null
  readonly currentPrice: number | null
  readonly debtToEquity: number | null
}

/** Yahoo quoteSummary 快照指标；端点为非官方且可能要求 crumb，失败 fail loud。 */
async function fetchQuoteSummary(ticker: string, signal?: AbortSignal): Promise<QuoteMetrics> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData`
  const payload = await fetchJson<YahooQuoteSummaryResponse>(url, { signal })
  const financial = payload.quoteSummary?.result?.[0]?.financialData
  if (financial === undefined) {
    throw new Error(`Yahoo quoteSummary 回退失败：${ticker} 返回缺少 financialData（非官方端点可能要求 crumb）`)
  }
  const rawOf = (field?: { readonly raw?: number }): number | null => field?.raw ?? null
  return {
    totalRevenue: rawOf(financial.totalRevenue),
    netIncome: rawOf(financial.netIncomeToCommon),
    ebitda: rawOf(financial.ebitda),
    returnOnEquity: rawOf(financial.returnOnEquity),
    currentPrice: rawOf(financial.currentPrice),
    debtToEquity: rawOf(financial.debtToEquity),
  }
}

// ---------- 工具定义 ----------

/** 参数属性行内的描述文本（裸 JSON Schema property-map DSL）。 */
const str = (description: string): { readonly type: 'string'; readonly description: string } => ({ type: 'string', description })

/** 工具输出统一为 JSON 字符串：schema 恒为 { type:'string' }，render 返回模型可见的 text 内容块数组。 */
const STRING_OUTPUT = {
  schema: { type: 'string', description: 'JSON-serialized result' },
  render: (_args: unknown, value: unknown): unknown => [{ type: 'text', text: String(value) }],
} as const

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value === '') {
    throw new Error(`参数 ${key} 必填（字符串）`)
  }
  return value
}

/** 构造四个数据工具（闭包携带 Config 与 ctx：凭据/搜索兜底）。 */
export function createDataTools(config: TradingAgentsConfig, ctx: DshContext): readonly ToolDefinition[] {
  const marketTool: ToolDefinition = {
    name: 'ta_get_market_data',
    description: '获取日线行情与常用技术指标（SMA20/50、RSI14、MACD）。ticker 用 Yahoo 风格代码（NVDA、0700.HK、600519.SS）；数据源按 Config（默认腾讯）。range: 1mo/3mo/6mo/1y/2y，缺省 6mo。',
    parameters: {
      type: 'object',
      properties: {
        ticker: str('Yahoo 风格标的代码，如 NVDA、0700.HK、600519.SS'),
        range: str('K 线区间：1mo | 3mo | 6mo | 1y | 2y，缺省 6mo'),
      },
      required: ['ticker'],
    },
    output: STRING_OUTPUT,
    execute: async (args, exec) => {
      const ticker = requireString(args, 'ticker')
      const range = typeof args.range === 'string' ? args.range : '6mo'
      const bars = await fetchBars(ticker, range, config.marketDataSource, exec.signal)
      const closes = bars.map(bar => bar.close)
      const last = bars[bars.length - 1]
      const result = {
        ticker,
        range,
        bars: bars.length,
        lastDate: last?.date ?? null,
        lastClose: last?.close ?? null,
        sma20: sma(closes, 20),
        sma50: sma(closes, 50),
        rsi14: rsi(closes, 14),
        macd: macd(closes),
        recentCloses: bars.slice(-10).map(bar => `${bar.date} ${bar.close.toFixed(2)}`),
      }
      return JSON.stringify(result, null, 2)
    },
  }

  const fundamentalsTool: ToolDefinition = {
    name: 'ta_get_fundamentals',
    description: '获取公司基本面：US 走 SEC EDGAR（近 8 次申报 + 近 4 财年营收/净利/资产/权益）；非 US 或未配置 UA 时回退 Yahoo quoteSummary 快照指标。',
    parameters: {
      type: 'object',
      properties: { ticker: str('6 位代码（A股）或 Yahoo 风格代码（美股）') },
      required: ['ticker'],
    },
    output: STRING_OUTPUT,
    execute: async (args, exec) => {
      const ticker = requireString(args, 'ticker')
      const edgar = await edgarFundamentals(ticker, config, exec.signal)
      if (edgar !== null) {
        return JSON.stringify(edgar, null, 2)
      }
      const metrics = await fetchQuoteSummary(ticker, exec.signal)
      return JSON.stringify(
        {
          ticker,
          source: 'yahoo-quote-summary',
          metrics,
          note: 'EDGAR 源不可用（未配置 secEdgarUserAgent）或无登记：Yahoo quoteSummary 快照回退（非官方端点）。',
        },
        null,
        2,
      )
    },
  }

  const newsTool: ToolDefinition = {
    name: 'ta_get_news',
    description: '获取标的新闻头条（Yahoo 搜索；不足时回退 DSH web.search）。limit 1-20，缺省 8。',
    parameters: {
      type: 'object',
      properties: {
        ticker: str('标的代码'),
        limit: str('头条条数上限，缺省 8'),
      },
      required: ['ticker'],
    },
    output: STRING_OUTPUT,
    execute: async (args, exec) => {
      const ticker = requireString(args, 'ticker')
      const limit = typeof args.limit === 'number' ? args.limit : 8
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=1&newsCount=${String(limit)}`
      const payload = await fetchJson<{ readonly news?: readonly { readonly title?: string; readonly publisher?: string; readonly link?: string; readonly providerPublishTime?: number }[] }>(url, { signal: exec.signal })
      interface NewsItem {
        readonly title: string | null
        readonly publisher: string | null
        readonly link: string | null
        readonly date: string | null
      }
      let items: NewsItem[] = (payload.news ?? []).slice(0, limit).map(item => ({
        title: item.title ?? null,
        publisher: item.publisher ?? null,
        link: item.link ?? null,
        date: item.providerPublishTime === undefined ? null : new Date(item.providerPublishTime * 1000).toISOString(),
      }))
      let source = 'yahoo-search'
      let note: string | undefined
      if (items.length === 0 && ctx.web !== undefined) {
        try {
          const web = await ctx.web.search({ query: `${ticker} stock news` }, exec.signal)
          items = web.results.slice(0, limit).map(result => ({
            title: result.title,
            publisher: null,
            link: result.url,
            date: null,
          }))
          source = 'dsh-web-search'
        } catch (error) {
          // 搜索兜底失败：返回已得的（空）结果并注明，不由外围源打断分析。
          note = `web.search 兜底失败：${error instanceof Error ? error.message : String(error)}`
        }
      }
      return JSON.stringify({ ticker, source, items, note }, null, 2)
    },
  }

  const sentimentTool: ToolDefinition = {
    name: 'ta_get_sentiment',
    description: '聚合社媒情绪原始计数（StockTwits 多空标记 + Reddit 帖子标题）；解释交给情绪分析师。',
    parameters: { type: 'object', properties: { ticker: str('标的代码（StockTwits/Reddit 的美股式代码）') }, required: ['ticker'] },
    output: STRING_OUTPUT,
    execute: async (args, exec) => {
      const ticker = requireString(args, 'ticker')
      const stocktwits = await (async () => {
        try {
          const payload = await fetchJson<{ readonly messages?: readonly { readonly body?: string; readonly sentiment?: { readonly bull?: boolean; readonly bear?: boolean } | null }[] }>(
            `https://api.stocktwits.com/api/streams/symbol/${encodeURIComponent(ticker)}.json`,
            { signal: exec.signal },
          )
          const messages = payload.messages ?? []
          const bull = messages.filter(message => message.sentiment?.bull === true).length
          const bear = messages.filter(message => message.sentiment?.bear === true).length
          return {
            ok: true as const,
            total: messages.length,
            bull,
            bear,
            unclear: messages.length - bull - bear,
            samples: messages.slice(0, 5).map(message => (message.body ?? '').slice(0, 120)),
          }
        } catch (error) {
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
        }
      })()
      const reddit = await (async () => {
        try {
          const payload = await fetchJson<{ readonly data?: { readonly children?: readonly { readonly data?: { readonly title?: string; readonly subreddit?: string } }[] } }>(
            `https://www.reddit.com/search.json?q=${encodeURIComponent(ticker)}&sort=new&limit=25&restrict_sr=false`,
            { signal: exec.signal },
          )
          const posts = payload.data?.children ?? []
          const titles = posts
            .map(child => child.data)
            .filter((data): data is { readonly title: string; readonly subreddit: string } => data?.title !== undefined && data.subreddit !== undefined)
            .slice(0, 10)
            .map(data => `[r/${data.subreddit}] ${data.title}`)
          return { ok: true as const, posts: posts.length, titles }
        } catch (error) {
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
        }
      })()
      return JSON.stringify({ ticker, stocktwits, reddit }, null, 2)
    },
  }

  return [marketTool, fundamentalsTool, newsTool, sentimentTool]
}
