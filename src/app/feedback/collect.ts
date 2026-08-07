/**
 * @module   feedback/collect
 * @desc     反馈页「收藏一句优化表达」的落库 + 失败归因 + 埋点 —— 从 page.tsx 外壳里抽出来的唯一写入逻辑。
 *
 *   【为什么它必须存在（2026-08-07）】原实现是「发起落库 → 无条件 setSaved(c+1)」，失败只写
 *   console.error：卡片照翻、计数照加，用户看到的是「收藏成功了」，实际一条没进库，
 *   只有事后去素材库找不到才会发现。**骗用户比失败本身更糟**，故落库结果必须回流到 UI。
 *
 *   【为什么单开一个模块而不是留在组件里】本仓库【没有 DOM 测试环境】（无 jsdom / testing-library，
 *   且本次不许为它加依赖），逻辑写在 page.tsx 的闭包里，「失败时绝不加计数」这条红线就只能靠读代码保证。
 *   抽成工厂函数后，单测可以直接构造 addSavedPhrase 抛错的情形，钉死「onSaved 一次都不许被调用」。
 *
 * @author   LingoBridge
 * @created  2026-08-07
 */
'use client'
import { ensureSession } from '@/lib/supabase'
import { addSavedPhrase } from '@/lib/db/saved-phrases'
import { refreshSavedPhrases } from '@/hooks/library-data'
import { track } from '@/lib/client-events'
import type { ClientEventName, ClientEventPropsMap, CollectFailReason, CollectView } from '@/lib/event-schema'
import type { SessionPolish } from '@/lib/types'

/**
 * 收藏没成功时给用户看的整句提示（走反馈页那条既有 Toast）。
 *
 * 三件事必须说全，缺一条用户就会做出错误判断：
 *   1. 【这句没存上】—— 修的就是「以为成功了」；
 *   2. 【素材库里不会有它】—— 说清后果落在哪，别让人事后翻半天；
 *   3. 【网络好了后面的句子照常收藏】—— 唯一真正可做的事。刻意【不写「请重试」】：
 *      失败提示回来时卡片多半已经翻过去了，那一张【重试不了】，写重试就是第二次骗人。
 * 调性与 PRACTICE_RECORD_FAILED_MESSAGE 对齐：一句话 + 括号补充，不回显任何后端 error.message
 * （那是自由文本、可能含身份信息），也不复述用户的句子。
 */
export const COLLECT_FAILED_MESSAGE =
  '刚才那句没能收藏上，素材库里不会有它（多半是网络没通）。网络好了以后，后面的句子可以照常收藏'

/**
 * 埋点包一层：埋点异常绝不许翻成用户可见的「收藏失败」提示。
 * track 本身已是 fire-and-forget（不返回 Promise、内部吞错），这里兜的是它【同步】抛出的极端情况
 * —— 那会落进调用处的 .catch，把一次成功的收藏说成失败，正好是本次要修的 bug 的镜像。
 * @param  event  事件名
 * @param  props  事件字段（契约见 event-schema）
 * @sideEffect    POST /api/events（失败静默）
 */
function safeTrack<E extends ClientEventName>(event: E, props: ClientEventPropsMap[E]): void {
  try {
    track(event, props)
  } catch (e) {
    console.error('[feedback] 收藏埋点失败', e)
  }
}

/**
 * 落一条收藏。成功返回 null，失败返回原因 code —— 【绝不抛出】，调用方是 UI 回调。
 *
 * 会话与落库分两段跑，是为了拿到【干净的失败归因】：addSavedPhrase 内部也会 ensureSession，
 * 但它把「没会话」和「库里写不进去」抛成同一种 Error，只有中文 message 前缀能区分 ——
 * 靠 message 分类会在别人改文案时静默失真。这里显式先跑一次：已有会话时它只读一次本地 session、
 * 不发网络请求（单飞实现见 lib/supabase.ts），代价可忽略。
 *
 * @param  polish  要收藏的那张卡（id/createdAt 由 DB 生成）
 * @returns        null = 已落库；否则为失败原因 code
 * @sideEffect     ensureSession（无会话时会建匿名账号）+ 一次 saved_phrases insert + 失效收藏缓存
 */
async function saveOne(polish: SessionPolish): Promise<CollectFailReason | null> {
  try {
    await ensureSession()
  } catch (e) {
    console.error('[feedback] 收藏失败：拿不到会话', e)
    return 'session_failed'
  }
  try {
    await addSavedPhrase(polish)
  } catch (e) {
    console.error('[feedback] 收藏落库失败', e)
    return 'insert_failed'
  }
  // 落库【已经成功】：缓存刷新失败只影响素材库何时看到这条，绝不能反过来判成「没收藏上」——
  // 那是同一个骗人 bug 的反向版本（让用户以为丢了、实际在库里）。故不 await、失败只记日志。
  void refreshSavedPhrases().catch((e) => console.error('[feedback] 收藏缓存刷新失败', e))
  return null
}

/** 收藏结果的去向：成功/失败各一条，由外壳接到 UI 上（计数 / Toast） */
export interface CollectCallbacks {
  /** 落库【确实成功】才调用 —— 已收藏计数只许在这里加 */
  onSaved: () => void
  /** 落库失败：message 是给用户看的整句提示（COLLECT_FAILED_MESSAGE） */
  onFailed: (message: string) => void
}

/**
 * 造一个「唯一收藏写入点」回调，供反馈页外壳挂给两套视图共用。
 *
 * 【时序】返回的回调是同步的（不返回 Promise、不阻塞导航），落库在后台跑完才回调 ——
 * 也就是说卡片会在结果回来之前就翻过去：成功时计数晚 ~200ms 加上（用户在完成页看到的总数是对的），
 * 失败时提示出现在下一张卡上方。这是【刻意的】：为了等结果而卡住翻页，会把每次收藏都变成一次等待，
 * 代价远大于收益（且两个视图的导航是各自私有状态，外壳不该去改）。文案因此写成「刚才那句」。
 *
 * @param  cb  成功 / 失败的去向
 * @returns    (polish, view) => void 的收藏回调；view 由各调用点各传各的（口径见 COLLECT_VIEW）
 * @sideEffect 每次调用触发一次落库尝试 + 一条埋点（fire-and-forget）
 */
export function makeCollectHandler(cb: CollectCallbacks): (polish: SessionPolish, view: CollectView) => void {
  // 本场成功收藏序号。刻意不复用 React 的 savedCount state：setState 是异步批处理的，
  // 埋点里读它可能连着两次读到同一个旧值，nth 就会重号（分布图上凭空多出「一场只收 1 句」）。
  let savedNth = 0
  return (polish, view) => {
    void saveOne(polish)
      .then((reason) => {
        if (reason === null) {
          savedNth += 1
          cb.onSaved()
          // 埋点一律排在用户可见动作【之后】，且不进任何条件判断（沿用 ExamGoalModal 的范式）
          safeTrack('flow.phrase_collected', { nth: savedNth, view })
          return
        }
        cb.onFailed(COLLECT_FAILED_MESSAGE)
        safeTrack('flow.phrase_collect_failed', { reason, view })
      })
      .catch((e) => {
        // saveOne 声明为不抛出，走到这里说明它自己出了预料外的异常。
        // 宁可多提示一次，也绝不让用户以为收藏成功了 —— 这正是本次修的那条红线。
        console.error('[feedback] 收藏流程异常', e)
        cb.onFailed(COLLECT_FAILED_MESSAGE)
        safeTrack('flow.phrase_collect_failed', { reason: 'unknown', view })
      })
  }
}
