/**
 * @module   story-missing
 * @desc     【仅服务端】「该有语料却取不到」的判定与埋点 —— flow.story_missing 的唯一发点。
 *
 *           背景（既有技术债，非新 bug）：getCorpusByIdServer 取不到正文时返回 null，四个消费方里
 *           【只有匹配会喊】（/api/matching 直接 400），另外三个全是静默降级 ——
 *           analysis 两条路与 phrases 退回「通用分析」、practice 让教练走 fallback 台词。
 *           降级行为按产品方拍板【保持不变】（用户已经讲完故事了，当场甩他一个错误不如给一份通用的），
 *           本模块只负责把这件事从「界面看不出、看板查不到」变成一条可查的服务端事件。
 *
 *   【为什么判定要收口在这里】触发条件有一半是反直觉的：`storyId` 为空是【合法】的通用分析场景
 *   （用户没绑语料），那种流量绝不能发事件 —— 写反一次，事件就被正常流量淹没、埋了等于没埋。
 *   四个触发点各抄一遍 `if` 就是给这个反写留四次机会，故判定只有 isStoryMissing 一份。
 *
 *   🔴【隐私】props 只带 stage 一个枚举；语料 id 走 flow_events 的 story_id 【列】、用户走 user_id 列
 *   —— 故事正文一个字都不进日志（见 event-schema.ts 的 StoryMissingProps）。
 *
 * @author   LingoBridge
 * @created  2026-08-27
 */
import 'server-only'
import { logEvent } from './events'
import { isQaRequest } from './qa-traffic'
import type { StoryMissingProps, StoryMissingStage } from './event-schema'

/**
 * 这一次请求是不是「用户绑了语料、正文却取不到」。
 * @param  storyId  请求里带的语料 id（空串 = 用户没绑语料，属【合法】的通用分析场景）
 * @param  story    实际解析出来、真要喂给 AI 的正文（null / undefined / 空串 / 全空白都算取不到）
 * @returns         两个条件同时成立才为 true
 */
export function isStoryMissing(storyId: string, story: string | null | undefined): boolean {
  return storyId !== '' && !story?.trim()
}

/**
 * 记一条 flow.story_missing。调用前必须先过 isStoryMissing —— 本函数不再判条件，只负责发。
 * @param  a.req      当前请求（只读 x-flow-id / QA 头，不消费 body）
 * @param  a.stage    发生在哪一段（四个静默降级点各一格）
 * @param  a.storyId  语料 id，走 story_id 列（UUID 形态校验在 logEvent 里）
 * @param  a.userId   已鉴权的用户 id
 * @returns           Promise<void>；写失败由 logEvent 内部吞掉，绝不阻断主链路
 * @sideEffect        向 flow_events 插一行（service_role）
 */
export async function logStoryMissing(a: {
  req: Request
  stage: StoryMissingStage
  storyId: string
  userId: string
}): Promise<void> {
  const props: StoryMissingProps = { stage: a.stage }
  await logEvent({
    event: 'flow.story_missing',
    flowId: a.req.headers.get('x-flow-id'),
    storyId: a.storyId,
    userId: a.userId,
    props,
    // 漏了它，产品方自测触发的降级会混进真实数据里；本事件量本就稀少，掺一条就够歪结论
    isQa: isQaRequest(a.req, a.userId),
  })
}
