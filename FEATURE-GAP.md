# 能力差异与后续候选

本文件记录本插件与社区同类实现 `megatronyy/dsh-tradingagents`（包名 `dsh-tradingagents`，目录中已收录）的功能差异，以及本轮 change 主动排除、留待后续 change 的候选项。两者的入口 id 不同（`tradingagents-teams` 对 `tradingagents`），可在同一 profile 共存。

## 对照（截至 2026-10-18）

| 维度 | 本插件 | megatronyy/dsh-tradingagents |
|---|---|---|
| 入口形态 | 8 个模型工具 + 后台 job + `ta_run_status` 进度查询 | 斜杠命令 `/trading-agent`，同步执行 |
| 角色执行 | 真 teammates（有会话、可读文件、可调工具） | 单次 LLM 补全（人设 prompt，角色不持有工具） |
| 角色数 | 13 预设文本（4 分析师） | 自述 14 角色（7 分析师） |
| 辩论轮数 | Config 可配（多空 1–5、风控 1–3） | 硬编码 2 轮 |
| 崩溃恢复 | `manifest.json` 续跑点 + 阶段超时 | 无 |
| 资金面数据 | 无 | 个股/板块资金流、龙虎榜、涨停池 |
| 技术指标 | SMA / RSI / MACD | SMA/EMA/RSI/MACD/BOLL/ATR/VWMA + VPA 表 |
| 自然语言意图解析 | 无（工具参数直接校验） | `parseIntent`（标的、关注点、持仓上下文） |
| 客户端 UI | 无 | 设置页「投研报告」列表与详情 |
| 结构化决策 | `decision.json`（zod 校验） | 决策记录含逐角色 verdict、来源溯源与文本回退标记 |
| 记忆闭环 | `decisions.jsonl` 注入 + `realizedReturns` | 无（决策记录留作将来统计） |
| 多市场 | CN / US / HK / JP + 区域基准 | 仅 A 股 |
| 服务依赖声明 | `peerDependencies` 覆盖 6 个注入服务 | 声明 `cordis` 与 `dsh-llm` peer |
| 分发 | npm / GitHub Release tarball / 本地 link | 已有 3 个 Release tarball 与目录收录 |

## 后续候选

以下条目在本轮 change 中确认为非目标，按建议优先级排列：

1. **分析能力增强（B）** — 补资金面数据源（个股/板块资金流、龙虎榜、涨停池）、扩展指标（BOLL/ATR/VWMA/VPA）与自然语言意图解析。
2. **客户端 UI（C）** — 设置页报告历史与决策详情，需要引入客户端构建链（tsdown + client 入口）与 HTTP 路由。
3. **准确率统计（D）** — 消费已有 `realizedReturns`，输出历史决策命中率与胜率统计。
4. **免 Python 门槛（E）** — akshare 桥缺失时自动降级为纯 TS 数据源并在报告中标注降级原因。

## 既有实现中待收敛的点

- `src/index.ts` 的事件发射目前只写 host 控制台，未接入真实会话事件总线（`model-visible ⟺ logged` 未闭环）。
- 角色以文本内联进 teammate 任务，未注册为 agent preset（原因见 `src/index.ts` 注释）。
- `src/dsh-types.ts` 集中保存对 DSH / Cordis 服务类型的假设，宿主升级时需首先校正。
