/**
 * @module   practice-session-record
 * @desc     打卡记录（practice_sessions）写库的重试与「没存上」告知。
 *
 *   为什么单开一个模块：这件事横跨两个页面 —— 写入从练习页发起、提示要在反馈页显示。
 *   用户点「结束」后立刻被送去反馈页，若在练习页原地 await 重试，跳转就得卡住等（最坏几秒白屏按钮），
 *   而重试恰恰是最不该让用户等的事。故做成「发起即走」：重试在后台跑完（客户端路由跳转不会中断这段
 *   Promise，页面组件卸载了它照样活着），最终失败时落一枚 sessionStorage 标记 + 派一个窗口事件，
 *   由反馈页负责显示——跳转冲不掉，先到后到都能接住。
 *
 *   ⚠️ 文案红线：打卡记录（practice_sessions，数据库）与本场优化的句子（sessionStorage，见 storage.ts）
 *   是两条完全独立的路。打卡写失败绝不影响句子，提示必须明说这一点，否则用户会以为句子丢了而恐慌。
 *
 * @author   LingoBridge
 * @created  2026-07-20
 */
import { recordPracticeSession } from './db/practice-sessions'

/**
 * 重试间隔（毫秒）。首试立刻，其后按此表退避，共 3 次尝试、约 3.2s 内跑完。
 * 取值依据：这是「用户已经离开练习页」的后台动作，长度只需覆盖常见的瞬时抖动（网络切换、Supabase 偶发 5xx），
 * 且必须在用户读完反馈页第一张卡之前有结论 —— 拖到十几秒后才弹提示，用户早忘了自己刚结束练习。
 * 更多次数也救不了真正的故障（RLS 拒绝、离线），只会让提示来得更晚。
 */
const RETRY_DELAYS_MS = [800, 2400]

/** 失败标记键（sessionStorage）：重试先于反馈页挂载结束时，用它把结果传过去 */
const FAIL_FLAG_KEY = 'lingobridge:practice_record_failed'

/** 失败标记的有效期：超过即视为上一场的残留，丢弃不提示（避免在无关的下一场里弹出陈旧告警） */
const FAIL_FLAG_TTL_MS = 120_000

/** 重试结束仍失败时派发的窗口事件：反馈页已挂载时走这条（标记走不到它） */
export const PRACTICE_RECORD_FAILED_EVENT = 'lingobridge:practice-record-failed'

/**
 * 打卡失败提示文案。
 * 「不影响你刚优化的句子」是必须保留的半句：句子存在 sessionStorage、收藏走另一张表，
 * 与本次失败毫无关系；不说清楚，用户会以为这一场的成果全没了。
 */
export const PRACTICE_RECORD_FAILED_MESSAGE =
  '这次练习的打卡记录没能保存（不影响你刚优化的句子，可以照常收藏）'

/** 延时 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 带重试地写入一次练习场次记录。
 * @param questionId  题目 UUID，无则 null
 * @param isReview    是否复练
 * @returns           true = 某次尝试成功；false = 3 次全失败
 * @sideEffect        最多 3 次 practice_sessions insert；失败时 console.warn 留痕
 */
export async function retryRecordPracticeSession(questionId: string | null, isReview: boolean): Promise<boolean> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1])
    try {
      await recordPracticeSession(questionId, isReview)
      return true
    } catch (e) {
      console.warn(`[Practice] 记录练习场次失败（第 ${attempt + 1} 次）`, e)
    }
  }
  return false
}

/**
 * 发起打卡记录写入，不阻塞调用方（调用后可立即跳转）。全部重试失败时落标记 + 派事件，供反馈页提示用户。
 * @param questionId  题目 UUID，无则 null
 * @param isReview    是否复练
 * @sideEffect        后台写库；失败时写 sessionStorage 标记并派发 window 事件
 */
export function startPracticeSessionRecord(questionId: string | null, isReview: boolean): void {
  void retryRecordPracticeSession(questionId, isReview).then((ok) => {
    if (ok || typeof window === 'undefined') return
    // 两条告知路径都留：反馈页已挂载 → 事件立刻接住；还没挂载 → 标记等它来取。
    sessionStorage.setItem(FAIL_FLAG_KEY, String(Date.now()))
    window.dispatchEvent(new Event(PRACTICE_RECORD_FAILED_EVENT))
  })
}

/**
 * 读取并清除「打卡记录写失败」标记（读到即消费，绝不重复提示）。
 * @returns  true = 刚刚有一次打卡没存上，且发生在有效期内
 */
export function consumePracticeRecordFailure(): boolean {
  if (typeof window === 'undefined') return false
  const raw = sessionStorage.getItem(FAIL_FLAG_KEY)
  if (raw === null) return false
  sessionStorage.removeItem(FAIL_FLAG_KEY)
  const at = Number(raw)
  return Number.isFinite(at) && Date.now() - at <= FAIL_FLAG_TTL_MS
}
