/**
 * @module   api/anki/analysis
 * @desc     GET ?questionIds=a,b,c —— 批量读题目分析（当季静态分析 JSON）。题卡组件翻面时按需懒加载：
 *           列表接口已不再随行下发 analysis（占 payload ~71%，见 anki/list.ts mapRow ⚠️），改由本端点按
 *           滑动窗口批量拉当前及邻近几张。无副作用、匿名放行（requireUserAllowAnon）——analysis 是当季参考
 *           数据、非用户私有（与列表默认卡背同源，匿名本就能看），与 GET /api/anki/cards 的匿名读策略一致。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { getAnalysesByQuestionIds } from '@/lib/db/question-analyses'
import { CURRENT_SEASON } from '@/lib/constants'

/** 单次请求最多取的题数（= 前端预取窗口上限的宽松上界，防超长 URL / 过大查询）。 */
const MAX_IDS = 50

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireUserAllowAnon(req)
    const { searchParams } = new URL(req.url)
    const ids = (searchParams.get('questionIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)
    if (ids.length === 0) return NextResponse.json({ analyses: {} })
    const analyses = await getAnalysesByQuestionIds(ids, CURRENT_SEASON)
    return NextResponse.json({ analyses })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki analysis GET]', e)
    return NextResponse.json({ error: '读取题目分析失败' }, { status: 500 })
  }
}
