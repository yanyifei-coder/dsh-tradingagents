/**
 * dsh-subprocess 句柄 → 桥传输的适配层。
 * VERIFY：`DshSubprocess` 为目录快照推导的假设形状（subprocess.spawn(spec) → handle），
 * 落地时对照 packages/subprocess 的真实类型修正字段名。
 */
import type { BridgeTransport } from './akshare.ts'
import type { DshSubprocess } from '../dsh-types.ts'

export interface BridgeProcessSpec {
  readonly command: string
  readonly args: readonly string[]
}

/** 启动桥进程并适配为 BridgeTransport。 */
export async function startBridgeTransport(subprocess: DshSubprocess, spec: BridgeProcessSpec): Promise<BridgeTransport> {
  const handle = await subprocess.spawn({ command: spec.command, args: spec.args })
  return {
    stdout: handle.stdout,
    write: line => {
      handle.stdin.write(line)
    },
    kill: () => {
      handle.kill()
    },
  }
}
