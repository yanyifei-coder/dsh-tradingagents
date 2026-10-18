# TradingAgents × DSH 原生团队重排设计（路径 B）

把 [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) 的 LangGraph 编排图逐节点映射到 DSH Agent Teams（Lead + teammates + 共享任务板 + 消息），以一个 Cordis 插件交付。保留原版的角色分工、辩论协议、反思记忆；放弃 LangGraph 运行时与 Python 数据栈，数据工具用 TypeScript + 公共 HTTP 重写。

本仓库当前是**设计 + 可校正骨架**：所有对 DSH 服务类型的假设集中在 `src/dsh-types.ts`，落地到真实 DSH 开发仓库时只需要校正这一个文件加 `cordis.yml` 字段名。

## 1. 运行拓扑

```text
用户主会话（Team Lead）
  └─ 调用 start_trading_analysis 工具（一次调用 = 一个 run）
      └─ jobs.start(编排任务)                      ← 状态机跑在后台 job 里
          ├─ Stage 1  resolve      无 LLM：ticker 归一化、日期校验、记忆注入组装
          ├─ Stage 2  analysts     4 个并行 teammate（按 Config 选择）
          ├─ Stage 3  debate       bull/bear 轮流，maxDebateRounds 轮
          ├─ Stage 4  judgment     research-manager 裁决
          ├─ Stage 5  trade        trader 出交易方案
          ├─ Stage 6  risk         aggressive/neutral/conservative 并行辩论
          ├─ Stage 7  risk-mgr     risk-manager 评估（可否决）
          ├─ Stage 8  portfolio    portfolio-manager 出最终 Decision + 反思
          └─ Stage 9  memory       无 LLM：决策追加到 decisions.jsonl
```

两条硬约束决定整体形态：

1. **spawnTeammate 仅 Lead 可调。** 编排必须运行在 Lead 会话上下文内：插件注册的 `start_trading_analysis` 工具执行时携带调用方 Agent，先用 `agentTeams.tryMembership` 校验 Lead 身份，非 Lead 调用立即失败（fail loud），绝不静默降级。
2. **一次完整分析是长任务。** 编排放进 `jobs` 后台执行，工具立即返回 `{runId, jobId, artifactsDir}`；进度通过会话事件和任务板对用户可见，Lead/用户可随时 `interrupt` 某 teammate。

## 2. Artifact 协议（队友间怎么传数据）

每个 run 一个目录：`<dataDir>/runs/<runId>/`

```text
manifest.json                    状态机当前阶段、参与者、任务板任务 id、可恢复点
artifacts/01-resolve.md          输入摘要与记忆注入文本
artifacts/20-analyst-market.md   各分析师报告（20-23）
artifacts/30-debate-bull-1.md    每轮辩论立论/反驳（按轮编号）
artifacts/40-research-verdict.md 研究经理裁决
artifacts/50-trade-plan.md       交易方案
artifacts/60-risk-*.md           风险三方报告
artifacts/70-risk-assessment.md  风险经理评估
artifacts/80-decision.md         最终决策报告（人读）
decision.json                    结构化决策（机读，记忆管道消费）
```

规则：

- 每个 teammate 完成阶段时把**完整产出写入自己的 artifact 文件**，然后 `sendMessage` 只回执文件路径 + ≤5 行摘要。
- 编排器用 `fs.readText` 读文件驱动下一阶段；不抓取 teammate 消息正文。理由：消息正文落在各 teammate 自己的会话日志里，跨会话读取依赖未在本次运行时确认的 API；文件写入是 DSH 智能体的原生能力，且自动进入 workspace 变更摘要，天然双轨可审计（文件 + 会话日志）。
- 文件即恢复点：manifest.json 每阶段推进即更新，M2 实现 crash 后从 manifest 恢复（对应原版 LangGraph checkpoint resume）。

## 3. 状态机

阶段枚举是闭合 union（`StageName`），dispatch 循环以 `assertNever` 收尾。每阶段语义：

