/** Config 与 decision.json 校验单测（需要 zod：先 pnpm install 再跑）。 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decisionSchema, parseTradingAgentsConfig } from '../src/config.ts'

describe('parseTradingAgentsConfig', () => {
  it('空对象应用全部默认值', () => {
    const config = parseTradingAgentsConfig({}, 'test')
    assert.deepEqual(config.selectedAnalysts, ['market', 'news', 'sentiment', 'fundamentals'])
    assert.equal(config.maxDebateRounds, 1)
    assert.equal(config.maxRiskRounds, 1)
    assert.equal(config.decisionLanguage, '中文')
    assert.equal(config.dataDir, 'tradingagents-data')
    assert.equal(config.memory.maxInject, 3)
  })

  it('越界值拒绝并带 entry id', () => {
    assert.throws(() => parseTradingAgentsConfig({ maxDebateRounds: 9 }, 'test'), /entry: test/)
  })
})

describe('decisionSchema', () => {
  const valid = {
    runId: 'run-abc123',
    ticker: 'NVDA',
    date: '2026-09-23',
    action: 'BUY',
    confidence: 0.62,
    rationale: '动量与基本面共振。',
  }

  it('接受完整决策', () => {
    assert.equal(decisionSchema.parse(valid).action, 'BUY')
  })

  it('拒绝未知动作与越界置信度', () => {
    assert.throws(() => decisionSchema.parse({ ...valid, action: 'HOLD?' }))
    assert.throws(() => decisionSchema.parse({ ...valid, confidence: 1.5 }))
  })
})
