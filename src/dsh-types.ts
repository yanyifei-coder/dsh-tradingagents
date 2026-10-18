/**
 * 对 DSH / Cordis 服务类型的集中假设 —— 本骨架的唯一定制接缝。
 *
 * 方法签名来自对运行时 Service inspect provider 的目录快照（2026-10-02），
 * 请求/视图对象的字段名取自同形的工具 schema，未经类型确认。
 * 带 `VERIFY` 标记的条目是落地时必须对照真实 `.d.ts` 校正的假设。
 *
 * 落地第一步：删除本文件的假设类型，改为从 `@deepseek-ai/cordis` 与各服务包
 * re-export 真实类型（名字对照 Service inspect 目录），消费者代码不需改动。
 */
import type { EmitTaEvent } from './events.ts'
import type { TradingAgentsConfig } from './config.ts'

export type { EmitTaEvent, TradingAgentsConfig }

// ---------- 通用 ----------

/** VERIFY：假设 fs.resolve 接受路径字符串并原样回传（真实包中可能为不透明句柄，落地时替换）。 */
export type FsTarget = string

/** VERIFY：Agent 句柄实证为对象（tool-jobs 源码使用 exec.agent?.id）；其余字段随真实类型补充。 */
export interface AgentHandle {
  readonly id: string
}

// ---------- agentTeams ----------

export type TeamRole = 'lead' | 'member'

/** VERIFY：字段名待对照 agentTeams 包类型。 */
export interface TeamMembership {
  readonly role: TeamRole
}

/** 消息内容部件：agentTeams 的 prompt/content 一律是内容块数组（字符串会被当成块数组展开成单字符）。 */
export interface TeamContentPart {
  readonly type: 'text'
  readonly text: string
}

/**
 * 真实契约（安装副本 dsh-experimental-agent-team spawnAdmitted 实证）：
 * - name 校验 lower-kebab-case 且 ≤64 字符；
 * - provider 必填（tool-agent-team 默认 'spawn'/'fork'）；
 * - signal 必填：AbortSignal.any([request.signal, lifecycle.signal]) 与 throwIfAborted 直接解引用，
 *   缺失（undefined）会抛 "signals[0] is not of type AbortSignal"。
 */
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: readonly TeamContentPart[]
  readonly context?: 'fresh' | 'fork'
  readonly provider: string
  readonly signal: AbortSignal
}

/** spawnTeammate 返回 { member }（memberView），name 即 send_message 的 target。 */
export interface SpawnTeammateResult {
  readonly member: {
    readonly id: string
    readonly name: string
  }
}

export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: readonly TeamContentPart[]
  readonly signal: AbortSignal
}

export interface SendTeamMessageResult {
  readonly messageId: string
  readonly status: 'accepted' | 'queued'
}

export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed'

export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  /** VERIFY：工具层参数名为 blocked_by / write_scopes。 */
  readonly blockedBy?: readonly string[]
  readonly writeScopes?: readonly string[]
}

export interface TeamTaskView {
  readonly id: string
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly revision: number
  readonly ownerName?: string
  readonly blockedBy?: readonly string[]
  readonly writeScopes?: readonly string[]
}

export interface UpdateTeamTaskRequest {
  readonly taskId: string
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly owner?: string
  readonly writeScopes?: readonly string[]
  readonly blockedBy?: readonly string[]
}

/** waitForChange 返回：是否因超时而结束（false 表示观察到真实变更）。 */
export interface TeamWaitResult {
  readonly timedOut: boolean
}

export interface TeamMemberView {
  readonly name: string
  readonly description: string
  readonly status: 'running' | 'inactive' | 'provisioning' | 'failed'
}

/** 目录快照：agentTeams 服务（签名对照安装副本 dsh-experimental-agent-team 实证）。 */
export interface DshAgentTeams {
  membership(agent: AgentHandle): TeamMembership
  tryMembership(agent: AgentHandle): TeamMembership | undefined
  listMembers(agent: AgentHandle): readonly TeamMemberView[]
  spawnTeammate(caller: AgentHandle, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>
  sendMessage(caller: AgentHandle, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>
  createTask(caller: AgentHandle, request: CreateTeamTaskRequest): Promise<TeamTaskView>
  getTask(caller: AgentHandle, id: string): TeamTaskView
  listTasks(caller: AgentHandle): readonly TeamTaskView[]
  updateTask(caller: AgentHandle, request: UpdateTeamTaskRequest): Promise<TeamTaskView>
  /** timeoutMs 合法区间 10000–3600000（TeamActivity.wait 实证），signal 必填。 */
  waitForChange(caller: AgentHandle, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>
  interrupt(caller: AgentHandle, targetName: string): { readonly previousStatus: 'running' | 'inactive' }
}

// ---------- jobs ----------

/**
 * VERIFY：JobSpec 真实契约（dsh-jobs-local start() 源码实证）：
 * - kind 必填非空（job id 前缀）；label 必填非空
 * - owner 可选：会话 id，任务归其名下（完成通知投递 + 按 owner 可见）
 * - run(handle) 返回 hooks：done(Promise，结算 {status, detail?}) + cancel()
 * - handle = { id, append(text, options?), updateProgress(line) }
 */
export interface JobSpec {
  readonly kind: string
  readonly label: string
  readonly owner?: string
  readonly outputLimitBytes?: number
  run(handle: JobHandle): JobHooks
}

export interface JobHandle {
  readonly id: string
  append(text: string, options?: unknown): void
  updateProgress(line: string): void
}

export interface JobHooks {
  readonly done: Promise<{ readonly status: 'completed' | 'failed' | 'killed'; readonly detail?: string }>
  cancel(): void
}

export type JobStatus = 'running' | 'finished'

export interface JobView {
  readonly id: string
  readonly status: JobStatus
  readonly error?: string
}

/** 目录快照：jobs 服务。 */
export interface DshJobs {
  start(spec: JobSpec): string
  list(caller?: string): readonly JobView[]
  get(id: string, caller?: string): JobView
  wait(id: string, timeoutMs: number, caller?: string, signal?: AbortSignal): Promise<JobView>
  kill(id: string, caller?: string, reason?: string): 'requested' | 'already-finished'
  remove(id: string, caller?: string): void
}

// ---------- tools / presets / credentials / fs / web ----------

/** 工具执行上下文。VERIFY：真实 exec 形状（cwd 与 agent 的来源）。 */
export interface ToolExecutionContext {
  readonly agent: AgentHandle
  readonly cwd: string
  readonly signal: AbortSignal
}

/**
 * 真实工具定义（从宿主 dsh-tools register 校验与 defineTool 源码实证）：
 * - parameters：裸 JSON Schema 对象根（{ type:'object', properties, required }）
 * - output：{ schema（原始 JSON Schema 值声明）, render(args, value)（纯 UI 投影）, presentationMeta? }
 * - execute 返回值即候选 value，宿主用 output.schema 校验后交给 render
 */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: Record<string, unknown>, value: unknown): unknown
  }
  execute(args: Record<string, unknown>, exec: ToolExecutionContext): Promise<unknown>
  readonly timeoutMs?: number
}