| # | 阶段 | 参与者（preset） | 并行 | 输入 | 输出 | 任务板 | 失败语义 |
|---|------|------------------|------|------|------|--------|----------|
| 1 | resolve | —（纯代码） | — | ticker/date/portfolio | 01-resolve.md | — | 参数非法立即终止 run |
| 2 | analysts | ta-analyst-market / -news / -sentiment / -fundamentals | ✅ | 01 + 记忆注入 | 20-23 报告 | 4 个任务，认领制 | 单个分析师失败：重试 1 次，仍失败则降级为"缺报告"并在裁决输入中标注 |
| 3 | debate | ta-researcher-bull / -bear | 轮流 | 全部分析师报告 | 每轮立论/反驳 | 2 个任务 | 轮次超时 → 用已有轮次继续 |
| 4 | judgment | ta-research-manager | — | 辩论全文 | 40-verdict | 1 任务 | 失败终止 |
| 5 | trade | ta-trader | — | verdict + 记忆 | 50-plan | 1 任务 | 失败终止 |
| 6 | risk | ta-risk-aggressive / -neutral / -conservative | ✅ | trade plan | 3 份报告 | 3 任务 | 同分析师降级语义 |
| 7 | risk-mgr | ta-risk-manager | — | plan + 3 报告 | 70-assessment（可否决） | 1 任务 | 失败终止 |
| 8 | portfolio | ta-portfolio-manager | — | assessment + plan | 80-decision + decision.json | 1 任务 | 失败终止 |
| 9 | memory | —（纯代码） | — | decision.json | decisions.jsonl 追加 | — | 追加失败记录日志，不回滚决策 |

辩论推进：bull 立论 → Lead `sendMessage` 把路径转给 bear → bear 反驳 → 计入下一轮，直到 `config.maxDebateRounds`。编排器在每步 `waitForChange(caller, stageTimeoutMs, signal)` 等待 teammate 完成（轮询 artifact 文件是否出现 + 任务状态），超时语义见表。

## 4. 会话事件（model-visible ⟺ logged）

新增 5 个会话事件，声明合并进 `SessionEventMap`（落地时以 `packages/core` 的真实事件定义为模块名）：

| 事件 | @mode | 载荷 |
|------|-------|------|
| `tradingagents:run-started` | read | runId、ticker、date、analysts |
| `tradingagents:stage-completed` | read | runId、stage、artifactPath、summary |
| `tradingagents:debate-round` | read | runId、team（research/risk）、round、path |
| `tradingagents:decision` | read | runId、Decision 全量 |
| `tradingagents:run-failed` | read | runId、stage、reason |

原版把中间报告只写文件系统；重排后每个阶段完成都对 Lead 会话可见，用户在 GUI 里无需开文件就能跟踪进度。事件载荷不携带报告全文（避免会话日志膨胀），只带路径与摘要。

## 5. Config（无硬编码可调参数）

所有部署相关取值走验证过的 Config 字段（cordis.yml 可改）：

| 字段 | 类型/默认 | 说明 |
|------|-----------|------|
| `selectedAnalysts` | `['market','news','sentiment','fundamentals']` | 启用的分析师 |
| `maxDebateRounds` | `1..5`，默认 `1` | 多空辩论轮数 |
| `maxRiskRounds` | `1..3`，默认 `1` | 风险辩论轮数 |
| `marketDataSource` | `'tencent' \| 'yahoo'`，默认 `'tencent'` | 行情源：腾讯（CN 可达，实测 ✓）/ Yahoo（海外部署） |
| `decisionLanguage` | 默认 `'中文'` | 决策报告语言 |
| `dataDir` | 相对 workspace 路径 | runs 与 decisions.jsonl 存放处 |
| `secEdgarUserAgent` | string | SEC 合规要求的联系方式；为空则 EDGAR 源不可用（加载期警告），fundamentals 走 Yahoo quoteSummary 回退 |
| `stageTimeoutMs` | 默认 `900000` | 单阶段等待 teammate 上限（活体联调实测单队友 8–12 分钟，5 分钟会误杀） |
| `optionalCredentialRefs` | `{fred?, alphaVantage?, typesafe?}` | 凭据 ref，经 `ctx.credentials.resolve` 取值，绝不读环境变量 |

