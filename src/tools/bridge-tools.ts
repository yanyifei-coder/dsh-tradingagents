/**
 * 桥工具层：AkShare 桥客户端的懒启动 + A 股财务工具注册。
 * 仅当 Config.dataBridge.enabled 时由 index.ts 调用；subprocess 服务缺失时 fail loud。
 * 契约：parameters 为裸 JSON Schema；execute 返回 JSON 字符串（output.schema = string）。
 */
import { AkshareBridgeClient } from '../bridge/akshare.ts'
import { startBridgeTransport } from '../bridge/transport.ts'
import type { DshSubprocess, ToolDefinition } from '../dsh-types.ts'
import type { TradingAgentsConfig } from '../config.ts'

export interface BridgeToolsDeps {
  /** 允许显式传 undefined（ctx.subprocess 为可选服务）。 */
  readonly subprocess: DshSubprocess | undefined
  readonly dataBridge: TradingAgentsConfig['dataBridge']
}

export interface BridgeToolsBundle {
  readonly tools: readonly ToolDefinition[]
  /** 关闭桥进程（若已启动）；用于插件 teardown。 */
  close(): void
}

/** A 股代码 → 新浪三大报表接口的 stock 参数（sh/sz 前缀）。 */
function sinaStockCode(symbol: string): string {
  if (symbol.startsWith('6')) {
    return `sh${symbol}`
  }
  if (symbol.startsWith('0') || symbol.startsWith('3')) {
    return `sz${symbol}`
  }
  throw new Error(`暂不支持的新浪报表代码：${symbol}（当前仅覆盖沪深 6/0/3 开头）`)
}

function requireSymbol(args: Record<string, unknown>): string {
  const value = args.symbol
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) {
    throw new Error('symbol 必填（6 位 A 股代码，如 600519）')
  }
  return value
}

const STRING_OUTPUT = {
  schema: { type: 'string', description: 'JSON-serialized result' },
  render: (_args: unknown, value: unknown): unknown => [{ type: 'text', text: String(value) }],
} as const

/** 创建桥工具（懒启动：首个调用才拉起桥进程；close 幂等）。 */
export function createBridgeTools(deps: BridgeToolsDeps): BridgeToolsBundle {
  let client: AkshareBridgeClient | undefined
  let starting: Promise<AkshareBridgeClient> | undefined

  const getBridge = (): Promise<AkshareBridgeClient> => {
    if (client !== undefined) {
      return Promise.resolve(client)
    }
    if (starting !== undefined) {
      return starting
    }
    if (deps.subprocess === undefined) {
      return Promise.reject(new Error('运行环境未提供 subprocess 服务，无法启动 AkShare 桥（dataBridge.enabled 已开启）'))
    }
    starting = startBridgeTransport(deps.subprocess, {
      command: deps.dataBridge.pythonPath ?? 'python',
      args: [deps.dataBridge.scriptPath],
    }).then(transport => {
      const created = new AkshareBridgeClient(transport, {
        readyTimeoutMs: deps.dataBridge.readyTimeoutMs,
        callTimeoutMs: deps.dataBridge.callTimeoutMs,
      })
      client = created
      return created
    })
    return starting
  }

  const financialTool: ToolDefinition = {
    name: 'ta_get_a_share_financial',
    description: 'A股财务指标（新浪源，经 AkShare 桥）：ROE、毛利率、负债率等历年指标。symbol 用 6 位代码（如 600519）。startYear 缺省 2020。',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '6 位 A 股代码' },
        startYear: { type: 'string', description: '起始年份 YYYY，缺省 2020' },
      },
      required: ['symbol'],
    },
    output: STRING_OUTPUT,
    execute: async (args, _exec) => {
      const symbol = requireSymbol(args)
      const startYear = typeof args.startYear === 'string' ? args.startYear : '2020'
      const bridge = await getBridge()
      const records = await bridge.call('stock_financial_analysis_indicator', { symbol, start_year: startYear })
      return JSON.stringify({ symbol, rowCount: records.length, records: records.slice(-8) }, null, 2)
    },
  }

  const reportTool: ToolDefinition = {
    name: 'ta_get_a_share_report',
    description: 'A股三大报表（新浪源，经 AkShare 桥）：资产负债表 / 利润表 / 现金流量表。symbol 用 6 位代码。',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '6 位 A 股代码' },
        statement: { type: 'string', description: '报表类型：资产负债表 | 利润表 | 现金流量表，缺省 利润表' },
      },
      required: ['symbol'],
    },
    output: STRING_OUTPUT,
    execute: async (args, _exec) => {
      const symbol = requireSymbol(args)
      const statement = typeof args.statement === 'string' ? args.statement : '利润表'
      const bridge = await getBridge()
      const records = await bridge.call('stock_financial_report_sina', { stock: sinaStockCode(symbol), symbol: statement })
      return JSON.stringify({ symbol, statement, rowCount: records.length, records: records.slice(-8) }, null, 2)
    },
  }

  return {
    tools: [financialTool, reportTool],
    close: () => {
      client?.close()
      client = undefined
      starting = undefined
    },
  }
}