export interface DshTools {
  register(definition: ToolDefinition): () => void
}

/** VERIFY：PresetDefinition 字段名待对照 agentPresets 包。 */
export interface PresetDefinition {
  readonly id: string
  readonly description: string
  readonly systemPrompt: string
  readonly tools?: readonly string[]
}

export interface DshAgentPresets {
  register(definition: PresetDefinition): Promise<() => Promise<void>>
}

/** VERIFY：resolve 返回的凭据值字段名。 */
export interface ResolvedCredential {
  readonly value: string
}

export interface DshCredentials {
  resolve(ref: string): Promise<ResolvedCredential | undefined>
}

/** 只声明本插件用到的子集；目录快照见 DESIGN.md。 */
export interface DshFs {
  resolve(path: string, opts?: { readonly cwd?: string }): Promise<FsTarget>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  writeText(target: FsTarget, content: string, signal?: AbortSignal): Promise<unknown>
}

/** VERIFY：WebSearchRequest/Result 字段名待确认；仅在 news 兜底使用。 */
export interface DshWeb {
  search(request: { readonly query: string }, signal?: AbortSignal): Promise<{
    readonly results: readonly { readonly title: string; readonly url: string }[]
  }>
}

// ---------- 插件上下文 ----------

/** VERIFY：子进程句柄假设（桥传输适配用；对照 packages/subprocess 真实类型后修正）。 */
export interface DshSubprocessHandle {
  readonly stdin: { write(chunk: string): void }
  readonly stdout: AsyncIterable<string>
  kill(): void
}

/** VERIFY：子进程服务假设（Service 目录快照：subprocess.spawn(spec) → handle）。 */
export interface DshSubprocess {
  spawn(spec: { readonly command: string; readonly args?: readonly string[] }): Promise<DshSubprocessHandle>
}

/**
 * 插件根上下文。形状经本地已安装插件 dsh-whale-widget 源码实证：
 * `root.effect(setup)` 返回 disposer、`root.on(event, listener)` 返回 disposer、
 * 服务即 ctx 属性（ctx.credentials/ctx.webServer…，名字 = Service 目录 key）。
 * 其余成员仍为假设（VERIFY），落地时对照真实 Context 类型替换。
 */
export interface DshContext {
  effect(setup: () => (() => void | Promise<void>)): () => void
  on(event: string, listener: (payload: unknown) => void): () => void
  /** 可选服务/延迟服务的官方访问后门（whale-widget 实证：ctx.get('deepseekAccount')）。 */
  get?(name: string): unknown
  readonly agentTeams: DshAgentTeams
  readonly jobs: DshJobs
  readonly tools: DshTools
  readonly agentPresets: DshAgentPresets
  readonly credentials: DshCredentials
  readonly fs: DshFs
  readonly web?: DshWeb
  /** 可选：桥等子进程能力依赖此服务；未提供时 dataBridge 工具不可用。 */
  readonly subprocess?: DshSubprocess
  /**
   * 会话事件发射接缝。VERIFY：接入真实会话事件总线（model-visible ⟺ logged）。
   * 骨架默认实现只写控制台，落地时替换。
   */
  readonly emit: EmitTaEvent
}

/**
 * 真实插件导出形状（dsh-whale-widget 实证）：默认导出 `{ name, apply(root, config) }`。
 * config 由 loader entry 的 config 块注入。
 */
export interface DshPluginObject {
  readonly name: string
  apply(root: DshContext, config: unknown): void
}

/** 构造编排所需的闭包依赖包，避免各模块直接持有整个 ctx。 */
export interface PipelineDeps {
  readonly ctx: DshContext
  readonly config: TradingAgentsConfig
  readonly emit: EmitTaEvent
}