模型选择不进本插件 Config：teammate 沿用 DSH 模型体系（`agentDefaultModel` / preset 组合 / `subagentModelSelection`）。原版 quick/deep 双层是 LangGraph 内的成本优化，重排后由各 preset 组合承担，M3 再评估 per-preset 模型覆盖。

## 6. 角色 preset 的架构修正（2026-10-11）

原设计"11 个角色各注册一个 agent preset"经真实宿主验证是**错误的架构**：DSH 的 agent preset 不是"提示词 + 工具清单"，而是 **agent 的完整组合声明**——`PresetDefinition.plugins` 必须是一个 Cordis entry 行列表（`[{name, config}]`），register 时会真实 mount 出一棵组合树（`entryListProblem` 校验 + `mountPreset`）。把角色当 preset 注册（只有 id/description/systemPrompt）会因缺少 plugins 字段激活失败 → GUI 里全部"加载失败"。

已撤销 preset 注册（方案一）：
- 角色提示词保留在 `presets.ts`，由编排器在 spawn 时内联进 teammate 任务文本（活体联调已验证有效）
- `inject` 声明保留 `agentPresets`（编排器后续可能用 registry 做只读查询）
- 角色化的正确机制（组合声明 + systemPrompt 注入 + 每角色独立组合树）留待 M3 按真实架构重设计，届时每个"角色 preset"应为：plugins 行声明该角色可用的工具插件集 + systemPrompt 段声明角色提示词

## 7. 数据工具（无 Python）

| 工具 | 数据源 | 鉴权 |
|------|--------|------|
| `ta_get_market_data` | **腾讯 ifzq**（`web.ifzq.gtimg.cn`，前复权日线，A股/港股/美股三市场，探针实测 ✓）为默认；Yahoo chart 为海外部署备选；TS 计算 SMA20/50、RSI14、MACD(12,26,9) | 无 |
| `ta_get_fundamentals` | SEC EDGAR `submissions` + `companyfacts`（US，免 key，近 4 财年）——探针实测可达 ✓；非 US 或未配置 UA 时回退 Yahoo quoteSummary 快照指标（海外可用性待复测） | `secEdgarUserAgent`（配置即启用 EDGAR；SEC 合规要求，非密钥） |
| `ta_get_news` | Yahoo `v1/finance/search` 头条（海外）；CN 部署回退 DSH `web.search`；东财/新浪中文新闻源 M2 评估 | 无 |
| `ta_get_sentiment` | StockTwits + Reddit（海外源，CN 部署实测被封锁 → 降级为空并注明）；CN 情绪源（雪球/股吧）M2+ 评估；TypeSafe 筛选取决于 `typesafe` 凭据 | 可选凭据 |

行情源按 Config 选择（`marketDataSource: 'tencent' | 'yahoo'`，默认 tencent），同一 `Bar` 契约、`fetchBars` 按源分发。Yahoo 从大陆不可达（见 §7.1）；腾讯海外可达性待复测（一般全球可达）。

### 7.1 数据源探针实测记录（2026-10-02，大陆出口环境）

`scripts/probe-data-sources.mjs`（Node 24 直连，与 data.ts 同请求头）：

| 源 | 结果 | 结论 |
|---|---|---|
| 腾讯 ifzq（`sh600519` / `hk00700` / `usNVDA.OQ`） | **200 OK**，K 线 `[date, open, close, high, low, volume]` | 行情主源 ✓；美股 key 保留原大小写且字段为 `day`，A/港为小写 key + `qfqday` |
| SEC EDGAR `company_tickers.json` + `submissions/CIK##########.json` | **200 OK**（10434 条映射；1000 条申报） | US 基本面 ✓；URL 必须带 `CIK` 前缀（探针抓到并已修复该 bug） |
| Yahoo chart / quoteSummary | 403（浏览器 UA 同样 403；响应页为大陆不可达公告） | 大陆部署不可用，降级为海外备选 |
| 东财 `push2his.eastmoney.com` | 连接层失败（Node 与 web_fetch 双双失败） | 当前环境不可达；TradingAgents-CN 的选型结论需在目标机复测后再定 |
| StockTwits / Reddit | 403 / 连接失败 | CN 部署降级为空并注明 |
| 腾讯指数代码（`hkHSI` / `sh000001` / `usINX` / `jpNI225`） | hkHSI ✓ 4 根；sh000001 ✓ 5 根；usINX 仅返回最新 1 根；jpNI225 空 | 基准映射只收实测通过的三个；美股 alpha 降级为 null，日经不映射 |

