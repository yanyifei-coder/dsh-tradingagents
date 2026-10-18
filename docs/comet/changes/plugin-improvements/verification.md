---
generated_from_state_version: 6
---

# 验证

## 当前结果

- 结果: **未通过**
- 验证情况: **修复未通过的验收项后重新验证**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-10-18T07:50:08.877Z
- 摘要: A1、A2、A5、A6 通过；A3、A4 未通过，整体 verdict=fail。A4 是实质缺陷：peerDependencies 把 inject 的 agentPresets 宿主包写成 @deepseek-ai/dsh-agent-presets，而 0.1.7-rc.2 源码（packages/preset/agent-preset-registry，super(ctx,'agentPresets')）与 0.2.1-rc.2 桌面宿主 app.asar（dsh-agent-preset-registry 22 命中、dsh-agent-presets 0 命中）都表明该服务由 @deepseek-ai/dsh-agent-preset-registry 提供，声明的包名在两个目标宿主都不存在，未达到『包元数据与实际服务依赖一致』；版本范围 >=0.1.7-rc.2 <0.3.0-0 确实同时覆盖两个宿主。A3 为命名残留：已跟踪的 cordis.yml.example:10 仍以旧入口名 tradingagents-dsh 作为 include 键，scripts/probe-data-sources.mjs:10,144 的 UA/日志标识仍是旧名（发布产物内干净）。A1 的 git status/git ls-files/--ignored/物理扫描与 pnpm pack 产物均无残留路径；A2 的打包 README 首行、能力与三种安装方式+重启步骤齐备且无 dsh-jobs-local；A5 备份 15/15 项同名且非空；A6 新命名在依赖 key、bundles、insert 与 node_modules junction 上生效，仅残余 link 目标目录路径。建议回到 Build：把 agentPresets 的 peer 改为 @deepseek-ai/dsh-agent-preset-registry，并顺带清理 cordis.yml.example 与 scripts/probe-data-sources.mjs 的旧名。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 仓库只含项目文件：`git status --porcelain` 与 `pnpm pack` 都不出现 `asar-index.json`、`genai-index.mjs`、`dsh-tools-index.js`、`jobs-local.js`、`preset-registry.js`、`schema.js`、`definition.js`、`presentation.js`、`types.js`、`asar-listing.txt`、`*.clobber-bak`、`session-log` 任一路径。 | 独立取证：(1) git status --porcelain 只有 ' M docs/comet/changes/plugin-improvements/comet-state.yaml'（Runtime 状态文件，非禁用路径）；(2) git ls-files 与 git status --porcelain --ignored 对 asar-index.json\|genai-index.mjs\|dsh-tools-index.js\|jobs-local.js\|preset-registry.js\|schema.js\|definition.js\|presentation.js\|types.js\|asar-listing.txt\|clobber-bak\|session-log 全部 0 命中；(3) 工作树物理全量扫描（排除 node_modules/.git）同样 0 命中，即忽略名单里也没有残留；(4) pnpm pack --pack-destination D:\deepseek-harness\dsh\.scratch\verify-pack 产物仅 7 项：bridge/akshare_bridge.py、cordis.patch.yml、lib/index.js、LICENSE、package.json、README.md、README.zh.md，无任何禁用路径，且打包后仓库状态与打包前一致。 |
| A2 | passed | brief.md | 打包产物中的文档是本插件文档：`pnpm pack` 产物内 `README.zh.md` 首行是本插件标题、正文含能力与安装说明且不再出现 `dsh-jobs-local`；两种语言的 README 都给出 npm、GitHub Release tarball、本地 link 三种安装方式与重启步骤。 | 解包 tarball 后核对：README.zh.md 首行为 '# dsh-tradingagents-teams'，README.md 同；两份文件均无 dsh-jobs-local（Select-String 0 命中）；README.zh.md 有 '## 能力' 表格、README.md 有 '## What you get'，安装章节 '## 安装'/'## Install' 给出三种方式（npm: dsh plugin --profile <profile> add dsh-tradingagents-teams；GitHub Release tarball URL；本地 link:/path/to/...）并在第 44 行给出重启步骤（'重启对应宿主（dsh web / 桌面应用）' / 'Restart the host'）。打包内两份 README 与仓库内文件 Get-FileHash 完全一致（IDENTICAL），说明打包未夹带旧文档。 |
| A3 | failed | brief.md | 命名三方一致且为选定集合：`package.json` 的 `name` 为 `dsh-tradingagents-teams`，`cordis.patch.yml` 的 insert 为 `id: tradingagents-teams` / `name: dsh-tradingagents-teams`，`src/index.ts` 默认导出 `name` 为 `tradingagents-teams`，旧名不再作为包名或入口名出现。 | 三处身份正确：package.json:2 name=dsh-tradingagents-teams；cordis.patch.yml:15-16 insert id=tradingagents-teams/name=dsh-tradingagents-teams；src/index.ts:24 name='tradingagents-teams'（且 src/tools/http.ts:6 BASE_UA 已用新名）。但『旧名不再作为包名或入口名出现』不成立：git grep 显示已跟踪文件 cordis.yml.example:10 仍以 '- tradingagents-dsh:' 作为 include 入口键（该示例的 selectedAnalysts/dataDir 等正是本插件 Config 字段，即旧入口名），行 1 也以 tradingagents-dsh 命名该示例；scripts/probe-data-sources.mjs:10,144 仍以 'tradingagents-dsh/0.1.0' 作 UA 与日志标识，与其对应实现 src/tools/http.ts:6 的新 UA 不一致。发布产物内（tarball 的 package.json/cordis.patch.yml/lib/index.js）仅含新名，故该违规限于未发布的示例与脚本文件。DESIGN.md:188/244 的旧名属历史记录与目录路径，不计入本条。 |
| A4 | failed | brief.md | 元数据与 peer 声明齐全：`repository.url`、`homepage`、`bugs.url` 非空；`peerDependencies` 覆盖 `inject` 六个服务的宿主包 `@deepseek-ai/dsh-agent-presets`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-experimental-agent-team`、`@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-credentials`，版本范围同时覆盖 0.1.7-rc.2 与 0.2.1-rc.2 两个宿主。 | 元数据非空成立：package.json:16-23 repository.url/homepage/bugs.url 均有值；peerDependencies 字面含题述六个包名，且范围 >=0.1.7-rc.2 <0.3.0-0 同时覆盖两宿主（0.1.7-rc.2 为闭下界；0.1.7-rc.2 < 0.2.1-rc.2 < 0.3.0-0，major.minor.patch 不同时预发布标识不改变偏序）。但 peer 与实际服务依赖不一致：inject 中的 agentPresets 在宿主 0.1.7-rc.2 源码由 packages/preset/agent-preset-registry 提供——其 src/index.ts:64 执行 super(ctx,'agentPresets')，package.json 的 name 为 @deepseek-ai/dsh-agent-preset-registry（已跑遍 packages/apps 下 package.json，@deepseek-ai/dsh-agent-presets 作为包名 0 命中）；桌面宿主 0.2.1-rc.2（D:\Users\yanyi\...\resources\app.asar，FileVersion=0.2.1-rc.2）的 asar 文件清单中 dsh-agent-preset-registry 命中 22 次、dsh-agent-presets 命中 0 次；harness 的 scripts/dependency-catalog/package-lock.json 中该包 0.1.5-rc.2 的解析 tarball 恰名为 dsh-agent-presets-0.1.5-rc.2.tgz，即旧名正是被改名掉的那个。故声明的 @deepseek-ai/dsh-agent-presets 在两个目标宿主都不存在，六个 peer 中 1 项错误，未达到 brief 的『包元数据与实际服务依赖一致』；其余五项经源码核对正确：tools→packages/core/tools、jobs→packages/jobs/jobs、fs→packages/fs/fs、credentials→packages/credentials/credentials、agentTeams→packages/experimental/agent-team。 |
| A5 | passed | brief.md | 被移除文件可从备份恢复：`D:\deepseek-harness\dsh\.scratch\plugin-improvements-backup\` 中能找到每个被移除文件与目录的同名副本。 | 逐项核对 D:\deepseek-harness\dsh\.scratch\plugin-improvements-backup\：12 个文件同名副本齐全（asar-index.json 6,088,685B、asar-listing.txt 3,306B、genai-index.mjs 1,058,047B、dsh-tools-index.js 157,954B、jobs-local.js 31,157B、preset-registry.js 31,875B、schema.js 15,573B、definition.js 1,170B、presentation.js 347B、types.js 161B、cordis.patch.yml.clobber-bak 20,780B、package.json.clobber-bak 1,589B），3 个目录同名且非空（session-log 1 文件/201,775B、session-log-2 7 文件/200,571B、session-log-3 1 文件/1,046,683B），合计 15/15；同时这些路径在仓库工作树中已全部不存在（见 A1 的物理扫描与 git 检查），可从备份逐项恢复。 |
| A6 | passed | brief.md | 本机 desktop profile 完成命名迁移：`~/.dsh/profiles/desktop/package.json` 的依赖 key 与 `cordis.patch.yml` 的 insert 名均为新命名，`tradingagents-dsh` 不再出现。 | 直接读取 C:\Users\yanyi\.dsh\profiles\desktop\ 下文件：package.json 依赖 key 为 dsh-tradingagents-teams（link 目标指向仓库目录），dsh.profile.bundles 中对应项亦为 dsh-tradingagents-teams；cordis.patch.yml 的 insert 为 '- id: tradingagents-teams / name: dsh-tradingagents-teams'；node_modules\@deepseek-ai 目录为空、node_modules 下 tradingagents 相关项只有 junction dsh-tradingagents-teams → D:\deepseek-harness\dsh\tradingagents-dsh，pnpm-lock.yaml importer 的 key 亦为新名，旧依赖 key 已不存在。残余的字面串 tradingagents-dsh 仅出现在 link 目标文件系统路径（package.json:7、pnpm-lock.yaml:12-13）与两个历史备份文件（package.json.bom-bak、cordis.patch.yml.stray-tooljobs-bak），均非依赖 key 或 insert 名，故按本条『依赖 key 与 insert 名均为新命名』的角色口径判定通过，残余路径已写入 risks。 |

## 检查

_没有记录 Runtime 检查。_

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- pnpm run typecheck: passed — tsc -p tsconfig.json --noEmit（strict）无输出、无错误
- pnpm test: passed — node:test 48 项通过 / 0 失败 / 19 套件，含 orchestrator-e2e
- pnpm pack 产物校验: passed — 产物 7 项、47.5KB；README.zh.md 首行与 package.json 身份/元数据正确，无残留文件
- desktop profile 安装校验: passed — pnpm install 后 node_modules 仅新名软链；lockfile 记录新 key
- git 基线提交: passed — 提交 4dd0cb3（47 文件、5051 插入），提交后工作树 clean；未推送
- 已知限制: 按 Q4 边界未执行 npm publish、GitHub Release 与 git push
- 已知限制: 未重启桌面宿主验证运行时加载，desktop profile 迁移以文件与 node_modules 状态为准
- 已知限制: 本机 profile 的 link 目标目录名仍为 tradingagents-dsh（文件系统路径，未改名，避免破坏 Comet 工作区绑定）
- 已知限制: lib/index.js 与 pnpm pack 产物未纳入 git（.gitignore 排除 lib/），发布时由 prepublishOnly 重建

## 阻塞项

_无。_

## 风险与跳过的工作

- A6 残余：desktop profile 的 link 目标目录名仍为 tradingagents-dsh（package.json:7、pnpm-lock.yaml:12-13 的文件系统路径）；若按字面理解『tradingagents-dsh 不再出现』则为不满足，但该串不在依赖 key/insert 名角色上，且改目录名会破坏 Comet 工作区绑定，Builder 已在 comet-state known_limits 中披露。同目录另有 package.json.bom-bak、cordis.patch.yml.stray-tooljobs-bak 两个历史备份仍含旧名（仓库外，不属本 change）。
- A4 的结论基于本机两个目标宿主（D:\deepseek-harness 源码 checkout 0.1.7-rc.2 与桌面宿主 0.2.1-rc.2 的 app.asar 清单）；本环境无外网（web_fetch 到 registry.npmjs.org 失败），无法排除 @deepseek-ai/dsh-agent-presets 作为独立已发布包存在，但两个目标宿主内均无此包，作为插件 peer 仍不成立。
- A3 的残留位于未发布文件（package.json 的 files 白名单不含 cordis.yml.example 与 scripts/），不影响 npm 产物，属命名一致性与文档可用性缺陷（该示例若被使用者照抄会引用不存在的旧入口名）。
- 本轮 Runtime 未执行任何命令检查，A1–A6 全部由我独立取证；Builder 自述的 pnpm run typecheck、48 项单测、profile 安装校验我未复跑（仅复核了提交 4dd0cb3 存在、工作树除 Runtime 状态文件外干净，并自行执行了 pnpm pack 成功）。因此 A1/A2/A5/A6 的通过不构成对 typecheck 与单测结论的背书。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A3, A4 | A1、A2、A5、A6 通过；A3、A4 未通过，整体 verdict=fail。A4 是实质缺陷：peerDependencies 把 inject 的 agentPresets 宿主包写成 @deepseek-ai/dsh-agent-presets，而 0.1.7-rc.2 源码（packages/preset/agent-preset-registry，super(ctx,'agentPresets')）与 0.2.1-rc.2 桌面宿主 app.asar（dsh-agent-preset-registry 22 命中、dsh-agent-presets 0 命中）都表明该服务由 @deepseek-ai/dsh-agent-preset-registry 提供，声明的包名在两个目标宿主都不存在，未达到『包元数据与实际服务依赖一致』；版本范围 >=0.1.7-rc.2 <0.3.0-0 确实同时覆盖两个宿主。A3 为命名残留：已跟踪的 cordis.yml.example:10 仍以旧入口名 tradingagents-dsh 作为 include 键，scripts/probe-data-sources.mjs:10,144 的 UA/日志标识仍是旧名（发布产物内干净）。A1 的 git status/git ls-files/--ignored/物理扫描与 pnpm pack 产物均无残留路径；A2 的打包 README 首行、能力与三种安装方式+重启步骤齐备且无 dsh-jobs-local；A5 备份 15/15 项同名且非空；A6 新命名在依赖 key、bundles、insert 与 node_modules junction 上生效，仅残余 link 目标目录路径。建议回到 Build：把 agentPresets 的 peer 改为 @deepseek-ai/dsh-agent-preset-registry，并顺带清理 cordis.yml.example 与 scripts/probe-data-sources.mjs 的旧名。 | 2026-10-18T07:50:08.877Z |



## 结论

A1、A2、A5、A6 通过；A3、A4 未通过，整体 verdict=fail。A4 是实质缺陷：peerDependencies 把 inject 的 agentPresets 宿主包写成 @deepseek-ai/dsh-agent-presets，而 0.1.7-rc.2 源码（packages/preset/agent-preset-registry，super(ctx,'agentPresets')）与 0.2.1-rc.2 桌面宿主 app.asar（dsh-agent-preset-registry 22 命中、dsh-agent-presets 0 命中）都表明该服务由 @deepseek-ai/dsh-agent-preset-registry 提供，声明的包名在两个目标宿主都不存在，未达到『包元数据与实际服务依赖一致』；版本范围 >=0.1.7-rc.2 <0.3.0-0 确实同时覆盖两个宿主。A3 为命名残留：已跟踪的 cordis.yml.example:10 仍以旧入口名 tradingagents-dsh 作为 include 键，scripts/probe-data-sources.mjs:10,144 的 UA/日志标识仍是旧名（发布产物内干净）。A1 的 git status/git ls-files/--ignored/物理扫描与 pnpm pack 产物均无残留路径；A2 的打包 README 首行、能力与三种安装方式+重启步骤齐备且无 dsh-jobs-local；A5 备份 15/15 项同名且非空；A6 新命名在依赖 key、bundles、insert 与 node_modules junction 上生效，仅残余 link 目标目录路径。建议回到 Build：把 agentPresets 的 peer 改为 @deepseek-ai/dsh-agent-preset-registry，并顺带清理 cordis.yml.example 与 scripts/probe-data-sources.mjs 的旧名。
