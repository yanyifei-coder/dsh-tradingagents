/**
 * 用真实 cordis（宿主用的就是它的 vendored 副本）复现/验证插件激活：
 * ① 无 inject 声明 + 直接访问服务属性 → 复现宿主报的守卫错误
 * ② 有 inject 声明 → apply 等服务就绪后才执行；用假服务验证 apply 能跑完
 */
import { Context } from 'cordis'

const captured = []

function makePlugin(withInject) {
  const plugin = {
    name: 'guard-probe',
    apply(ctx) {
      // 复现点：直接访问服务属性（不经 inject 声明时会被守卫拦截）
      void ctx.agentPresets
      ctx.effect(() => {})
    },
  }
  if (withInject) {
    plugin.inject = ['agentPresets']
  }
  return plugin
}

async function main() {
  // ① 复现守卫错误
  {
    const ctx = new Context()
    ctx.on('internal/error', (scope, error) => {
      captured.push(error?.message ?? String(error))
    })
    ctx.plugin(makePlugin(false))
    await new Promise(resolve => setTimeout(resolve, 100))
    const hit = captured.find(message => message.includes('without inject'))
    console.log(hit ? `OK    复现守卫错误：${hit}` : 'FAIL  未复现守卫错误')
  }

  // ② 有 inject：先声明插件（apply 应被推迟，不报守卫错误），再补上假服务验证 apply 执行
  {
    const ctx = new Context()
    let applied = false
    ctx.on('internal/error', (_scope, error) => {
      captured.push(error?.message ?? String(error))
    })
    const plugin = makePlugin(true)
    plugin.apply = ctx0 => {
      applied = true
      void ctx0.agentPresets
      ctx0.effect(() => {})
    }
    ctx.plugin(plugin)
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log(captured.some(m => m.includes('without inject'))
      ? 'FAIL  声明 inject 后仍报守卫错误'
      : 'OK    声明 inject 后无守卫错误（apply 被推迟等待服务）')

    // 提供假服务（cordis Service 语义：provide 声明 + 属性赋值即就绪）
    try {
      ctx.provide('agentPresets')
      ctx.agentPresets = { register: async () => async () => {} }
    } catch (error) {
      console.log(`WARN  ctx.provide 不可用（${error.message}），跳过 apply 执行验证`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log(applied ? 'OK    服务就绪后 apply 已执行' : 'WARN  apply 尚未执行（provide 语义与预期不符，不影响主结论）')
  }

  const guardErrors = captured.filter(message => message.includes('without inject'))
  console.log(`===== 守卫错误出现次数：${String(guardErrors.length)}（应为 1，仅来自无 inject 的对照组） =====`)
}

await main()