AkShare 桥 e2e（`scripts/probe-akshare-bridge.py`，真实进程，协议 v0.1）：

| 步骤 | 结果 | 结论 |
|---|---|---|
| ready（akshare 导入） | ✓ version=1.19.1，白名单 3 接口全可用 | 桥生命周期起点正常 |
| ping | ✓ | 请求/响应按 id 配对正常 |
| `stock_financial_analysis_indicator`（600519） | ✓ rowCount=10 | A 股财务指标真实出数（新浪源） |
| `stock_financial_report_sina`（sh600519 利润表） | ✓ rowCount=103 | 三大报表真实出数（1998 至今） |
| 白名单外 `stock_zh_a_hist` | ✓ 正确拒绝 | 安全边界生效 |

AkShare 桥探针（`scripts/probe-akshare.py`，akshare 1.19.1，隔离安装在 `.pylibs`）：

| 接口（底层源） | 结果 | 结论 |
|---|---|---|
| `stock_zh_a_hist_tx`（腾讯） | **OK**，21 行 OHLCV+成交额 | 与直连腾讯结论一致 ✓ |
| `stock_us_daily`（新浪） | **OK**，5776 行 | 新浪美股日线此环境可达，TS 层之外的可用备源 |
| `stock_hk_daily`（新浪） | **OK**，5484 行 | 港股同上 ✓ |
| `stock_zh_a_hist`（东财） | ConnectionError | 与东财直连失败一致：akshare 的主力底层源在此环境不可达 |

HTTP 直接走 host Node `fetch`（JSON API、确定性超时）；若部署要求统一网络出口，替换为 `ctx.web.fetch`（替换点已集中在 `src/tools/data.ts`）。

### 7.2 活体协议联调记录（2026-10-02，DSH 智能体团队真实队友）

在本会话的 DSH Host 上，以 Lead 身份按编排器的真实任务文本模板跑通 **analyst → bull → bear → research-manager** 四队友链（标的 600519.SS @ 2026-10-02，产物在 `tradingagents-dsh-data/runs/e2e-manual-001/`，全程真实 LLM）：

| 队友 | 耗时 | artifact 协议 | 产出亮点 |
|---|---|---|---|
| ta-analyst-market-e2e01 | ~8 分钟 | ✓ 精确路径 + ≤5 行 ack | web_fetch 抓腾讯 60 根 K 线，自算 SMA20/50、RSI14(Wilder)、MACD，交叉校验快照一致性，定位 9/16 死叉 |
| ta-researcher-bull-e2e01 | ~10 分钟 | ✓ | MACD 柱削减 57% 的领先论证 + 赔率表 + 5 条证伪条件，留 3 问给空头 |
| ta-researcher-bear-e2e01 | ~12 分钟 | ✓ | 逐条反驳 + 正面回答 3 问 + 镜像赔率表 + **主动披露分析师报告 §2/§3 口径不一致** |
| ta-research-manager-e2e01 | ~8 分钟 | ✓ | 按证据质量裁决矛盾、复核双方赔率算术、结论分寸得当（55–60% 中等置信） |

**结论与已固化的修正**：

1. **artifact 协议在真实 LLM 下 4/4 合规**（路径精确、ack ≤5 行、阶段纪律）——协议成立。
2. 单队友实测 8–12 分钟 → `stageTimeoutMs` 默认 300s → **900s**（已改 config.ts 与 §5）。
3. 分析师报告存在自身口径不一致（被空头引用其原文捕获）→ analyst preset 新增写前自查指令（已改 presets.ts）。
4. 多头给空头留问题的辩论动力学很好 → 多轮辩论任务文本新增"回答对方遗留问题"指令（已改 orchestrator.ts）。
5. 队友具备 read/write/web_fetch 工具即可跑通本协议；未依赖任何插件注册的 ta_* 工具（联调时以显式 URL 替代，插件内仍走 ta_get_market_data）。

