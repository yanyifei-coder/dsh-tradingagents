/**
 * 编排状态机 e2e：假队友（按 artifact 协议解析任务文本并回写产物）+ 内存文件系统。
 * 覆盖：9 阶段正常路径、分析师超时降级、decision.json 非法失败。
 * 不触网：分析日期取当日，使 realizedReturns 评估分支短路。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { runPipeline, type PipelineStartInput } from '../src/orchestrator.ts'
import type { TradingAgentsConfig } from '../src/config.ts'
import type {
  AgentHandle,
  CreateTeamTaskRequest,
  DshAgentTeams,
  DshContext,
  SendTeamMessageRequest,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamTaskView,
  TeamWaitResult,
} from '../src/dsh-types.ts'
import type { EmitTaEvent, TaEventName, TaEventPayloads } from '../src/events.ts'
import { newRunId, toAnalysisDate, toTickerSymbol, todayIso } from '../src/ids.ts'
import { STAGE_NAMES } from '../src/types.ts'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** 内存文件系统：orchestrator 只用 resolve/readText/writeText 三件套。 */
class FakeFs {
  private readonly files = new Map<string, string>()

  async resolve(path: string): Promise<string> {
    return path
  }

  async readText(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`)
    }
    return content
  }

  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  write(path: string, content: string): void {
    this.files.set(path, content)
  }

  get(path: string): string {
    const content = this.files.get(path)
    assert.ok(content !== undefined, `缺少文件：${path}`)
    return content
  }

  has(path: string): boolean {
    return this.files.has(path)
  }
}

/** 平台契约：agentTeams 的 prompt/content 是内容块数组；假队友把文本块拼回任务全文。 */
function fakeTaskText(parts: readonly { readonly type: 'text'; readonly text: string }[]): string {
  return parts.map(part => part.text).join('\n')
}

interface SimulatedTeammate {
  readonly roleKey: string
  lastTask: string
}

/** 假团队：解析任务文本中的 artifact 路径并延时回写，模拟真实 teammate 的产出协议。 */
class FakeAgentTeams implements DshAgentTeams {
  private readonly fs: FakeFs
  private readonly options: { skip?: ReadonlySet<string>; invalidDecision?: boolean }
  private readonly teammates = new Map<string, SimulatedTeammate>()
  private taskSeq = 0

  constructor(
    fs: FakeFs,
    options: { skip?: ReadonlySet<string>; invalidDecision?: boolean } = {},
  ) {
    this.fs = fs
    this.options = options
  }

  membership(_agent: AgentHandle): { role: 'lead' } {
    return { role: 'lead' }
  }

  tryMembership(_agent: AgentHandle): { role: 'lead' } | undefined {
    return { role: 'lead' }
  }

  listMembers(_agent: AgentHandle): readonly TeamMemberView[] {
    return []
  }

  spawnTeammate(_caller: AgentHandle, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    const roleKey = this.roleKeyOf(request.name)
    const task = fakeTaskText(request.prompt)
    assert.equal(request.context, 'fresh')
    assert.ok(request.provider.length > 0, 'spawn 请求缺少 provider')
    assert.ok(!request.signal.aborted, 'spawn 请求 signal 已中止')
    this.teammates.set(request.name, { roleKey, lastTask: task })
    setTimeout(() => this.simulateWork(roleKey, task), 5)
    return Promise.resolve({ member: { id: `member-${request.name}`, name: request.name } })
  }

  async sendMessage(_caller: AgentHandle, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    const teammate = this.teammates.get(request.target)
    assert.ok(teammate !== undefined, `未知 teammate：${request.target}`)
    const task = fakeTaskText(request.content)
    assert.ok(!request.signal.aborted, '消息请求 signal 已中止')
    teammate.lastTask = task
    setTimeout(() => this.simulateWork(teammate.roleKey, task), 5)
    return { messageId: `msg-${String(this.taskSeq += 1)}`, status: 'accepted' }
  }

  async createTask(_caller: AgentHandle, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    this.taskSeq += 1
    return {
      id: `task-${String(this.taskSeq)}`,
      subject: request.subject,
      description: request.description,
      status: 'pending',
      revision: 1,
    }
  }

  async waitForChange(_caller: AgentHandle, _timeoutMs: number, _signal: AbortSignal): Promise<TeamWaitResult> {
    await delay(20)
    return { timedOut: false }
  }

  getTask(): TeamTaskView {
    throw new Error('意外调用：getTask')
  }

  listTasks(): readonly TeamTaskView[] {
    throw new Error('意外调用：listTasks')
  }

  updateTask(): Promise<TeamTaskView> {
    return Promise.reject(new Error('意外调用：updateTask'))
  }

  interrupt(): { previousStatus: 'running' | 'inactive' } {
    throw new Error('意外调用：interrupt')
  }

  private roleKeyOf(name: string): string {
    const match = /^ta-(.+)-[a-z0-9]{6}$/.exec(name)
    if (match === null || match[1] === undefined) {
      throw new Error(`无法从名称解析角色：${name}`)
    }
    return match[1]
  }

  private simulateWork(roleKey: string, task: string): void {
    if (this.options.skip?.has(roleKey) === true) {
      return
    }
    const artifactMatch = /Write your deliverable to: (\S+)/.exec(task)
    assert.ok(artifactMatch !== null && artifactMatch[1] !== undefined, `任务缺少 artifact 路径（${roleKey}）`)
    const artifactPath = artifactMatch[1]
    this.fs.write(artifactPath, `模拟产出：${roleKey}\n`)
    if (roleKey === 'portfolio-manager') {
      this.writeDecision(task, artifactPath)
    }
  }

  private writeDecision(task: string, artifactPath: string): void {
    const decisionMatch = /Also write the machine-readable decision to: (\S+)/.exec(task)
    assert.ok(decisionMatch !== null && decisionMatch[1] !== undefined, 'portfolio 任务缺少 decision.json 路径')
    const decisionPath = decisionMatch[1]
    const runIdMatch = /Use runId "([^"]+)"/.exec(task)
    assert.ok(runIdMatch !== null && runIdMatch[1] !== undefined, 'portfolio 任务缺少 runId 指令')
    const runDir = artifactPath.slice(0, artifactPath.lastIndexOf('/artifacts/'))
    const resolve = this.fs.get(`${runDir}/artifacts/01-resolve.md`)
    const identity = /# Run resolve — (\S+) @ (\d{4}-\d{2}-\d{2})/.exec(resolve)
    assert.ok(identity !== null && identity[1] !== undefined && identity[2] !== undefined, 'resolve 产物缺少身份标题')
    const content =
      this.options.invalidDecision === true
        ? { runId: runIdMatch[1], ticker: identity[1], date: identity[2], action: 'MAYBE' }
        : {
            runId: runIdMatch[1],
            ticker: identity[1],
            date: identity[2],
            action: 'BUY',
            confidence: 0.62,
            rationale: '模拟组合决策',
            reflection: '模拟反思',
          }
    this.fs.write(decisionPath, JSON.stringify(content))
  }
}

interface EventEntry {
  readonly name: TaEventName
  readonly payload: TaEventPayloads[TaEventName]
}

function makeEnv(options: { skip?: ReadonlySet<string>; invalidDecision?: boolean } = {}): {
  fs: FakeFs
  events: EventEntry[]
  ctx: DshContext
  emit: EmitTaEvent
} {
  const fs = new FakeFs()
  const teams = new FakeAgentTeams(fs, options)
  const events: EventEntry[] = []
  const emit: EmitTaEvent = (name, payload) => {
    events.push({ name, payload })
  }
  const ctx: DshContext = {
    agentTeams: teams,
    jobs: {
      start: () => {
        throw new Error('意外调用：jobs.start')
      },
      list: () => [],
      get: () => {
        throw new Error('意外调用：jobs.get')
      },
      wait: async () => {
        throw new Error('意外调用：jobs.wait')
      },
      kill: () => 'requested',
      remove: () => {},
    },
    tools: {
      register: () => () => {},
    },
    agentPresets: {
      register: () => Promise.resolve(async () => {}),
    },
    credentials: {
      resolve: () => Promise.resolve(undefined),
    },
    fs,
    effects: {
      effect: setup => setup(),
      on: () => () => {},
    },
    emit,
  }
  return { fs, events, ctx, emit }
}

function makeConfig(overrides: Partial<TradingAgentsConfig> = {}): TradingAgentsConfig {
  return {
    selectedAnalysts: ['market', 'news'],
    maxDebateRounds: 1,
    maxRiskRounds: 1,
    marketDataSource: 'tencent',
    decisionLanguage: '中文',
    dataDir: 'ta-data',
    secEdgarUserAgent: '',
    teammateProvider: 'spawn',
    stageTimeoutMs: 5_000,
    optionalCredentialRefs: {},
    memory: { maxInject: 3 },
    dataBridge: { enabled: false, scriptPath: 'bridge/akshare_bridge.py', readyTimeoutMs: 120_000, callTimeoutMs: 60_000 },
    ...overrides,
  }
}

function makeInput(): { runId: string; input: PipelineStartInput } {
  const runId = newRunId()
  const input: PipelineStartInput = {
    runId,
    ticker: toTickerSymbol('600519.SS'),
    date: toAnalysisDate(todayIso()),
    analysts: ['market', 'news'],
    runDir: `ta-data/runs/${runId}`,
    lead: { id: 'lead-1' },
  }
  return { runId, input }
}

describe('编排状态机 e2e（假队友）', () => {
  it('正常路径：9 阶段完成，产出决策/记忆/manifest/全部 artifact', async () => {
    const env = makeEnv()
    const { runId, input } = makeInput()
    const decision = await runPipeline({ ctx: env.ctx, config: makeConfig(), emit: env.emit }, input, new AbortController().signal)

    assert.equal(decision.action, 'BUY')
    assert.equal(decision.reflection, '模拟反思')

    const manifest = JSON.parse(env.fs.get(`ta-data/runs/${runId}/manifest.json`))
    assert.equal(manifest.status, 'completed')
    assert.equal(manifest.stage, 'memory')
    assert.deepEqual(Object.keys(manifest.degraded), [])
    assert.ok(manifest.decision !== undefined)

    const artifactsDir = `ta-data/runs/${runId}/artifacts`
    for (const name of [
      '01-resolve.md',
      '20-analyst-market.md',
      '20-analyst-news.md',
      '30-debate-bull-1.md',
      '30-debate-bear-1.md',
      '40-research-verdict.md',
      '50-trade-plan.md',
      '60-risk-aggressive.md',
      '60-risk-neutral.md',
      '60-risk-conservative.md',
      '70-risk-assessment.md',
      '80-decision.md',
    ]) {
      assert.ok(env.fs.has(`${artifactsDir}/${name}`), `缺少 artifact：${name}`)
    }
    assert.ok(env.fs.has(`ta-data/runs/${runId}/decision.json`))

    const memory = env.fs.get('ta-data/memory/decisions.jsonl')
    const lines = memory.split('\n').filter(line => line.trim() !== '')
    assert.equal(lines.length, 1)
    const record = JSON.parse(lines[lines.length - 1] ?? '{}')
    assert.equal(record.ticker, '600519.SS')
    assert.equal(record.action, 'BUY')
    assert.equal(record.reflection, '模拟反思')
    assert.equal(record.evaluation.evaluated, false)

    assert.equal(env.events[0]?.name, 'tradingagents:run-started')
    assert.ok(!env.events.some(event => event.name === 'tradingagents:run-failed'))
    assert.equal(env.events.filter(event => event.name === 'tradingagents:decision').length, 1)
    assert.ok(env.events.some(event => event.name === 'tradingagents:debate-round'))
    const stageNames = env.events
      .filter(event => event.name === 'tradingagents:stage-completed')
      .map(event => ('stage' in event.payload ? event.payload.stage : undefined))
    assert.deepEqual(stageNames, [...STAGE_NAMES])
  })

  it('分析师超时 → 重试 → 降级为缺失，run 继续', async () => {
    const env = makeEnv({ skip: new Set(['analyst-market']) })
    const { runId, input } = makeInput()
    const decision = await runPipeline(
      { ctx: env.ctx, config: makeConfig({ stageTimeoutMs: 300 }), emit: env.emit },
      input,
      new AbortController().signal,
    )

    assert.equal(decision.action, 'BUY')
    const manifest = JSON.parse(env.fs.get(`ta-data/runs/${runId}/manifest.json`))
    assert.equal(manifest.status, 'completed')
    assert.match(manifest.degraded['analyst-market'] ?? '', /超时/)
    assert.equal(env.fs.has(`ta-data/runs/${runId}/artifacts/20-analyst-market.md`), false)
    assert.equal(env.fs.has(`ta-data/runs/${runId}/artifacts/20-analyst-news.md`), true)
    assert.ok(!env.events.some(event => event.name === 'tradingagents:run-failed'))
  })

  it('decision.json 非法 → run 失败并发出 run-failed', async () => {
    const env = makeEnv({ invalidDecision: true })
    const { runId, input } = makeInput()
    await assert.rejects(
      runPipeline({ ctx: env.ctx, config: makeConfig(), emit: env.emit }, input, new AbortController().signal),
      /decision\.json 校验失败/,
    )
    const manifest = JSON.parse(env.fs.get(`ta-data/runs/${runId}/manifest.json`))
    assert.equal(manifest.status, 'failed')
    const failed = env.events.find(event => event.name === 'tradingagents:run-failed')
    assert.ok(failed !== undefined && 'stage' in failed.payload && failed.payload.stage === 'portfolio')
  })
})
