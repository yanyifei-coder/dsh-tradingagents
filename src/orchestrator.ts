/**
 * 编排状态机：把 TradingAgents 的 LangGraph 图跑在 DSH Agent Teams 上。
 *
 * 运行前提：调用方是 Team Lead（run 工具已校验）；整个流水线在 jobs 后台执行。
 * 每阶段：建任务板任务 → spawn/message 对应 teammate → 等 artifact 文件 → 推进 manifest → 发事件。
 * manifest 是恢复点（M2 实现崩溃后从 manifest 续跑）。
 *
 * 注意：agentTeams 的 spawnTeammate/sendMessage/waitForChange 必须携带 AbortSignal
 * （平台内部 AbortSignal.any([request.signal, lifecycle.signal]) 与 signal.throwIfAborted()
 * 直接解引用，undefined 会在 webidl 品牌校验处抛 "signals[0] is not of type AbortSignal"）。
 * 编排全程透传调用方传入的 run signal（run 工具用 job cancel 可中止的控制器 signal）。
 */
import { decisionSchema } from './config.ts'
import type { AgentHandle, PipelineDeps } from './dsh-types.ts'
import { todayIso, type AnalysisDate, type RunId, type TickerSymbol } from './ids.ts'
import { appendDecision, buildMemoryInjection, loadRecentDecisions } from './memory.ts'
import { languageClause, presetById } from './presets.ts'
import { realizedReturns } from './tools/data.ts'
import {
  REGION_BENCHMARK,
  STAGE_NAMES,
  regionOfTicker,
  type AnalystKind,
  type Decision,
  type MemoryRecord,
  type RunManifest,
  type StageName,
} from './types.ts'

/** 单阶段等待 teammate 超时。 */
export class StageTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`等待 teammate 产出超时（${stage}，${String(timeoutMs)}ms）`)
    this.name = 'StageTimeoutError'
  }
}

export interface PipelineStartInput {
  readonly runId: RunId
  readonly ticker: TickerSymbol
  readonly date: AnalysisDate
  readonly analysts: readonly AnalystKind[]
  /** `<dataDir>/runs/<runId>`。 */
  readonly runDir: string
  readonly lead: AgentHandle
  readonly portfolioFile?: string
}

const RISK_ROLES = ['aggressive', 'neutral', 'conservative'] as const

