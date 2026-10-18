# dsh-tradingagents-teams

A DeepSeek Harness (Cordis) plugin that re-shapes [TradingAgents](https://github.com/TauricResearch/TradingAgents) — TauricResearch's multi-agent LLM trading-research framework — onto **DSH Agent Teams** (a lead, spawned teammates, a shared task board and messaging). The role split, debate protocol and reflection memory are kept; the LangGraph runtime and the Python data stack are dropped, and the data tools are rewritten in TypeScript over public HTTP.

> Naming: this plugin's package is `dsh-tradingagents-teams` and its cordis entry id is `tradingagents-teams`. A separate community plugin covers the same topic under package `dsh-tradingagents` / entry id `tradingagents`. The entry ids differ, so both can be installed in one profile without overwriting each other.

## What you get

| Capability | Detail |
|---|---|
| 8 model tools | `start_trading_analysis`, `ta_run_status`, `ta_get_market_data`, `ta_get_fundamentals`, `ta_get_news`, `ta_get_sentiment`, plus `ta_get_a_share_financial` and `ta_get_a_share_report`, which are registered only when `dataBridge.enabled` is true |
| 13 role presets | four analysts (technical / news / social / fundamentals), bull and bear researchers, research manager, trader, three risk viewpoints, risk manager, portfolio manager |
| 9-stage pipeline | `resolve → analysts → research-debate → research-judgment → trade-plan → risk-debate → risk-judgment → portfolio → memory`, running as a background job with `manifest.json` as its recovery point |
| Data plane | Tencent quotes (default) or Yahoo; SEC EDGAR fundamentals with a Yahoo fallback; news with a `web.search` fallback; StockTwits / Reddit sentiment; an optional akshare bridge for A-share financials |
| Memory | `<dataDir>/memory/decisions.jsonl` injected across runs; `realizedReturns` evaluates what past decisions actually returned |

## Install

Pick one source; every one of them needs the host to reload the profile afterwards:

```bash
# 1) npm (once published)
dsh plugin --profile <profile> add dsh-tradingagents-teams

# 2) Prebuilt GitHub Release tarball (no local build)
dsh plugin --profile <profile> add "https://github.com/yanyifei-coder/dsh-tradingagents/releases/download/<tag>/dsh-tradingagents-teams-<version>.tgz"

# 3) Local source (development)
dsh plugin --profile <profile> add link:/path/to/dsh-tradingagents
```

The desktop (Electron) host runs the same command through its bundled CLI shim, for example
`"<install-dir>/resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop add ...`; the plain `dsh` CLI rejects the `desktop` profile.

The install registers the dependency in the profile's `package.json` and inserts the plugin through `cordis.patch.yml`:

```yaml
- insert:
    - id: tradingagents-teams
      name: dsh-tradingagents-teams
      disabled: false
```

Restart the host (`dsh web` or the desktop app) to activate the tools and presets.

## Configuration

Config is zod-validated with a default for every field, so only the fields you want to change need to be set:

| Field | Default | Meaning |
|---|---|---|
| `selectedAnalysts` | `['market','news','sentiment','fundamentals']` | analysts to run in parallel |
| `maxDebateRounds` | `1` | bull/bear debate rounds (1–5) |
| `maxRiskRounds` | `1` | risk debate rounds (1–3) |
| `marketDataSource` | `tencent` | `tencent` (reachable from CN) or `yahoo` (overseas deployments) |
| `dataBridge.enabled` | `false` | enables the akshare bridge and its two A-share financial tools |
| `dataBridge.pythonPath` / `scriptPath` | `python` on PATH / `bridge/akshare_bridge.py` | bridge interpreter and script |
| `dataBridge.readyTimeoutMs` / `callTimeoutMs` | `120000` / `60000` | bridge startup and per-call limits |
| `decisionLanguage` | `中文` | report and decision language |
| `dataDir` | `tradingagents-data` | root for runs and memory (workspace-relative) |
| `secEdgarUserAgent` | `''` | EDGAR compliance contact; the source stays unavailable while empty |
| `teammateProvider` | `spawn` | provider id for spawned teammates |
| `stageTimeoutMs` | `900000` | per-stage wait for a teammate |
| `optionalCredentialRefs` | `{}` | optional data-source credential refs (resolved through the credentials service) |
| `memory.maxInject` | `3` | maximum injected memory records |

## Usage

```text
User (Team Lead): analyse NVDA for 2026-09-23
  └─ start_trading_analysis { ticker: "NVDA", date: "2026-09-23", analysts: [...], maxDebateRounds: 2 }
       → runId / jobId (background orchestration)
  └─ ta_run_status { runId }
       → stage / degradations / final decision
```

Artifacts: `<dataDir>/runs/<runId>/` (`manifest.json`, per-stage artifacts, `decision.json`) and `<dataDir>/memory/decisions.jsonl`.

## Development

```bash
pnpm install
pnpm run build      # esbuild bundles src/index.ts into lib/index.js
pnpm run typecheck  # tsc --noEmit (strict)
pnpm test           # node:test unit tests
```

| File | Contents |
|---|---|
| [DESIGN.md](DESIGN.md) | core design: topology, artifact protocol, state machine, events, Config, data tools, memory, differences from upstream |
| `src/orchestrator.ts` | the 9-stage orchestration state machine |
| `src/presets.ts` | the 13 role preset texts |
| `src/tools/*` | the 8 tools (Tencent quotes, indicators, HTTP base) |
| `src/bridge/akshare.ts` + `bridge/akshare_bridge.py` | the akshare stdio JSON bridge (function allowlist) |
| `src/dsh-types.ts` | the concentrated assumptions about DSH / Cordis service types (correct this first on a host upgrade) |
| `scripts/probe-*.mjs` / `scripts/probe-*.py` | connectivity probes for the data sources and the bridge |
| `scripts/asar*.mjs` | local investigation helpers that generate and search `asar-index.json` (not committed; regenerate on demand) |
| `test/*.test.ts` | unit tests (node:test, no extra dependencies) |

References: upstream [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) and the Chinese-enhanced [hsliuping/TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN).

## Disclaimer

Research use only; not financial, investment or trading advice. LLM decisions are non-deterministic, as in the upstream project (see its README, Reproducibility).
