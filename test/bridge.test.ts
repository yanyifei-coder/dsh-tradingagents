/** 桥协议与客户端纯函数单测（零依赖）。传输交互由 scripts/probe-akshare-bridge.py 做真实进程级 e2e。 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  LineAssembler,
  encodeBridgeRequest,
  isAllowlisted,
  parseBridgeLine,
} from '../src/bridge/akshare.ts'

describe('encodeBridgeRequest', () => {
  it('编码为一行 JSONL', () => {
    const line = encodeBridgeRequest({ id: 'req-1', fn: 'ping', params: {} })
    assert.equal(line, '{"id":"req-1","fn":"ping","params":{}}\n')
  })
})

describe('parseBridgeLine', () => {
  it('解析 ready 消息', () => {
    const ready = parseBridgeLine('{"id":"__ready__","ok":true,"version":"1.19.1","available":["ping"]}')
    assert.ok(ready !== null && ready.id === '__ready__' && ready.ok)
    if (ready.id === '__ready__') {
      assert.equal(ready.version, '1.19.1')
    }
  })

  it('解析成功响应', () => {
    const parsed = parseBridgeLine('{"id":"req-1","ok":true,"records":[{"a":1}],"rowCount":1}')
    assert.ok(parsed !== null && parsed.ok === true && parsed.id === 'req-1')
  })

  it('解析错误响应', () => {
    const parsed = parseBridgeLine('{"id":"req-2","ok":false,"error":"boom"}')
    assert.ok(parsed !== null && parsed.ok === false && parsed.id === 'req-2')
  })

  it('空行返回 null，坏消息抛错', () => {
    assert.equal(parseBridgeLine('   '), null)
    assert.throws(() => parseBridgeLine('not-json'))
    assert.throws(() => parseBridgeLine('{"id":1,"ok":true}'))
  })
})

describe('LineAssembler', () => {
  it('按行切分并容忍跨块半行', () => {
    const assembler = new LineAssembler()
    assert.deepEqual(assembler.push('{"id":"a"}\n{"id":"'), ['{"id":"a"}'])
    assert.deepEqual(assembler.push('b"}\n'), ['{"id":"b"}'])
  })

  it('容忍 CRLF 与无尾换行的残余', () => {
    const assembler = new LineAssembler()
    assert.deepEqual(assembler.push('x\r\ny'), ['x'])
    assert.deepEqual(assembler.push(''), [])
    assert.deepEqual(assembler.push('\n'), ['y'])
  })
})

describe('isAllowlisted', () => {
  it('白名单内返回 true', () => {
    assert.equal(isAllowlisted('stock_financial_analysis_indicator'), true)
  })

  it('白名单外返回 false', () => {
    assert.equal(isAllowlisted('stock_zh_a_hist'), false)
    assert.equal(isAllowlisted('__import__'), false)
  })
})
