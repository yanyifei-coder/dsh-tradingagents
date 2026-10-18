/**
 * 插件入口 —— 真实宿主形状（参照已验证的本地插件 dsh-whale-widget）：
 * `export default { name, inject?, apply(root, config) }`，贡献经 root.effect() 注册。
 */
import { parseTradingAgentsConfig } from './config.ts'
import type { DshContext, DshSubprocess } from './dsh-types.ts'
import type { EmitTaEvent } from './events.ts'
import { createBridgeTools } from './tools/bridge-tools.ts'
import { createDataTools } from './tools/data.ts'
import { createRunTools } from './tools/run.ts'

/** 运行时守卫：ctx.get('subprocess') 返回 unknown，按形状窄化为 DshSubprocess。 */
function asSubprocess(value: unknown): DshSubprocess | undefined {
  if (typeof value === 'object' && value !== null && 'spawn' in value) {
    const spawn = (value as { spawn: unknown }).spawn
    if (typeof spawn === 'function') {
      return value as DshSubprocess
    }
  }
  return undefined
}

export default {
  name: 'tradingagents-teams',
  /**
   * 服务注入声明：cordis 守卫要求先声明才能访问 ctx 上的服务属性。
   * subprocess 为可选服务（dataBridge 关闭时不需要），运行时经 root.get('subprocess') 取。
   */
  inject: ['agentPresets', 'tools', 'agentTeams', 'jobs', 'fs', 'credentials'],
  apply(root: DshContext, rawConfig: unknown): void {
    const config = parseTradingAgentsConfig(rawConfig ?? {}, 'tradingagents-teams')
    if (config.secEdgarUserAgent === '') {
      // 配置不完整在加载期显式提示：EDGAR 源将不可用，fundamentals 仅剩 Yahoo 回退。
      console.warn('[tradingagents-teams] secEdgarUserAgent 未配置：ta_get_fundamentals 的 SEC EDGAR 源不可用，仅走 Yahoo 回退。')
    }
    const emit: EmitTaEvent = (name, payload) => {
      // VERIFY：接入真实会话事件总线（model-visible ⟺ logged）。
      // 骨架阶段打到 host 控制台保证可观测；manifest.json 同步记录阶段推进。
      console.info(`[tradingagents-teams] ${name}: ${JSON.stringify(payload)}`)
    }

    // 角色提示词（TA_PRESETS）由编排器在 spawn 时内联进 teammate 任务文本，
    // 不注册为 agent preset：DSH 的 agent preset 是"agent 的完整组合声明"
    // （plugins 行列表 + mount 组合树，见 preset-registry 的 register/activate），
    // 把角色当 preset 注册会因缺少 plugins 字段而加载失败，组合语义也不匹配。
    // 角色化的正确机制（组合声明 + systemPrompt 注入）留待 M3 按真实架构重设计。

    for (const tool of [...createDataTools(config, root), ...createRunTools({ ctx: root, config, emit })]) {
      root.effect(() => root.tools.register(tool))
    }

    if (config.dataBridge.enabled) {
      const bundle = createBridgeTools({
        subprocess: asSubprocess(typeof root.get === 'function' ? root.get('subprocess') : undefined),
        dataBridge: config.dataBridge,
      })
      root.effect(() => {
        const disposers = bundle.tools.map(tool => root.tools.register(tool))
        return () => {
          for (const disposer of disposers) {
            disposer()
          }
          bundle.close()
        }
      })
    }
  },
}
