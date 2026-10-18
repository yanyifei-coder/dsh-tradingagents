/**
 * 会话事件载荷。
 *
 * 落地时：把下列 5 个事件以 declaration merging 并入真实 `SessionEventMap`
 * （模块名以 packages/core 的事件定义为准）。每个成员需要 `@mode read` 与
 * payload `@param` 的 JSDoc；事件载荷只带路径与摘要，不带报告全文，
 * 以满足 model-visible ⟺ logged 且不膨胀会话日志。
 */
import type { RunId } from './ids.ts'
import type { AnalystKind, Decision, StageName } from './types.ts'

/** 本插件贡献的全部会话事件名。 */
export const TA_SESSION_EVENTS = [
  'tradingagents:run-started',
  'tradingagents:stage-completed',
  'tradingagents:debate-round',
  'tradingagents:decision',
  'tradingagents:run-failed',
] as const

export type TaEventName = (typeof TA_SESSION_EVENTS)[number]

/** 事件名 → 载荷类型（与真实 SessionEventMap 合并时逐条对照）。 */
export interface TaEventPayloads {
  readonly 'tradingagents:run-started': {
    readonly runId: RunId
    readonly ticker: string
    readonly date: string
    readonly analysts: readonly AnalystKind[]
  }
  readonly 'tradingagents:stage-completed': {
    readonly runId: RunId
    readonly stage: StageName
    readonly artifactPath?: string
    readonly summary: string
  }
  readonly 'tradingagents:debate-round': {
    readonly runId: RunId
    readonly team: 'research' | 'risk'
    readonly round: number
    readonly paths: readonly string[]
  }
  readonly 'tradingagents:decision': {
    readonly runId: RunId
    readonly decision: Decision
  }
  readonly 'tradingagents:run-failed': {
    readonly runId: RunId
    readonly stage: StageName
    readonly reason: string
  }
}

/** 事件发射接缝（由 index.ts 用真实会话事件总线构造，见 dsh-types.ts 的 VERIFY）。 */
export type EmitTaEvent = <K extends TaEventName>(name: K, payload: TaEventPayloads[K]) => void
