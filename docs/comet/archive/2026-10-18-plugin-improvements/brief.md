# 目标

把 `tradingagents-dsh` 完善到**可对外发布**的状态：仓库只保留项目文件、文档内容正确、包元数据与实际服务依赖一致、命名三方统一，并留下一条可推送的干净基线提交。

# 范围

- Q1 选定范围：**A（仓库卫生与发布准备）**。
- Q2 选定方式：**A（备份到仓库外再删除）**。
- Q3 选定命名：**C（独立身份）**——npm 包名 `dsh-tradingagents-teams`，cordis 入口 id `tradingagents-teams`，bundle 补丁 insert `name: dsh-tradingagents-teams`，插件默认导出 `name: tradingagents-teams`。理由：与目录中已收录的同类插件（包名 `dsh-tradingagents`、cordis 入口 id `tradingagents`）可共存，避免同 id 冲突。
- Q4 选定边界：**A（只到发布就绪）**——验收不含 `npm publish`、GitHub Release 与 `git push`；这些动作以文档化命令交给用户在已登录环境执行。

本轮交付内容：

1. **清理非项目内容**：harness 抽取残留（`asar-index.json` 5.81MB、`genai-index.mjs` 1.01MB、`dsh-tools-index.js`、`jobs-local.js`、`preset-registry.js`、`schema.js`、`definition.js`、`presentation.js`、`types.js`、`asar-listing.txt`）、两份 `*.clobber-bak`、三个 `session-log*` 目录：先备份到 `D:\deepseek-harness\dsh\.scratch\plugin-improvements-backup\`，再从仓库移除。
2. **本地运行产物不进仓库**：`.agents/`、`.claude/`、`.codebuddy/`、`.codex/`、`.dsh/`、`.zcode/`、`.workbuddy/` 属本机其他 agent 工具目录，只补 `.gitignore` 规则，不移动文件。
3. **文档修复**：`README.zh.md` 恢复为本插件文档（当前内容是 harness `dsh-jobs-local` 的文档）；`README.md` 同步英文内容与三种安装方式（npm / GitHub Release tarball / 本地 link）及重启步骤。
4. **包元数据**：`package.json` 补 `repository`、`homepage`、`bugs`、`peerDependencies`，peer 覆盖 `src/index.ts` 的 `inject: ['agentPresets','tools','agentTeams','jobs','fs','credentials']`。
5. **命名统一**：按 Q3 的集合替换现有三处不一致的写法（`package.json` 的 `name: dsh-tradingagents`、`cordis.patch.yml` 的 insert `name: tradingagents-dsh`、`src/index.ts` 的 default export `name: 'tradingagents'`）。
6. **本机 profile 迁移**：同步更新 `~/.dsh/profiles/desktop/package.json` 的依赖 key 与 `cordis.patch.yml` 的 insert 名，使本机安装继续可用。
7. **干净基线提交**：把结果提交到 `main`（仓库已 `git init`，`origin = yanyifei-coder/dsh-tradingagents`，远端为空仓库）；不推送。
8. **发布就绪校验**：`pnpm pack` 产物与 `files` 清单一致，且不含残留文件。

## 目录结构

### 新建

- `FEATURE-GAP.md` — 记录与同类实现的差异清单，并把 B/C/D/E 未选范围留作后续 change 的候选，避免重复调查。

### 修改

- `.gitignore` — 补充本地运行产物（agent 平台目录、session 日志、备份目录）规则。
- `package.json` — 补 `repository`/`homepage`/`bugs`/`peerDependencies`，`name` 改为 `dsh-tradingagents-teams`。
- `README.zh.md` — 用本插件文档替换 `dsh-jobs-local` 残留内容。
- `README.md` — 同步英文说明与安装方式。
- `cordis.patch.yml` — insert 改为 `id: tradingagents-teams` / `name: dsh-tradingagents-teams`。
- `src/index.ts` — default export `name` 改为 `tradingagents-teams`。
- `~/.dsh/profiles/desktop/package.json`、`~/.dsh/profiles/desktop/cordis.patch.yml` — 迁移到新命名的依赖 key 与 insert 名。

### 删除

- `asar-index.json`、`genai-index.mjs`、`dsh-tools-index.js`、`jobs-local.js`、`preset-registry.js`、`schema.js`、`definition.js`、`presentation.js`、`types.js`、`asar-listing.txt` — harness 抽取残留。
- `cordis.patch.yml.clobber-bak`、`package.json.clobber-bak` — 覆盖事故备份。
- `session-log/`、`session-log-2/`、`session-log-3/` — 本机会话日志。

以上删除项在移除前均备份到 `D:\deepseek-harness\dsh\.scratch\plugin-improvements-backup\`。

### 明确不建

- 不建客户端 UI 与其构建链（tsdown、client 打包）— 属 Q1 未选的 C。
- 不新增数据源、指标或意图解析模块 — 属 Q1 未选的 B。
- 不建 Python 依赖自动安装 — 属 Q1 未选的 E。
- 不建 CI workflow — 发布命令由人工在已登录环境执行（Q4 边界 A）。

# 非目标

- Q1 未选项：B 分析能力增强、C 客户端 UI、D 准确率统计、E 免 Python 门槛。
- 不接入真实会话事件总线、不把角色注册为 agent preset（现状保留，属后续 change）。
- 不修改 DSH harness 本体与 `D:\deepseek-harness` 上游仓库内容。
- 不执行 `npm publish`、GitHub Release、`git push`（Q4 边界 A）。
- 不复制或改写同类实现（`megatronyy/dsh-tradingagents`）的代码。
- 不改变现有 8 个工具的名称与语义。

# 验收示例

- 仓库只含项目文件：`git status --porcelain` 与 `pnpm pack` 都不出现 `asar-index.json`、`genai-index.mjs`、`dsh-tools-index.js`、`jobs-local.js`、`preset-registry.js`、`schema.js`、`definition.js`、`presentation.js`、`types.js`、`asar-listing.txt`、`*.clobber-bak`、`session-log` 任一路径。

- 打包产物中的文档是本插件文档：`pnpm pack` 产物内 `README.zh.md` 首行是本插件标题、正文含能力与安装说明且不再出现 `dsh-jobs-local`；两种语言的 README 都给出 npm、GitHub Release tarball、本地 link 三种安装方式与重启步骤。

- 命名三方一致且为选定集合：`package.json` 的 `name` 为 `dsh-tradingagents-teams`，`cordis.patch.yml` 的 insert 为 `id: tradingagents-teams` / `name: dsh-tradingagents-teams`，`src/index.ts` 默认导出 `name` 为 `tradingagents-teams`，旧名不再作为包名或入口名出现。

- 元数据与 peer 声明齐全：`repository.url`、`homepage`、`bugs.url` 非空；`peerDependencies` 覆盖 `inject` 六个服务的宿主包 `@deepseek-ai/dsh-agent-presets`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-experimental-agent-team`、`@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-credentials`，版本范围同时覆盖 0.1.7-rc.2 与 0.2.1-rc.2 两个宿主。

- 被移除文件可从备份恢复：`D:\deepseek-harness\dsh\.scratch\plugin-improvements-backup\` 中能找到每个被移除文件与目录的同名副本。

- 本机 desktop profile 完成命名迁移：`~/.dsh/profiles/desktop/package.json` 的依赖 key 与 `cordis.patch.yml` 的 insert 名均为新命名，`tradingagents-dsh` 不再出现。

# Open questions

无。
