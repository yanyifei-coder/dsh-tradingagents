# tradingagents-teams

## 能力概述

`tradingagents-teams` 是 DeepSeek Harness（DSH）插件：把 TradingAgents 的多角色投研流程以 DSH Agent Teams 形式运行，以 A 股为主并兼容 US/HK/JP，在宿主进程内注册模型工具、角色文本与编排状态机，把每次分析的产物写入可配置的数据目录。

## 无产品行为变更的说明

本次 change（`plugin-improvements`）只改变插件的**发布形态与身份标识**：仓库文件集合、文档内容、包元数据、服务依赖声明、插件命名，以及本机 desktop profile 的迁移。模型的工具名称与语义、Config 字段与默认值、9 阶段编排、数据源与记忆逻辑均保持不变，因此本 Spec 不重复描述完整运行行为，只描述本次引入或改变的部分；未列出的既有行为以仓库实现为准并由本 Spec 的约束固定。

## 变更后的身份

- npm 包名 `dsh-tradingagents-teams`；`cordis.patch.yml` 的 insert 为 `id: tradingagents-teams`、`name: dsh-tradingagents-teams`；插件默认导出 `name: 'tradingagents-teams'`。
- 该命名与目录中已收录的同类插件（包名 `dsh-tradingagents`、入口 id `tradingagents`）区分，避免同一 profile 内出现重复 cordis 入口 id。

## 服务依赖声明

`peerDependencies` 覆盖 `src/index.ts` 的 `inject: ['agentPresets', 'tools', 'agentTeams', 'jobs', 'fs', 'credentials']` 对应宿主包 `@deepseek-ai/dsh-agent-presets`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-experimental-agent-team`、`@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-credentials`，版本范围同时覆盖 0.1.7-rc.2 与 0.2.1-rc.2 两个宿主。

## 发布产物

`files` 白名单发布 `lib/`、`bridge/`、`cordis.patch.yml`、`README.md`、`README.zh.md`、`LICENSE`。两种语言的 README 都是本插件文档，并给出 npm、GitHub Release tarball、本地 `link:` 三种安装方式与重启步骤；`README.zh.md` 不再残留 harness 其他包的文档内容。

## 场景

Scenario: 仓库只含项目文件
验收：A1
- WHEN 运行 `git status --porcelain` 与 `pnpm pack`
- THEN 输出中不出现 harness 抽取残留、`*.clobber-bak` 与 `session-log*` 路径

Scenario: 打包产物中的文档是本插件文档
验收：A2
- WHEN 运行 `pnpm pack` 并查看产物内两种 README
- THEN `README.zh.md` 是本插件文档且给出三种安装方式

Scenario: 命名三方一致
验收：A3
- WHEN 检查包名、cordis 入口与插件导出名
- THEN 三者等于 `dsh-tradingagents-teams`、`tradingagents-teams`/`dsh-tradingagents-teams`、`tradingagents-teams`

Scenario: 元数据与 peer 声明齐全
验收：A4
- WHEN 检查 `package.json`
- THEN `repository`、`homepage`、`bugs` 非空且 `peerDependencies` 覆盖六个注入服务的宿主包

Scenario: 被移除文件可从备份恢复
验收：A5
- WHEN 检查备份目录
- THEN 每个被移除文件与目录都有同名副本

Scenario: 本机 desktop profile 完成命名迁移
验收：A6
- WHEN 检查本机 desktop profile 的依赖与补丁文件
- THEN 依赖 key 与 insert 名均为新命名

## 约束

- 工具名称与语义、Config 字段、9 阶段编排保持不变。
- 不修改 DSH harness 本体；本 Spec 只描述本插件仓库内的能力。
- 发布动作（`npm publish`、GitHub Release、`git push`）不在本轮范围。
