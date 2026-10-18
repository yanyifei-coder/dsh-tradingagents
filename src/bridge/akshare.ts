/**
 * AkShare 桥客户端与协议（最小协议 v0.1，与 bridge/akshare_bridge.py 配对）。
 *
 * 传输契约（落地时由 dsh-subprocess 句柄适配，见 DESIGN §7）：
 *   - `stdout`：进程标准输出的原始字符串块流
 *   - `write(line)`：写一行请求（调用方自行追加换行语义由 encode 保证）
 *   - `kill()`：终止进程
 * 本模块除类型外零依赖，协议部分全部纯函数、可直接单测。
 */

/** 与 bridge/akshare_bridge.py 的 ALLOWLIST 镜像；python 侧是安全边界，两份需同步维护。 */
export const AKSHARE_ALLOWLIST = {
  stock_financial_analysis_indicator: '新浪财经-财务分析-财务指标',
  stock_financial_report_sina: '新浪财经-财务报表-三大报表',
  stock_financial_abstract: '新浪财经-财务摘要',
} as const

export type AkshareAllowlistedFn = keyof typeof AKSHARE_ALLOWLIST

/** 桥进程传输契约（进程边界，落地时适配真实子进程句柄）。 */
export interface BridgeTransport {
  readonly stdout: AsyncIterable<string>
  write(line: string): void
  kill(): void
}

export interface BridgeRequest {
  readonly id: string
  readonly fn: string
  readonly params: Readonly<Record<string, unknown>>
}

export interface BridgeReady {
  readonly id: '__ready__'
  readonly ok: true
  readonly version: string
  readonly available: readonly string[]
}

export interface BridgeResponseOk {
  readonly id: string
  readonly ok: true
  readonly records: readonly Record<string, unknown>[]
  readonly rowCount: number
}

export interface BridgeResponseError {
  readonly id: string | null
  readonly ok: false
  readonly error: string
}

export type BridgeLine = BridgeReady | BridgeResponseOk | BridgeResponseError

/** 请求编码为一行 JSONL（含换行）。 */
export function encodeBridgeRequest(request: BridgeRequest): string {
  return `${JSON.stringify({ id: request.id, fn: request.fn, params: request.params })}\n`
}

/** 解析一行桥消息；空行返回 null；形状非法抛错（进程边界运行时校验）。 */
export function parseBridgeLine(line: string): BridgeLine | null {
  const trimmed = line.trim()
  if (trimmed === '') {
    return null
  }
  const parsed: unknown = JSON.parse(trimmed)
  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed) || !('id' in parsed)) {
    throw new Error('桥消息缺少 id/ok 字段')
  }
  const record = parsed as Record<string, unknown>
  if (record.id === '__ready__') {
    if (record.ok !== true || typeof record.version !== 'string' || !Array.isArray(record.available)) {
      throw new Error('ready 消息形状非法')
    }
    return { id: '__ready__', ok: true, version: record.version, available: record.available }
  }
  if (typeof record.id !== 'string' || typeof record.ok !== 'boolean') {
    throw new Error('桥消息 id/ok 类型非法')
  }
  if (record.ok) {
    if (!Array.isArray(record.records) || typeof record.rowCount !== 'number') {
      throw new Error('成功响应缺少 records/rowCount')
    }
    return {
      id: record.id,
      ok: true,
      records: record.records as Record<string, unknown>[],
      rowCount: record.rowCount,
    }
  }
  return { id: record.id, ok: false, error: typeof record.error === 'string' ? record.error : String(record.error ?? '未知错误') }
}

/** 行组装器：把任意切块的 stdout 流按行切分（容忍 \\r\\n 与半行跨块）。 */
export class LineAssembler {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const lines: string[] = []
    for (;;) {
      const index = this.buffer.indexOf('\n')
      if (index < 0) {
        break
      }
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      lines.push(line)
    }
    return lines
  }
}

/** 白名单校验（TS 端镜像；python 端为安全边界）。 */
export function isAllowlisted(fn: string): fn is AkshareAllowlistedFn {
  return Object.prototype.hasOwnProperty.call(AKSHARE_ALLOWLIST, fn)
}

