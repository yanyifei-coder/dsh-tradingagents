/**
 * 数据源连通性探针：验证插件依赖的公共 HTTP 端点在当前环境的可达性与响应形状。
 *
 * 用法：node scripts/probe-data-sources.mjs
 * 请求头与 src/tools/data.ts 的 fetchJson 保持一致；全部为只读 GET，单请求 15s 超时。
 * Yahoo 对非浏览器 UA 返回 403 时，用浏览器 UA 复测一次以区分"UA 过滤"与"端点封锁"。
 * 探针结论用于设计校准（DESIGN §7/§12），不是运行时代码。
 */

const PLUGIN_UA = 'tradingagents-dsh/0.1.0 (DeepSeek Harness plugin; research use)'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT_MS = 15_000

async function getJson(label, url, headers = {}) {
  const started = Date.now()
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': PLUGIN_UA, accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const ms = Date.now() - started
    if (!response.ok) {
      console.log(`FAIL  ${label}: HTTP ${response.status} (${ms}ms)`)
      return null
    }
    const json = await response.json()
    const sizeKb = (JSON.stringify(json).length / 1024).toFixed(0)
    console.log(`OK    ${label}: HTTP ${response.status} (${ms}ms, ${sizeKb}KB)`)
    return json
  } catch (error) {
    const ms = Date.now() - started
    console.log(`FAIL  ${label}: ${error instanceof Error ? error.message : String(error)} (${ms}ms)`)
    return null
  }
}

async function probeChart(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d`
  const json = await getJson(`Yahoo chart ${ticker}`, url)
  if (json === null) {
    const retry = await getJson(`Yahoo chart ${ticker}（浏览器 UA 复测）`, url, { 'user-agent': BROWSER_UA })
    if (retry === null) {
      return
    }
    reportChart(ticker, retry)
    return
  }
  reportChart(ticker, json)
}

function reportChart(ticker, json) {
  const result = json.chart?.result?.[0]
  const timestamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (timestamps === undefined || closes === undefined) {
    console.log(`      WARN ${ticker}: 响应缺少 timestamp/close（形状漂移？）`)
    return
  }
  const lastTs = timestamps[timestamps.length - 1]
  const lastClose = closes[closes.length - 1]
  const lastDate = typeof lastTs === 'number' ? new Date(lastTs * 1000).toISOString().slice(0, 10) : '?'
  const priceText = typeof lastClose === 'number' ? String(lastClose) : '(null)'
  console.log(`      ${ticker}: ${timestamps.length} 根日线，最新 ${lastDate} 收盘 ${priceText}`)
}

async function probeQuoteSummary(ticker) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData`
  const json = await getJson(`Yahoo quoteSummary ${ticker}（非美回退）`, url)
  if (json === null) {
    const retry = await getJson(`Yahoo quoteSummary ${ticker}（浏览器 UA 复测）`, url, { 'user-agent': BROWSER_UA })
    if (retry === null) {
      return
    }
    reportQuoteSummary(ticker, retry)
    return
  }
  reportQuoteSummary(ticker, json)
}

function reportQuoteSummary(ticker, json) {
  const financial = json.quoteSummary?.result?.[0]?.financialData
  if (financial === undefined) {
    console.log(`      WARN ${ticker}: 缺少 financialData（crumb 要求？）`)
    return
  }
  console.log(`      ${ticker}: currentPrice=${financial.currentPrice?.raw ?? 'null'} totalRevenue=${financial.totalRevenue?.raw ?? 'null'}`)
}

async function probeEastmoney(secid, label) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=0&end=20500101&lmt=20`
  const json = await getJson(`Eastmoney kline ${label}（${secid}）`, url)
  if (json === null) {
    return
  }
  const klines = json.data?.klines
  if (!Array.isArray(klines) || klines.length === 0) {
    console.log(`      WARN ${label}: klines 缺失或为空（name=${json.data?.name ?? '?'}）`)
    return
  }
  const last = klines[klines.length - 1]
  console.log(`      ${label}: ${json.data?.name ?? '?'} ${klines.length} 根，末行: ${last?.slice(0, 46)}`)
}

async function probeEdgar() {
  const map = await getJson('SEC EDGAR company_tickers.json', 'https://www.sec.gov/files/company_tickers.json')
  if (map === null) {
    return
  }
  const nvda = Object.values(map).find(entry => entry.ticker === 'NVDA')
  if (nvda === undefined) {
    console.log('      WARN: company_tickers.json 中找不到 NVDA')
    return
  }
  const cik = String(nvda.cik_str).padStart(10, '0')
  console.log(`      NVDA → CIK ${cik}（${nvda.title}），映射共 ${Object.keys(map).length} 条`)
  const submissions = await getJson(`SEC EDGAR submissions CIK${cik}`, `https://data.sec.gov/submissions/CIK${cik}.json`)
  if (submissions === null) {
    return
  }
  const forms = submissions.filings?.recent?.form
  console.log(`      近期申报 ${forms?.length ?? 0} 条，最新形态: ${forms?.slice(0, 3).join(', ') ?? '?'}`)
}

async function probeSentiment(ticker) {
  const twits = await getJson(
    `StockTwits ${ticker}`,
    `https://api.stocktwits.com/api/streams/symbol/${encodeURIComponent(ticker)}.json`,
  )
  if (twits !== null) {
    const messages = twits.messages ?? []
    const bull = messages.filter(message => message.sentiment?.bull === true).length
    const bear = messages.filter(message => message.sentiment?.bear === true).length
    console.log(`      消息 ${messages.length} 条：bull=${bull} bear=${bear}`)
  }
  const reddit = await getJson(
    `Reddit search ${ticker}`,
    `https://www.reddit.com/search.json?q=${encodeURIComponent(ticker)}&sort=new&limit=25&restrict_sr=false`,
  )
  if (reddit !== null) {
    console.log(`      帖子 ${(reddit.data?.children ?? []).length} 条`)
  }
}

console.log(`=== tradingagents-dsh 数据源探针 @ ${new Date().toISOString()} ===`)
await probeEastmoney('105.NVDA', '美股 NVDA')
await probeEastmoney('116.00700', '港股 00700')
await probeEastmoney('1.600519', 'A股 600519')
await probeChart('NVDA')
await probeChart('0700.HK')
await probeChart('600519.SS')
await probeQuoteSummary('0700.HK')
await probeEdgar()
await probeSentiment('NVDA')
console.log('=== 探针结束 ===')
