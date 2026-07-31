/**
 * @module   api/anki/summary
 * @desc     GET —— 题库速览 Hero 概况：服务端调 get_anki_cards（part1+part2 当季全部）算好几个计数只回
 *           ~200 字节，替代旧「浏览器拉 fetchAnkiCards(1)+fetchAnkiCards(2) 全部 ~1.3MB 再前端 .length/
 *           .filter」的浪费。重活留在 Zeabur香港↔Supabase新加坡内网快链（服务端），浏览器只收几个数字。
 *           无副作用、匿名放行（requireUserAllowAnon）——匿名会话回当季全库默认卡计数，与列表读策略一致。
 *           口径与旧 library/page.tsx 前端派生逐条对齐（seasonCount/dueCount/pairCount/sample）。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { listAnkiCards } from '@/lib/anki/list'

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireUserAllowAnon(req)
    // 服务端并行拉当季全部 part1/part2（part3 随 part2 成组）；analysis 已在 mapRow 置空，此处只用计数字段。
    const [p1, p2] = await Promise.all([
      listAnkiCards(userId, 1, 'all'),
      listAnkiCards(userId, 2, 'all'),
    ])
    const all = [...p1, ...p2]
    const mains = all.filter((c) => c.part !== 3)          // 待复习/样本口径只看主卡（part3 是子卡）
    const answeredMains = mains.filter((c) => c.isAnswered)
    const now = Date.now()
    const sample = answeredMains[0] ?? mains[0]            // 已答首题优先，否则当季首题
    return NextResponse.json({
      seasonCount: all.length,
      dueCount: answeredMains.filter((c) => new Date(c.dueAt).getTime() <= now).length,
      pairCount: all.filter((c) => c.corpusId !== null && c.isAnswered).length,
      sample: sample ? { part: sample.part, text: sample.questionText } : null,
    })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki summary GET]', e)
    return NextResponse.json({ error: '读取题卡概况失败' }, { status: 500 })
  }
}
