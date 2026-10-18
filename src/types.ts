/**
 * 领域类型：分析师、阶段、决策、manifest、记忆。
 * 闭合 union 一律以穷举 switch/完整映射收尾；阶段 dispatch 见 `orchestrator.ts`。
 */

/** 四类分析师（与原版 TradingAgents 的 analysts 选项一致）。 */
export const ANALYST_KINDS = ['market', 'news', 'sentiment', 'fundamentals'] as const
export type AnalystKind = (typeof ANALYST_KINDS)[number]

/** 解析字符串为 AnalystKind；未知值 fail loud。 */
export function toAnalystKind(value: string): AnalystKind {
  const match = ANALYST_KINDS.find(kind => kind === value)
  if (match === undefined) {
    throw new Error(`未知分析师类型：“${value}”（可用：${ANALYST_KINDS.join(' / ')}）`)
  }
  return match
}

/** 流水线阶段，闭合 union；顺序即执行顺序。 */
export const STAGE_NAMES = [
  'resolve',
  'analysts',
  'research-debate',
  'research-judgment',
  'trade-plan',
  'risk-debate',
  'risk-judgment',
  'portfolio',
  'memory',
] as const
export type StageName = (typeof STAGE_NAMES)[number]

/** 最终决策动作。 */
export type DecisionAction = 'BUY' | 'SELL' | 'HOLD'

/** 结构化最终决策（`decision.json` 的内容，也是会话事件 `tradingagents:decision` 的载荷核心）。 */
export interface Decision {
  readonly runId: string
  readonly ticker: string
  readonly date: string
  readonly action: DecisionAction
  /** 0..1。 */
  readonly confidence: number
  readonly rationale: string
  readonly quantity?: number
  readonly refPrice?: number
  /** 组合经理的一段反思（写入记忆）。 */
  readonly reflection?: string
}

/** 运行 manifest（`runs/<runId>/manifest.json`）：状态机恢复点 + 参与者索引。 */
export interface RunManifest {
  readonly runId: string
  readonly ticker: string
  readonly date: string
  readonly createdAt: string
  readonly analysts: readonly AnalystKind[]
  stage: StageName
  status: 'running' | 'completed' | 'failed'
  /** 各阶段创建的任务板任务 id（advisory write scope 同源）。 */
  readonly taskIds: Partial<Record<StageName, readonly string[]>>
  /** 角色 → teammate target（Lead 可据此 interrupt）。 */
  readonly teammates: Record<string, string>
  /** 降级记录：分析师/风险角色失败原因。 */
  readonly degraded: Record<string, string>
  decision?: Decision
}

/** 记忆条目（`decisions.jsonl` 的一行）。 */
export interface MemoryRecord {
  readonly runId: string
  readonly ticker: string
  readonly date: string
  readonly action: DecisionAction
  readonly confidence: number
  readonly entryRefPrice: number | null
  readonly evaluation: {
    readonly evaluated: boolean
    readonly rawReturn: number | null
    readonly alphaVsBenchmark: number | null
  }
  readonly reflection: string
}

/** 行情数据源（Config.marketDataSource）。 */
export type MarketDataSource = 'tencent' | 'yahoo'

/** 市场区域（决定基准指数映射）。 */
export type Region = 'US' | 'HK' | 'JP' | 'CN' | 'OTHER'

/** 区域 → alpha 基准；OTHER 无基准（alpha 记 null）。 */
export const REGION_BENCHMARK: { readonly [R in Exclude<Region, 'OTHER'>]: string } = {
  US: '^GSPC',
  HK: '^HSI',
  JP: '^N225',
  CN: '000001.SS',
}

/** 按交易所后缀推断区域。 */
export function regionOfTicker(ticker: string): Region {
  if (ticker.endsWith('.HK')) {
    return 'HK'
  }
  if (ticker.endsWith('.T')) {
    return 'JP'
  }
  if (ticker.endsWith('.SS') || ticker.endsWith('.SZ')) {
    return 'CN'
  }
  if (ticker.includes('.')) {
    return 'OTHER'
  }
  return 'US'
}

/** 穷举收尾助手。 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}：出现未处理的分支 ${String(value)}`)
}
