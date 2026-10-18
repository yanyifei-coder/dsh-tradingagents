# dsh-tradingagents-teams

把 [TradingAgents](https://github.com/TauricResearch/TradingAgents)（TauricResearch 的多智能体 LLM 金融交易研究框架）重排为 DeepSeek Harness（Cordis）插件：**LangGraph 编排图 → DSH Agent Teams**（Lead + teammates + 共享任务板 + 消息）。保留原版的角色分工、辩论协议与反思记忆；放弃 LangGraph 运行时与 Python 数据栈，数据工具用 TypeScript + 公共 HTTP 重写。

> 命名说明：本插件的包名是 `dsh-tradingagents-teams`、cordis 入口 id 是 `tradingagents-teams`。社区另有一个同主题但独立的实现（包名 `dsh-tradingagents`、入口 id `tradingagents`）。两者入口 id 不同，可以在同一个 profile 内共存而不会互相覆盖。

## 能力

| 能力 | 说明 |
|---|---|
| 8 个模型工具 | `start_trading_analysis`、`ta_run_status`、`ta_get_market_data`、`ta_get_fundamentals`、`ta_get_news`、`ta_get_sentiment`，以及仅在 `dataBridge.enabled` 时注册的 `ta_get_a_share_financial`、`ta_get_a_share_report` |
| 13 个角色预设 | 4 分析师（技术 / 新闻 / 舆情 / 基本面）、多空研究员、研究经理、交易员、风险三视角、风险经理、组合经理 |
| 9 阶段编排 | `resolve → analysts → research-debate → research-judgment → trade-plan → risk-debate → risk-judgment → portfolio → memory`，跑在后台 job 中，`manifest.json` 作为恢复点 |
| 数据面 | 腾讯行情（默认）或 Yahoo；SEC EDGAR 基本面（可回退 Yahoo）；新闻 + `web.search` 兜底；StockTwits / Reddit 情绪；可选 akshare 桥补齐 A 股财务 |
| 记忆 | `<dataDir>/memory/decisions.jsonl` 跨 run 注入；`realizedReturns` 计算历史决策的实现收益 |

## 安装

三种安装来源任选其一，装完都需要让宿主重新加载 profile：

```bash
# 1) npm（发布后可用）
dsh plugin --profile <profile> add dsh-tradingagents-teams

# 2) GitHub Release 预构建 tarball（无需本地构建）
dsh plugin --profile <profile> add "https://github.com/yanyifei-coder/dsh-tradingagents/releases/download/<tag>/dsh-tradingagents-teams-<version>.tgz"

# 3) 本地源码（开发用）
dsh plugin --profile <profile> add link:/path/to/dsh-tradingagents
```

桌面版（Electron 宿主）用其自带的 CLI 垫片执行同一命令，例如
`"<安装目录>/resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop add ...`；普通 `dsh` CLI 会拒绝 `desktop` profile。

安装后 profile 的 `package.json` 会登记依赖，`cordis.patch.yml` 会插入本插件：

```yaml
- insert:
    - id: tradingagents-teams
      name: dsh-tradingagents-teams
      disabled: false
```

重启对应宿主（`dsh web` / 桌面应用）后，工具与预设生效。

## 配置

Config 由 zod 校验，全部字段带默认值，只需覆盖要改的字段：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `selectedAnalysts` | `['market','news','sentiment','fundamentals']` | 启用的分析师（并行运行） |
| `maxDebateRounds` | `1` | 多空辩论轮数（1–5） |
| `maxRiskRounds` | `1` | 风险辩论轮数（1–3） |
| `marketDataSource` | `tencent` | `tencent`（CN 可达）或 `yahoo`（海外部署） |
| `dataBridge.enabled` | `false` | 启用 akshare 桥后注册两个 A 股财务工具 |
| `dataBridge.pythonPath` / `scriptPath` | PATH 上的 `python` / `bridge/akshare_bridge.py` | 桥进程解释器与脚本 |
| `dataBridge.readyTimeoutMs` / `callTimeoutMs` | `120000` / `60000` | 桥就绪与单次调用上限 |
| `decisionLanguage` | `中文` | 报告与决策语言 |
| `dataDir` | `tradingagents-data` | runs 与记忆的根目录（相对 workspace） |
| `secEdgarUserAgent` | `''` | EDGAR 合规联系方式；为空时该源不可用 |
| `teammateProvider` | `spawn` | 队友子代理的 provider id |
| `stageTimeoutMs` | `900000` | 单阶段等待 teammate 上限 |
| `optionalCredentialRefs` | `{}` | 可选数据源凭据 ref（经 credentials 服务解析） |
| `memory.maxInject` | `3` | 记忆注入条数上限 |

## 使用

```text
用户（Team Lead）: 请分析 NVDA，分析日 2026-09-23
  └─ start_trading_analysis { ticker: "NVDA", date: "2026-09-23", analysts: [...], maxDebateRounds: 2 }
       → runId / jobId（后台编排）
  └─ ta_run_status { runId }
       → 阶段 / 降级 / 最终决策
```

产物：`<dataDir>/runs/<runId>/`（`manifest.json` + 各阶段 artifact + `decision.json`）与 `<dataDir>/memory/decisions.jsonl`。

## 开发

```bash
pnpm install
pnpm run build      # esbuild 打包 src/index.ts → lib/index.js
pnpm run typecheck  # tsc --noEmit（strict）
pnpm test           # node:test 单测
```

| 文件 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 核心设计：拓扑、artifact 协议、状态机、事件、Config、数据工具、记忆、与原版差异 |
| `src/orchestrator.ts` | 9 阶段编排状态机 |
| `src/presets.ts` | 13 个角色预设文本 |
| `src/tools/*` | 8 个工具的实现（含腾讯行情、指标、HTTP 基础） |
| `src/bridge/akshare.ts` + `bridge/akshare_bridge.py` | akshare stdio JSON 桥（函数白名单） |
| `src/dsh-types.ts` | 对 DSH / Cordis 服务类型的集中假设（宿主升级时首先校正此处） |
| `scripts/probe-*.mjs` / `scripts/probe-*.py` | 数据源与桥的连通性探针 |
| `scripts/asar*.mjs` | 在本机生成并检索 `asar-index.json` 的调查脚本（该文件不入库，可随时重新生成） |
| `test/*.test.ts` | 单测（node:test，零额外依赖） |

参考实现：上游 [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) 与中文增强版 [hsliuping/TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)。

## 声明

研究用途，非金融、投资或交易建议；LLM 决策具有非确定性，与原版一致（见原版 README 的 Reproducibility 一节）。