剩余阶段（trade/risk/portfolio）与辩论阶段同一协议族，已由假队友 e2e 覆盖状态机行为。

### 7.3 本地接入记录（desktop profile，2026-10-02）

本机（无 DSH 源码 checkout）通过**已安装社区插件 dsh-whale-widget** 实证了真实插件形状，并完成 link 安装：

1. **真实插件形状（whale 实证）**：`export default { name, inject?: [...], apply(root, config) }`；`root.effect(setup)→disposer`、`root.on(event, listener)→disposer`、服务即 ctx 属性（名字 = Service 目录 key）、可选服务经 `root.get(name)` 运行时取（返回 unknown，需运行时守卫窄化）。
2. **接入机制**：包内 `cordis.patch.yml`（`- insert: [{id, name}]`）+ package.json `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`；安装走 plugin_manager install_bundle `link:<abs path>` → 合并进 `profiles/desktop/cordis.patch.yml` + node_modules link。
3. **构建**：esbuild 单文件 bundle（`lib/index.js`，zod 内联）——tsconfig 转 typecheck-only（allowImportingTsExtensions + noEmit），typecheck 全绿（strict + exactOptionalPropertyTypes）。
4. **首次激活失败与修复**：`cannot get property "agentPresets" without inject` —— cordis 守卫要求服务访问必须先声明 `inject`。已加 `inject: ['agentPresets','tools','agentTeams','jobs','fs','credentials']`（subprocess 可选，走 root.get + 运行时守卫）。修复已用**真实 cordis 4.0** 验证：无声明→守卫失败路径存在；有声明→apply 推迟、服务就绪后完整执行（`scripts/test-cordis-activation.mjs`）。
5. **当前阻塞**：宿主进程的 ESM 模块缓存持有首次安装的旧 bundle——`set_plugin` 禁用/启用只会重跑内存中的旧 apply。**需重启 DeepSeek Harness 应用**让新 bundle 加载；重启后预期 11 预设 + 6 工具注册（`start_trading_analysis` / `ta_get_market_data` / `ta_get_fundamentals` / `ta_get_news` / `ta_get_sentiment` / `ta_run_status`）。
6. **遗留 VERIFY**：宿主 cordis 版本（本地测试用开源 cordis 4.0-rc.10）；`config` 注入是否直达 apply 第二参；事件总线（emit 目前为 console）。这些在重启后的真实加载中逐一暴露、逐一修。
7. **重启后第一轮真实暴露（已修，待二次重启生效）**：
   - profile 补丁条目被 set_plugin 重写时丢失 `name` 字段 → loader 无法解析模块 → GUI 启动告警（"显示异常"根因）。已手工补回 `name: tradingagents-dsh`。
   - inject 修复生效（守卫错误消失，错误推进到工具注册）→ 暴露真实 `ToolDefinition` 契约：**必须声明 `output { schema, render, presentationMeta? }`**；`parameters` 是**裸 JSON Schema**（非 zod！）；execute 返回值即候选 value、宿主按 output.schema 校验、render(args, value) 产出 UI 投影。已把 6 个工具全部迁移到该契约（统一返回 JSON 字符串 + `output.schema = { type:'string' }` + 原样投影 render），typecheck/build 全绿。
   - 宿主位置实证：真实安装在 `D:\Users\yanyi\AppData\Local\Programs\DeepSeek Harness\`（非系统提示声称的 C 盘路径），核心代码在 `resources/app.asar`；asar 内含全部 `@deepseek-ai/*` 包与源码，自研提取器（scripts/asar.mjs）可读取——`dsh-types.ts` 的 VERIFY 校正从此有权威依据。
   - `@deepseek-ai/dsh-tools` 在 npm 存在（0.0.1-rc.1）但其依赖 `@deepseek-ai/dsh-type-meta` 未发布，无法直接安装——asar 提取是唯一路径。
   - **当前阻塞**：宿主进程的 ESM 缓存仍持有旧 bundle，需**再次重启应用**加载修复后的代码。

A 股财务/宏观等广度数据走**可选 AkShare 桥**（`dataBridge: { enabled: false, pythonPath? }`，M2+）：只在 TS 层确认缺数据时启用；桥为长驻 stdio JSON 子进程（dsh-subprocess 拉起），避免 pandas 反复导入的开销；请求带接口名 + 参数，响应带 DataFrame JSON 或显式错误。

## 8. 记忆协议（对应原版 memory log）

`<dataDir>/memory/decisions.jsonl`，追加式，每行：

```json
{"runId":"…","ticker":"NVDA","date":"2026-09-23","decision":"BUY","confidence":0.62,
 "entryRefPrice":…,"evaluation":{"evaluated":true,"rawReturn":…,"alphaVsBenchmark":…},
 "reflection":"…"}
```

- 每次 run 的 resolve 阶段：读同 ticker 最近 `memory.maxInject` 条 + 跨 ticker 最近教训，组装进 trader 与 PM 的提示词（对应原版"同 ticker 决策 + 跨 ticker 教训注入"）。
- 持有窗已过的历史决策：由 PM 阶段回填 realized return（相对区域基准的 alpha）并写一段反思后追加。
- 基准映射：US→`^GSPC`，HK→`^HSI`，JP→`^N225`，CN→`000001.SS`，其余 fallback 无基准（alpha 记 null）。

## 9. 与原版差异（诚实清单）

| 维度 | 原版 | 本插件 | 理由 |
|------|------|--------|------|
| 编排 | LangGraph 代码图 | DSH 团队原语 + job 内状态机 | 用户目标：用 DSH 智能体团队 |
| 检查点 | LangGraph sqlite per ticker | DSH 持久会话/job + manifest 恢复点 | 不重复造持久层 |
| 双 LLM | quick/deep 分层 | 暂由 DSH 模型选择统一承担 | 避免在插件里私接 LLM 适配器 |
| 数据栈 | yfinance/simfin/finnhub/EDGAR | TS + 公共 HTTP（FRED/AlphaVantage 可选后置） | 去 Python 依赖；核心四源已覆盖 |
| 回测 | iter_grid / run_backtest | 后置 M4（jobs 并行跑 run 网格） | 先验证单 run 价值 |
| 非确定性/合规 | 同原版：研究工具，非投资建议 | 同原版，输出带免责声明 | 决策质量取决于模型与数据 |

### 9.1 TradingAgents-CN（中文增强版）借鉴与取舍

[srsman/TradingAgents-CN](https://github.com/srsman/TradingAgents-CN) 是 [hsliuping/TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)（32k+ stars，主线已推进到 v3.0）的停更快照（2025-07，v0.1.7 时期）：同一套 LangGraph 编排，叠加全中文提示词/报告、国产 LLM（DeepSeek/通义）、A 股数据（AkShare/Tushare/东财）、Streamlit Web 界面、MongoDB/Redis 存储与成本优化。对本插件的增量启示：

| 它做的 | 本插件的落地动作 |
|---|---|
| A 股数据（AkShare/Tushare/东财免费源） | 实测定论（§7.1）：行情用腾讯 ifzq（TS 直连 ✓）即可；AkShare 桥定位为**可选补充**（Config 开关，dsh-subprocess 拉起 python，stdio JSON 协议），只用于 TS 难覆盖的广度——A 股财务指标（新浪源实测 ✓）、宏观序列等；东财系接口在此环境不可达，而 akshare 的主力广度恰在东财，落地时在目标机复测后再定范围 |
| 国产 LLM 成本分层（简单 $0.01–0.05 / 深度 $0.10–0.30/次） | 佐证 M3 的 per-preset 模型覆盖：分析师/辩论用快模型，经理/组合用强模型；由 DSH agentPresets 组合承担，不进本插件 Config |
| 全中文提示词/报告资产 | 本插件 preset 已按 `decisionLanguage`（默认中文）产出；落地时可参考其措辞——注意许可证（见 §12） |
| Streamlit Web 界面（进度/流式/多模型对比/导出） | M4 Web 卡片的功能清单；DSH 中 Lead 会话 + `tradingagents:*` 事件已自带实时进度，卡片只补决策视图、多 run 对比与 artifact 跳转 |
| MongoDB/Redis + 数据缓存（宣称 API 调用减少 99.9%） | 本插件以文件 + storageDomain 起步；规模上来再换 domain facility。M2 先加可选磁盘缓存（Config 开关），回测/复跑受益 |
| `online_tools: False`（离线工具模式） | 与缓存开关同一件事：离线/回测复现的钥匙 |
| TRADING_AGENTS_DATA_DIR / 配置管理 | 已覆盖：`dataDir` Config 字段 |

## 10. 里程碑

- **M1**（✅ 已完成于骨架期）：数据面全链路实测（腾讯 ifzq 三市场 ✓、EDGAR ✓、AkShare 桥 ✓）+ `ta_get_market_data` 单测与端到端验证。
- **M2**：全状态机 ✅（假队友 e2e：正常/降级/失败三路径 54 测试全绿）+ 事件 + 记忆读写；余下：真实仓库联调（真 LLM teammate）、CN 数据源扩展（东财/中文新闻）、数据磁盘缓存开关、manifest 恢复（crash 后从 manifest 续跑）。
- **M3**：风险团队联调 + TypeSafe 可选筛选 + per-preset 模型评估（成本分层：分析师/辩论用快模型，经理/组合用强模型）。
- **M4**：回测网格（jobs 并行）+ Web 卡片（从 raw 事件派生；功能清单参照 TradingAgents-CN：决策视图/多 run 对比/报告导出）+ 快照/e2e 门禁。

## 11. 落地步骤（放进真实 DSH 开发仓库）

1. 把 `tradingagents-dsh/` 放进 DSH 工作区（monorepo `packages/` 下或独立 workspace），`pnpm install`；peer 依赖 `@deepseek-ai/cordis` 对齐仓库内版本。
2. 用仓库内现有插件的 `cordis.yml`（建议对照 `@deepseek-ai/dsh-jobs-local` 与 `dsh-user-questions`）校正本包的 `cordis.yml.example`，改名为 `cordis.yml`。
3. 对照真实 `.d.ts` 逐条校正 `src/dsh-types.ts` —— 所有对 DSH 类型/字段名的假设都集中在该文件，并带 `VERIFY` 标记；然后 `pnpm run typecheck`。
4. 在 profile 的 cordis.yml include 本插件；用 Config inspect provider 确认出现 `include:tradingagents` 条目。
5. 测试矩阵：单测（状态机纯函数、指标计算）、keyless recorded-session 快照（模型可见输出）、真实 e2e（`DEEPSEEK_API_KEY`）。遵守仓库门禁：`typecheck`/`lint`/`duplication`/`doc-sync`/`test:coverage`。

## 12. 已知风险

- Yahoo 图表端点为非官方接口，存在字段漂移风险 → 工具层做字段校验，fail loud。
- 多角色 × 多轮辩论 token 成本与原版同量级，不因搬家变省。
- 沙箱策略可能限制 host 直连网络 → 届时把取数切到 `ctx.web.fetch` 或经审批。
- 辩论失控（teammate 偏题/死循环）→ `stageTimeoutMs` + Lead `interrupt(caller, targetName)` 兜底，事件流全程可见。
- 大陆出口环境下 Yahoo/Stooq/StockTwits/Reddit 均被封锁（探针实测，见 §7.1）：行情默认源改为腾讯 ifzq；情绪源在 CN 部署为可降级空数据。
- 腾讯 ifzq 为非官方公开接口：字段形状（美股 key 大小写、`qfqday`/`day` 差异）已实测记录，仍需防漂移校验，失败 fail loud。
- TradingAgents-CN 上游（hsliuping）许可证已从快照期的 Apache-2.0 变为 Other/NOASSERTION：借鉴其中文提示词/文档文本前先核对当前 LICENSE。
