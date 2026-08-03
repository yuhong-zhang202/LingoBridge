/**
 * @module   restructure-gate.test
 * @desc     /api/restructure 分支判定的单测 —— 钉死语音/文字两条路径共用的那组分支语义。
 *           这里每一条断言都对应线上一个「坏了不会报错、只会让数据悄悄错」的口径：
 *           402 不能落进通用失败、403 不能落进通用失败、usable=false 不能被当成放行、
 *           429/400/401 不能被压成 other。
 * @author   LingoBridge
 * @created  2026-08-03
 */
import { evaluateRestructureResponse } from '@/lib/restructure-gate'

/** 造一个带 JSON 体的 Response（成功分支用） */
function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('evaluateRestructureResponse', () => {
  it('402 → quota（不读响应体）', async () => {
    const gate = await evaluateRestructureResponse(new Response('', { status: 402 }))
    expect(gate).toEqual({ action: 'quota', ai: 'quota_402', httpStatus: 402, payload: null })
  })

  it('403 → consent（不读响应体）', async () => {
    const gate = await evaluateRestructureResponse(new Response('', { status: 403 }))
    expect(gate).toEqual({ action: 'consent', ai: 'consent_403', httpStatus: 403, payload: null })
  })

  it('200 + usable → proceed 且带回整理结果', async () => {
    const gate = await evaluateRestructureResponse(jsonRes({ cleanedText: '整理后', usable: true, summary: '一句话' }))
    expect(gate).toEqual({
      action: 'proceed', ai: 'ok', httpStatus: 200,
      payload: { cleanedText: '整理后', usable: true, summary: '一句话' },
    })
  })

  it('200 + usable 但无 summary → payload 仍带回（summary 缺省由调用方兜底成空串）', async () => {
    const gate = await evaluateRestructureResponse(jsonRes({ cleanedText: '整理后', usable: true }))
    expect(gate.action).toBe('proceed')
    expect(gate.payload?.summary).toBeUndefined()
  })

  it('200 + usable=false → garbage，且【不】带 payload（不许被当成放行）', async () => {
    const gate = await evaluateRestructureResponse(jsonRes({ cleanedText: '整理后', usable: false }))
    expect(gate).toEqual({ action: 'garbage', ai: 'ok', httpStatus: 200, payload: null })
  })

  it.each([
    [429, 'rate_429'],
    [400, 'bad_input_400'],
    [401, 'auth_401'],
    [500, 'server_5xx'],
    [503, 'server_5xx'],
    [418, 'other'],
  ])('%i → proceed（失败但放行），ai=%s', async (status, ai) => {
    const gate = await evaluateRestructureResponse(new Response('', { status: status as number }))
    expect(gate).toEqual({ action: 'proceed', ai, httpStatus: status, payload: null })
  })

  it('200 但响应体不是 JSON → 抛出（由调用方按网络失败兜住，不许伪装成一次成功整理）', async () => {
    await expect(evaluateRestructureResponse(new Response('不是 json', { status: 200 })))
      .rejects.toThrow()
  })
})