/** 执行一次完整分析。失败抛出；进度经 emit 可见，manifest 落盘可审计。 */
export async function runPipeline(deps: PipelineDeps, input: PipelineStartInput, signal: AbortSignal): Promise<Decision> {
  const { ctx, config, emit } = deps
  const fs = ctx.fs
  const manifestPath = `${input.runDir}/manifest.json`
  const decisionJsonPath = `${input.runDir}/decision.json`

  const manifest: RunManifest = {
    runId: input.runId,
    ticker: input.ticker,
    date: input.date,
    createdAt: new Date().toISOString(),
    analysts: input.analysts,
    stage: 'resolve',
    status: 'running',
    taskIds: {},
    teammates: {},
    degraded: {},
  }
  let decision: Decision | undefined
  let lastDebate: { readonly bull: string; readonly bear: string } | undefined
  let lastRiskPaths: readonly string[] = []

  async function persistManifest(): Promise<void> {
    await fs.writeText(await fs.resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
  }

  const artifactPath = (name: string): string => `${input.runDir}/artifacts/${name}`

  async function writeArtifact(name: string, content: string): Promise<void> {
    await fs.writeText(await fs.resolve(artifactPath(name)), `${content}\n`)
  }

  async function readArtifact(name: string): Promise<string> {
    return fs.readText(await fs.resolve(artifactPath(name)))
  }

  /** 轮询等待 teammate 写出 artifact；超时抛 StageTimeoutError。 */
  async function waitArtifact(name: string, stage: StageName): Promise<string> {
    const deadline = Date.now() + config.stageTimeoutMs
    for (;;) {
      try {
        return await readArtifact(name)
      } catch {
        // artifact 未产出或暂不可读：等待团队进展后重试。
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new StageTimeoutError(stage, config.stageTimeoutMs)
      }
      // 平台契约：timeoutMs 合法区间 10000–3600000；临近 deadline 时允许 10s 最小等待小幅越过。
      await ctx.agentTeams.waitForChange(input.lead, Math.max(10_000, Math.min(30_000, remaining)), signal)
    }
  }

  async function ensureTask(stage: StageName, subject: string, description: string): Promise<string> {
    const task = await ctx.agentTeams.createTask(input.lead, {
      subject,
      description,
      writeScopes: [`${input.runDir}/**`],
    })
    manifest.taskIds[stage] = [...(manifest.taskIds[stage] ?? []), task.id]
    await persistManifest()
    return task.id
  }

  /** spawn 一个一次性角色（preset 并入 prompt 首块；provider 走 Config，平台默认 'spawn'）。 */
  async function spawnRole(roleKey: string, presetId: string, task: string): Promise<void> {
    const preset = presetById(presetId)
    const name = `ta-${roleKey}-${input.runId.slice(-6)}`
    const spawned = await ctx.agentTeams.spawnTeammate(input.lead, {
      name,
      description: preset.description,
      prompt: [{ type: 'text', text: `[preset: ${presetId}]\n${preset.systemPrompt}\n\nTask:\n${task}` }],
      context: 'fresh',
      provider: config.teammateProvider,
      signal,
    })
    manifest.teammates[roleKey] = spawned.member.name
    await persistManifest()
  }

  async function messageRole(roleKey: string, task: string): Promise<void> {
    const target = manifest.teammates[roleKey]
    if (target === undefined) {
      throw new Error(`未找到角色 ${roleKey} 的 teammate（尚未 spawn）`)
    }
    await ctx.agentTeams.sendMessage(input.lead, { target, content: [{ type: 'text', text: task }], signal })
  }

  function buildTaskText(inputs: readonly string[], artifact: string, extra: readonly string[] = []): string {
    return [
      'Input artifacts (read with the workspace file-read tool):',
      ...inputs.map(path => `- ${path}`),
      `Write your deliverable to: ${artifactPath(artifact)}`,
      languageClause(config.decisionLanguage),
      ...extra,
    ].join('\n')
  }

  async function stageResolve(): Promise<string> {
    if (input.date > todayIso()) {
      throw new Error(`分析日期 ${input.date} 晚于当前日期（禁止未来日期）`)
    }
    const decisions = await loadRecentDecisions(fs, config.dataDir, input.ticker, config.memory.maxInject)
    const injection = buildMemoryInjection(decisions)
    const region = regionOfTicker(input.ticker)
    const benchmark = region === 'OTHER' ? '（无基准）' : REGION_BENCHMARK[region]
    let portfolioNote = '（未提供组合上下文）'
    if (input.portfolioFile !== undefined) {
      const raw = await fs.readText(await fs.resolve(input.portfolioFile))
      const parsed: unknown = JSON.parse(raw)
      const positions = (parsed as { positions?: unknown }).positions
      portfolioNote = `已读取组合文件 ${input.portfolioFile}（${Array.isArray(positions) ? String(positions.length) : '0'} 个持仓）`
    }
    await writeArtifact('01-resolve.md', [
      `# Run resolve — ${input.ticker} @ ${input.date}`,
      `Region: ${region}; benchmark: ${benchmark}`,
      `Portfolio context: ${portfolioNote}`,
      '',
      '## Memory injection',
      injection,
    ].join('\n'))
    return artifactPath('01-resolve.md')
  }

  async function stageAnalysts(): Promise<string> {
    const produced: string[] = []
    await Promise.all(input.analysts.map(async kind => {
      await ensureTask('analysts', `[${kind}] 分析报告：${input.ticker} ${input.date}`, `Analyst report artifact for stage analysts (${kind}).`)
      const artifact = `20-analyst-${kind}.md`
      const task = buildTaskText([artifactPath('01-resolve.md')], artifact, [
        'Use only your own data tool for evidence; the resolve artifact explains identity and memory.',
      ])
      await spawnRole(`analyst-${kind}`, `ta-analyst-${kind}`, task)
      try {
        await waitArtifact(artifact, 'analysts')
        produced.push(artifact)
      } catch (error) {
        if (!(error instanceof StageTimeoutError)) {
          throw error
        }
        // 重试一次；仍超时则降级为缺报告，不终止整个 run。
        try {
          await messageRole(`analyst-${kind}`, 'Reminder: finish now — write your artifact file, then send a short ack.')
          await waitArtifact(artifact, 'analysts')
          produced.push(artifact)
        } catch {
          manifest.degraded[`analyst-${kind}`] = '超时未产出报告，已降级为缺失'
          await persistManifest()
        }
      }
    }))
    if (produced.length === 0) {
      throw new Error('全部分析师都未产出报告，研究阶段无法继续')
    }
    return produced.map(artifactPath).join(', ')
  }

  async function stageResearchDebate(): Promise<string> {
    await ensureTask('research-debate', `多空辩论：${input.ticker} ${input.date}`, 'Bull/bear debate stage.')
    const analystPaths = input.analysts
      .filter(kind => manifest.degraded[`analyst-${kind}`] === undefined)
      .map(kind => artifactPath(`20-analyst-${kind}.md`))
    const degradedNote = Object.keys(manifest.degraded).length > 0
      ? `Note: some reports are degraded/missing: ${Object.keys(manifest.degraded).join(', ')}.`
      : 'All analyst reports available.'
    let bull = ''
    let bear = ''
    for (let round = 1; round <= config.maxDebateRounds; round += 1) {
      const bullArtifact = `30-debate-bull-${String(round)}.md`
      const bullTask = buildTaskText(
        round === 1 ? analystPaths : [artifactPath(`30-debate-bear-${String(round - 1)}.md`)],
        bullArtifact,
        [degradedNote, round === 1 ? 'Round 1: open your bullish case.' : `Round ${String(round)}: rebut the latest bear case and answer any open questions it left.`],
      )
      if (round === 1) {
        await spawnRole('researcher-bull', 'ta-researcher-bull', bullTask)
      } else {
        await messageRole('researcher-bull', bullTask)
      }
      try {
        await waitArtifact(bullArtifact, 'research-debate')
      } catch (error) {
        if (error instanceof StageTimeoutError) {
          manifest.degraded[`debate-round-${String(round)}`] = error.message
          await persistManifest()
          break
        }
        throw error
      }
      emit('tradingagents:debate-round', { runId: input.runId, team: 'research', round, paths: [artifactPath(bullArtifact)] })

      const bearArtifact = `30-debate-bear-${String(round)}.md`
      const bearTask = buildTaskText([artifactPath(bullArtifact)], bearArtifact, [
        round === 1 ? 'Round 1: open your bearish case, rebutting the bull.' : `Round ${String(round)}: rebut the latest bull case and answer any open questions it left.`,
      ])
      if (round === 1) {
        await spawnRole('researcher-bear', 'ta-researcher-bear', bearTask)
      } else {
        await messageRole('researcher-bear', bearTask)
      }
      try {
        await waitArtifact(bearArtifact, 'research-debate')
      } catch (error) {
        if (error instanceof StageTimeoutError) {
          manifest.degraded[`debate-round-${String(round)}`] = error.message
          await persistManifest()
          if (bull === '') {
            throw error
          }
          break
        }
        throw error
      }
      emit('tradingagents:debate-round', { runId: input.runId, team: 'research', round, paths: [artifactPath(bearArtifact)] })
      bull = bullArtifact
      bear = bearArtifact
    }
    if (bull === '' || bear === '') {
      throw new Error('辩论第一轮未完成（bull 与 bear 至少各一份立论/反驳），无法裁决')
    }
    lastDebate = { bull: artifactPath(bull), bear: artifactPath(bear) }
    return `${lastDebate.bull}, ${lastDebate.bear}`
  }

  async function stageResearchJudgment(): Promise<string> {
    if (lastDebate === undefined) {
      throw new Error('辩论阶段无产出，研究裁决缺少输入')
    }
    await ensureTask('research-judgment', `研究裁决：${input.ticker} ${input.date}`, 'Research verdict stage.')
    await spawnRole('research-manager', 'ta-research-manager', buildTaskText(
      [lastDebate.bull, lastDebate.bear],
      '40-research-verdict.md',
      ['Deliver: directional lean + confidence + the top risks that would invalidate it.'],
    ))
    await waitArtifact('40-research-verdict.md', 'research-judgment')
    return artifactPath('40-research-verdict.md')
  }

  async function stageTradePlan(): Promise<string> {
    await ensureTask('trade-plan', `交易方案：${input.ticker} ${input.date}`, 'Trade plan stage.')
    await spawnRole('trader', 'ta-trader', buildTaskText(
      [artifactPath('40-research-verdict.md'), artifactPath('01-resolve.md')],
      '50-trade-plan.md',
      ['Direction (BUY/SELL/HOLD), entry timing, sizing rationale, exit conditions. The resolve artifact carries the memory injection.'],
    ))
    await waitArtifact('50-trade-plan.md', 'trade-plan')
    return artifactPath('50-trade-plan.md')
  }

  async function stageRiskDebate(): Promise<string> {
    await ensureTask('risk-debate', `风险评审：${input.ticker} ${input.date}`, 'Risk debate stage.')
    const latestByRole = new Map<string, string>()
    for (let round = 1; round <= config.maxRiskRounds; round += 1) {
      const artifactByRole = new Map<string, string>(
        RISK_ROLES.map((role): [string, string] => [role, round === 1 ? `60-risk-${role}.md` : `60-risk-${role}-${String(round)}.md`]),
      )
      await Promise.all(RISK_ROLES.map(async role => {
        const artifact = artifactByRole.get(role) ?? ''
        const task = buildTaskText(
          round === 1 ? [artifactPath('50-trade-plan.md')] : [artifactPath(latestByRole.get(`risk-${role}`) ?? `60-risk-${role}.md`)],
          artifact,
          [round === 1 ? 'Round 1: review the trade plan from your risk perspective.' : `Round ${String(round)}: respond to the risk manager's follow-up.`],
        )
        if (round === 1) {
          await spawnRole(`risk-${role}`, `ta-risk-${role}`, task)
        } else {
          await messageRole(`risk-${role}`, task)
        }
      }))
      await Promise.all(RISK_ROLES.map(async role => {
        const artifact = artifactByRole.get(role) ?? ''
        try {
          await waitArtifact(artifact, 'risk-debate')
          latestByRole.set(`risk-${role}`, artifact)
        } catch (error) {
          if (error instanceof StageTimeoutError) {
            manifest.degraded[`risk-${role}`] = error.message
            await persistManifest()
          } else {
            throw error
          }
        }
      }))
    }
    lastRiskPaths = [...latestByRole.values()].map(artifactPath)
    if (lastRiskPaths.length === 0) {
      throw new Error('风险评审全部超时，风险裁决缺少输入')
    }
    return lastRiskPaths.join(', ')
  }

  async function stageRiskJudgment(): Promise<string> {
    await ensureTask('risk-judgment', `风险评估：${input.ticker} ${input.date}`, 'Risk assessment stage.')
    await spawnRole('risk-manager', 'ta-risk-manager', buildTaskText(
      [artifactPath('50-trade-plan.md'), ...lastRiskPaths],
      '70-risk-assessment.md',
      ['Deliver: approved/adjusted/rejected + binding risk constraints + one-paragraph assessment.'],
    ))
    await waitArtifact('70-risk-assessment.md', 'risk-judgment')
    return artifactPath('70-risk-assessment.md')
  }

  async function stagePortfolio(): Promise<string> {
    await ensureTask('portfolio', `最终决策：${input.ticker} ${input.date}`, 'Portfolio decision stage.')
    await spawnRole('portfolio-manager', 'ta-portfolio-manager', buildTaskText(
      [artifactPath('70-risk-assessment.md'), artifactPath('50-trade-plan.md'), artifactPath('01-resolve.md')],
      '80-decision.md',
      [
        `Also write the machine-readable decision to: ${decisionJsonPath}`,
        `Use runId "${input.runId}" in decision.json.`,
        'decision.json fields: runId, ticker, date, action (BUY|SELL|HOLD), confidence (0..1), rationale, optional quantity, optional refPrice, optional reflection (one paragraph, persisted to memory).',
      ],
    ))
    await waitArtifact('80-decision.md', 'portfolio')
    const raw = await fs.readText(await fs.resolve(decisionJsonPath))
    const parsed = decisionSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      throw new Error(`decision.json 校验失败：${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
    }
    const d = parsed.data
    decision = {
      runId: d.runId,
      ticker: d.ticker,
      date: d.date,
      action: d.action,
      confidence: d.confidence,
      rationale: d.rationale,
      ...(d.quantity === undefined ? {} : { quantity: d.quantity }),
      ...(d.refPrice === undefined ? {} : { refPrice: d.refPrice }),
      ...(d.reflection === undefined ? {} : { reflection: d.reflection }),
    }
    manifest.decision = decision
    await persistManifest()
    emit('tradingagents:decision', { runId: input.runId, decision })
    return `${artifactPath('80-decision.md')} + ${decisionJsonPath}`
  }

  async function stageMemory(): Promise<string> {
    if (decision === undefined) {
      throw new Error('memory 阶段缺少 decision（内部不变量被破坏）')
    }
    // 历史日期回填 realized return（1y 行情窗口内的入场日）；当日决策留待未来 run 评估。
    const evaluation = input.date < todayIso()
      ? await realizedReturns(input.ticker, input.date, todayIso(), config.marketDataSource)
      : { evaluated: false, rawReturn: null, alphaVsBenchmark: null }
    const record: MemoryRecord = {
      runId: input.runId,
      ticker: input.ticker,
      date: input.date,
      action: decision.action,
      confidence: decision.confidence,
      entryRefPrice: decision.refPrice ?? null,
      evaluation: {
        evaluated: evaluation.evaluated,
        rawReturn: evaluation.rawReturn,
        alphaVsBenchmark: evaluation.alphaVsBenchmark,
      },
      reflection: decision.reflection ?? '（组合经理未提供反思）',
    }
    await appendDecision(fs, config.dataDir, record)
    return artifactPath('80-decision.md')
  }

  const stages: { readonly [K in StageName]: () => Promise<string> } = {
    resolve: stageResolve,
    analysts: stageAnalysts,
    'research-debate': stageResearchDebate,
    'research-judgment': stageResearchJudgment,
    'trade-plan': stageTradePlan,
    'risk-debate': stageRiskDebate,
    'risk-judgment': stageRiskJudgment,
    portfolio: stagePortfolio,
    memory: stageMemory,
  }

  emit('tradingagents:run-started', {
    runId: input.runId,
    ticker: input.ticker,
    date: input.date,
    analysts: input.analysts,
  })
  for (const stage of STAGE_NAMES) {
    manifest.stage = stage
    await persistManifest()
    let output: string
    try {
      output = await stages[stage]()
    } catch (error) {
      manifest.status = 'failed'
      await persistManifest()
      emit('tradingagents:run-failed', {
        runId: input.runId,
        stage,
        reason: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
      })
      throw error
    }
    emit('tradingagents:stage-completed', { runId: input.runId, stage, summary: output })
  }
  manifest.status = 'completed'
  await persistManifest()
  if (decision === undefined) {
    throw new Error('状态机完成但缺少 decision（内部不变量被破坏）')
  }
  return decision
}
