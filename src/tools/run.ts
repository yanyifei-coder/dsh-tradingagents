/**
 * 运行入口工具：
 * - `start_trading_analysis`：Lead 身份校验 + jobs 后台启动编排，立即返回 runId/jobId。
 * - `ta_run_status`：读 manifest.json 查询阶段、状态、降级记录与决策。
 * JobSpec 契约（dsh-jobs-local 源码实证）：kind/label 必填；owner=会话 id（完成通知投递）；
 * run(handle) 返回 { done: Promise<{status, detail?}>, cancel() }；handle.append 写任务输出。
 * cancel() 中止 run 级 AbortController，编排内 agentTeams 调用随即拒绝，job 结算为 killed。
 */
import type { PipelineDeps, ToolDefinition } from '../dsh-types.ts'
import type { EmitTaEvent } from '../events.ts'
import { newRunId, toAnalysisDate, toTickerSymbol } from '../ids.ts'
import { runPipeline } from '../orchestrator.ts'
import { toAnalystKind, type RunManifest } from '../types.ts'

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value === '') {
    throw new Error(`参数 ${key} 必填（字符串）`)
  }
  return value
}

/** 构造运行工具（闭包携带基础依赖：ctx / Config / 事件发射）。 */
export function createRunTools(deps: PipelineDeps): readonly ToolDefinition[] {
  const { ctx, config, emit } = deps

  const startTool: ToolDefinition = {
    name: 'start_trading_analysis',
    description:
      '启动一次 TradingAgents 多智能体分析（分析师 → 多空辩论 → 研究裁决 → 交易员 → 风险评审 → 组合经理）。仅 Team Lead 可调用；返回 runId/jobId，进度经 tradingagents:* 事件与 ta_run_status 查看。',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Yahoo 风格标的代码，如 NVDA、0700.HK、600519.SS' },
        date: { type: 'string', description: '分析日期 YYYY-MM-DD（不得晚于今天）' },
        analysts: { type: 'array', items: { type: 'string' }, description: '启用的分析师子集：market/news/sentiment/fundamentals，缺省用 Config' },
        maxDebateRounds: { type: 'number', description: '多空辩论轮数 1-5，缺省用 Config' },
        portfolioFile: { type: 'string', description: '可选：组合上下文 JSON 文件路径' },
      },
      required: ['ticker', 'date'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (rawArgs, exec) => {
      const ticker = toTickerSymbol(requireString(rawArgs, 'ticker'))
      const date = toAnalysisDate(requireString(rawArgs, 'date'))
      const rawAnalysts = rawArgs.analysts
      const analysts = Array.isArray(rawAnalysts) ? rawAnalysts.map(value => toAnalystKind(String(value))) : config.selectedAnalysts
      const rawRounds = rawArgs.maxDebateRounds
      const effectiveConfig = typeof rawRounds === 'number' ? { ...config, maxDebateRounds: rawRounds } : config
      const portfolioFile = typeof rawArgs.portfolioFile === 'string' ? rawArgs.portfolioFile : undefined
      const membership = ctx.agentTeams.tryMembership(exec.agent)
      if (membership === undefined || membership.role !== 'lead') {
        throw new Error('start_trading_analysis 只能由 Team Lead 调用（编排需要 spawnTeammate/sendMessage 权限）')
      }
      const runId = newRunId()
      const runDir = `${effectiveConfig.dataDir}/runs/${runId}`
      // 任务归属调用会话：完成通知投递给该 agent，job_list 按 owner 可见。
      const owner = exec.agent?.id
      // run 级取消控制器：job cancel() 经此中止编排内的全部 agentTeams 调用
      // （spawnTeammate/sendMessage/waitForChange 均要求携带真实 AbortSignal，平台侧直接解引用）。
      const abort = new AbortController()
      const jobId = ctx.jobs.start({
        kind: 'tradingagents-teams',
        label: `tradingagents-teams:${ticker}:${date}`,
        ...(owner === undefined ? {} : { owner }),
        outputLimitBytes: 262_144,
        run: handle => {
          // 阶段进度同步写入任务输出（job_output 可读）。
          const emitWithJob: EmitTaEvent = (name, payload) => {
            emit(name, payload)
            const summary =
              'summary' in payload
                ? payload.summary
                : 'decision' in payload
                  ? `action=${payload.decision.action}`
                  : 'reason' in payload
                    ? payload.reason
                    : 'team' in payload
                      ? `${payload.team} round ${String(payload.round)}: ${payload.paths.length} artifact(s)`
                      : `${payload.ticker} @ ${payload.date}`
            handle.append(`[${name}] ${summary}`)
          }
          const done = runPipeline(
            { ctx, config: effectiveConfig, emit: emitWithJob },
            {
              runId,
              ticker,
              date,
              analysts,
              runDir,
              lead: exec.agent,
              ...(portfolioFile === undefined ? {} : { portfolioFile }),
            },
            abort.signal,
          ).then(
            decision => ({ status: 'completed' as const, detail: JSON.stringify(decision) }),
            error => {
              const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
              return abort.signal.aborted ? { status: 'killed' as const, detail } : { status: 'failed' as const, detail }
            },
          )
          return { done, cancel: () => abort.abort() }
        },
      })
      return JSON.stringify(
        {
          runId,
          jobId,
          runDir,
          analysts,
          note: '进度见 tradingagents:* 会话事件、job_output 与 manifest.json；用 ta_run_status 查询状态。',
        },
        null,
        2,
      )
    },
  }

  const statusTool: ToolDefinition = {
    name: 'ta_run_status',
    description: '查询一次 TradingAgents 分析运行的当前阶段、状态、降级记录与决策（读 manifest.json）。',
    parameters: {
      type: 'object',
      properties: { runId: { type: 'string', description: 'start_trading_analysis 返回的运行 id' } },
      required: ['runId'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (rawArgs, exec) => {
      const runId = requireString(rawArgs, 'runId')
      const manifestPath = `${config.dataDir}/runs/${runId}/manifest.json`
      let raw: string
      try {
        raw = await ctx.fs.readText(await ctx.fs.resolve(manifestPath), exec.signal)
      } catch (error) {
        throw new Error(`找不到 run ${runId} 的 manifest（run 不存在或尚未写盘）：${error instanceof Error ? error.message : String(error)}`)
      }
      const manifest = JSON.parse(raw) as RunManifest
      return JSON.stringify(
        {
          runId: manifest.runId,
          ticker: manifest.ticker,
          date: manifest.date,
          stage: manifest.stage,
          status: manifest.status,
          degraded: manifest.degraded,
          teammates: Object.keys(manifest.teammates),
          decision: manifest.decision ?? null,
        },
        null,
        2,
      )
    },
  }

  return [startTool, statusTool]
}