export interface BridgeClientOptions {
  /** ready 等待上限（毫秒）。 */
  readonly readyTimeoutMs: number
  /** 单次调用等待上限（毫秒）。 */
  readonly callTimeoutMs: number
}

/** 桥客户端：等待 ready、按 id 配对响应、逐调用超时。 */
export class AkshareBridgeClient {
  private readonly transport: BridgeTransport
  private readonly options: BridgeClientOptions
  private readonly pending = new Map<string, { resolve: (value: BridgeResponseOk) => void; reject: (error: Error) => void }>()
  private readonly assembler = new LineAssembler()
  private readySignal: Promise<BridgeReady>
  private onReady: ((ready: BridgeReady) => void) | undefined
  private seq = 0
  private closed = false

  constructor(transport: BridgeTransport, options: BridgeClientOptions) {
    this.transport = transport
    this.options = options
    this.readySignal = this.waitReady()
    void this.consume()
  }

  /** 等待桥完成 akshare 导入并就绪；超时 fail loud。 */
  ready(): Promise<BridgeReady> {
    return this.readySignal
  }

  /** 调用一个白名单接口；返回 records。超时或桥错误 fail loud。 */
  async call(fn: AkshareAllowlistedFn, params: Readonly<Record<string, unknown>> = {}): Promise<readonly Record<string, unknown>[]> {
    if (!isAllowlisted(fn)) {
      throw new Error(`接口不在白名单：${fn}`)
    }
    await this.ready()
    if (this.closed) {
      throw new Error('桥进程已关闭')
    }
    this.seq += 1
    const id = `req-${String(this.seq)}`
    const response = await new Promise<BridgeResponseOk>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`桥调用超时（${fn}，${String(this.options.callTimeoutMs)}ms）`))
      }, this.options.callTimeoutMs)
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.transport.write(encodeBridgeRequest({ id, fn, params }))
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    if (!response.ok) {
      // parseBridgeLine 已保证 ok=true 才进入此分支；此处为类型收窄的显式不变量。
      throw new Error(`桥响应形状不一致（${fn}）`)
    }
    return response.records
  }

  /** 终止桥进程；未决调用全部失败。 */
  close(): void {
    this.closed = true
    this.transport.kill()
    for (const entry of this.pending.values()) {
      entry.reject(new Error('桥进程已关闭'))
    }
    this.pending.clear()
  }

  private async waitReady(): Promise<BridgeReady> {
    return new Promise<BridgeReady>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onReady = undefined
        reject(new Error(`桥就绪超时（${String(this.options.readyTimeoutMs)}ms）：akshare 导入过慢或桥进程异常`))
      }, this.options.readyTimeoutMs)
      this.onReady = ready => {
        clearTimeout(timer)
        this.onReady = undefined
        resolve(ready)
      }
    })
  }

  private async consume(): Promise<void> {
    try {
      for await (const chunk of this.transport.stdout) {
        for (const line of this.assembler.push(chunk)) {
          this.handleLine(line)
        }
      }
    } catch {
      // stdout 流异常：视为桥进程死亡，fail 所有未决调用。
      this.closed = true
      for (const entry of this.pending.values()) {
        entry.reject(new Error('桥进程 stdout 已终止'))
      }
      this.pending.clear()
    }
  }

  private handleLine(line: string): void {
    let message: BridgeLine | null
    try {
      message = parseBridgeLine(line)
    } catch (error) {
      // 单行解析失败不影响后续消息：fail 所有未决（可能已错位）并停止。
      this.closed = true
      const reason = error instanceof Error ? error.message : String(error)
      for (const entry of this.pending.values()) {
        entry.reject(new Error(`桥消息解析失败：${reason}`))
      }
      this.pending.clear()
      return
    }
    if (message === null) {
      return
    }
    if ('version' in message && message.id === '__ready__') {
      this.onReady?.(message)
      return
    }
    if (message.id === null) {
      // 桥对坏行的应答：无对应 pending，忽略。
      return
    }
    const pending = this.pending.get(message.id)
    if (pending === undefined) {
      return
    }
    this.pending.delete(message.id)
    if (message.ok === false) {
      pending.reject(new Error(`桥接口失败：${message.error}`))
      return
    }
    pending.resolve(message)
  }
}
