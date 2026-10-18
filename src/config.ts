/**
 * Config 与决策 JSON 的 zod 校验。
 *
 * 仓库规约：部署相关取值必须是验证过的 Config 字段（cordis.yml 可改），禁止硬编码；
 * 解析失败 fail loud 并带插件 entry id。
 */
import { z } from 'zod'

import { ANALYST_KINDS } from './types.ts'

/** 插件 Config schema（全部字段带默认值，cordis.yml 只需覆盖要改的）。 */
export const tradingAgentsConfigSchema = z.object({
  /** 启用的分析师（并行运行）。 */
  selectedAnalysts: z.array(z.enum(ANALYST_KINDS)).nonempty().default(['market', 'news', 'sentiment', 'fundamentals']),
  /** 多空辩论轮数。 */
  maxDebateRounds: z.number().int().min(1).max(5).default(1),
  /** 风险辩论轮数。 */
  maxRiskRounds: z.number().int().min(1).max(3).default(1),
  /** 行情数据源：腾讯（CN 可达，默认）或 Yahoo（海外部署）。 */
  marketDataSource: z.enum(['tencent', 'yahoo']).default('tencent'),
  /** AkShare 桥（可选）：启用后注册 A 股财务工具；桥进程为长驻 stdio JSON 子进程。 */
  dataBridge: z
    .object({
      enabled: z.boolean().default(false),
      /** python 解释器路径；缺省用 PATH 上的 python。 */
      pythonPath: z.string().min(1).optional(),
      /** 桥脚本路径（相对 workspace 或绝对）。 */
      scriptPath: z.string().min(1).default('bridge/akshare_bridge.py'),
      /** 等待桥 ready（akshare 导入）的上限。 */
      readyTimeoutMs: z.number().int().min(5_000).max(600_000).default(120_000),
      /** 单次桥调用等待上限。 */
      callTimeoutMs: z.number().int().min(5_000).max(600_000).default(60_000),
    })
    .default({ enabled: false }),
  /** 报告与决策的输出语言。 */
  decisionLanguage: z.string().min(1).default('中文'),
  /** runs 与记忆的存放根目录（相对 workspace）。 */
  dataDir: z.string().min(1).default('tradingagents-data'),
  /**
   * SEC EDGAR 合规要求的联系方式（非密钥）。
   * 为空字符串时 EDGAR 源不可用（加载期警告），fundamentals 走 Yahoo quoteSummary 回退。
   */
  secEdgarUserAgent: z.string().default(''),
  /**
   * 队友子代理的 LLM provider id（spawnTeammate 请求必填字段）。
   * 平台 tool-agent-team 对 fresh 队友的默认值是 'spawn'。
   */
  teammateProvider: z.string().min(1).default('spawn'),
  /**
   * 单阶段等待 teammate 的上限（毫秒）。
   * 实测依据：真实 LLM 队友单阶段耗时 8–12 分钟（含取数与手算指标），故默认 15 分钟。
   */
  stageTimeoutMs: z.number().int().min(10_000).max(3_600_000).default(900_000),
  /** 可选数据源凭据 ref（经 ctx.credentials.resolve 取值，绝不读环境变量）。 */
  optionalCredentialRefs: z
    .object({
      fred: z.string().optional(),
      alphaVantage: z.string().optional(),
      typesafe: z.string().optional(),
    })
    .default({}),
  /** 记忆注入条数上限。 */
  memory: z.object({ maxInject: z.number().int().min(0).max(20).default(3) }).default({ maxInject: 3 }),
})

export type TradingAgentsConfig = z.output<typeof tradingAgentsConfigSchema>

/** 解析并校验插件 Config；失败抛出带 entry id 的错误。 */
export function parseTradingAgentsConfig(raw: unknown, entryId: string): TradingAgentsConfig {
  const parsed = tradingAgentsConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`tradingagents 插件 Config 校验失败（entry: ${entryId}）：${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  return parsed.data
}

/** `decision.json` 的校验 schema（组合经理产出，记忆管道消费）。 */
export const decisionSchema = z.object({
  runId: z.string().min(1),
  ticker: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(['BUY', 'SELL', 'HOLD']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  refPrice: z.number().positive().optional(),
  reflection: z.string().min(1).optional(),
})
