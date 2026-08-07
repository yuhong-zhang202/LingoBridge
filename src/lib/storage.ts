/**
 * @module   storage
 * @desc     浏览器本地存储封装 — 本场暂存(sessionStorage)。
 *           练习「一场」的身份（开场 id + 题目参数）与优化句子的暂存都收在这里：练习中边攒边存、
 *           页面被手机浏览器回收后重载能按 id+参数回填，对外仍只暴露 getSessionPolishes(): SessionPolish[]。
 *           三类持久收藏(saved_phrases / saved_words / saved_pronunciations)均已落库 Supabase
 *           （见 lib/db/saved-*.ts），不再存本地。
 *           试用墙标记(trial_done)已随 RequireAccountGate 一并移除：转化闸统一由服务端 402 →
 *           QuotaReached variant="trial" 承担，localStorage 判匿名身份本就清缓存即可绕过。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import type { SessionPolish } from '@/lib/types'

const SESSION_KEY = 'lingobridge:session_polishes'
/** 本场练习 id（开场时写、只有入口能写）。与句子分两个键：id 在、句子被清 = 开了新的一场 */
const PRACTICE_SESSION_ID_KEY = 'lingobridge:practice_session_id'

// ── 本场暂存：practice → feedback ──
//
// 【为什么要存 id + 题目参数，而不是像以前那样只存一个裸数组】
// 以前 polishHistory 全场只活在 React state 里，点「结束」才写一次 sessionStorage。手机浏览器
// （iOS Safari / Android Chrome）内存吃紧时会主动回收后台标签页，而口语练习恰恰最容易中途锁屏、切 App：
// 页面被回收后重载 → 内存里的句子全没了 → 用户点「结束」写进去的是空数组 → 反馈页显示「这次没有要回顾的句子」。
// 桌面浏览器基本不回收标签页，所以线上表现是「只有手机上会」。
//
// 修法是三件事一起做（缺一件另一件就白做）：入口开场 → 练习中边攒边存 → 重载后按 id+参数回填。
// id 与参数就是回填的判据：sessionStorage 按 tab 存、重载后还在，所以「重载」（不重新开场 → 回填）
// 与「新的一场」（入口重新开场 → 清空）能被区分开。
//
// 兜底原则：任何一处对不上、读不出、解析失败 → 一律当作「新的一场、从空开始」，即修复前的行为。
// 本模块永不能比修复前更糟。

/** 一场练习的身份：练习页从 URL query 读到的四个参数，用来判断「存的这批句子是不是当前这一场的」 */
export interface PracticeSessionScope {
  /** ?questionId= */
  questionId: string
  /** ?storyId=（泛题池流为空串） */
  storyId: string
  /** ?level=（缺省 '6.0'，取值由练习页统一兜底，本模块只做原样比对） */
  level: string
  /** ?review=1 */
  review: boolean
}

/** sessionStorage 里 SESSION_KEY 的新格式 */
interface SessionPolishEnvelope {
  /** 写入时的本场 id（= 开场时生成的那个） */
  sessionId: string
  /** 写入时的题目参数 */
  scope: PracticeSessionScope
  /** 已攒下的优化条目 */
  items: SessionPolish[]
}

/** 照抄 flow-id.ts 的写法：优先 crypto.randomUUID，退化到时间戳+随机串。不引新依赖。 */
function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 把 JSON.parse 的产物当作新格式信封解读。
 * @param parsed JSON.parse 的结果
 * @returns      解读成功返回信封，否则 null（老格式裸数组 / 脏数据都走 null）
 *
 * 【只校验信封本身，不校验 items 里每一条的字段形状】——那是刻意的：条目形状的校验修复前也没有
 * （直接 as SessionPolish[]），这里加一道自造的严格校验，反而可能因为我写错而把好数据判死，
 * 违反「永不能比修复前更糟」。信封字段才是回填判据的依据，必须校验。
 */
function asEnvelope(parsed: unknown): SessionPolishEnvelope | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const env = parsed as Partial<SessionPolishEnvelope>
  if (typeof env.sessionId !== 'string') return null
  if (!Array.isArray(env.items)) return null
  const scope = env.scope
  if (typeof scope !== 'object' || scope === null) return null
  if (typeof scope.questionId !== 'string' || typeof scope.storyId !== 'string') return null
  if (typeof scope.level !== 'string' || typeof scope.review !== 'boolean') return null
  return { sessionId: env.sessionId, scope, items: env.items }
}

/** 两组题目参数是否指向同一场练习（四个字段全等才算） */
function sameScope(a: PracticeSessionScope, b: PracticeSessionScope): boolean {
  return a.questionId === b.questionId && a.storyId === b.storyId
    && a.level === b.level && a.review === b.review
}

/**
 * 开一场练习：生成本场 id + 清掉上一场遗留的优化句子。
 *
 * ⚠️【必须在「进入练习页的入口」调用，不能在练习页自己里面调用】——这是整个修复的关键：
 *    id 存在 sessionStorage 里，页面重载时它还在。在入口调用，「重载」不会重新开场（→ 句子被回填），
 *    「点进新的一场」才会重新开场（→ 句子被清空）。若改成在练习页里调用，重载也会开新场、
 *    照样清空句子，等于什么都没修。入口清单与守卫见 src/__tests__/practice-session-entry-rule.test.ts。
 *
 * @returns    新的本场 id；无 window 或存储不可用时返回空串（此时后续一律不回填，退回修复前的行为）
 * @sideEffect 写 sessionStorage 的本场 id，并删除上一场的优化句子
 */
export function startPracticeSession(): string {
  if (typeof window === 'undefined') return ''
  try {
    const id = randomId()
    // 【顺序不能反】先写新 id、再清旧句子：万一清不掉（removeItem 抛错），留下的是「新 id + 内部记着旧 id
    // 的旧句子」，回填判据 env.sessionId !== 当前 id 天然不通过 → 这一场老老实实从空开始。
    // 反过来先清后写，一旦中途抛错就会留下「旧 id + 旧句子」这对刚好互相吻合的组合，
    // 上一场的句子会被当成本场的串进来（session-polishes.test.ts 的 removeItem 抛异常那条就是守这个）。
    sessionStorage.setItem(PRACTICE_SESSION_ID_KEY, id)
    sessionStorage.removeItem(SESSION_KEY)
    return id
  } catch (e) {
    // 存储不可用（无痕模式 / 配额）：尽力把两个键都抹掉，让判据一定不通过 —— 这一场不回填，等同修复前。
    try {
      sessionStorage.removeItem(PRACTICE_SESSION_ID_KEY)
      sessionStorage.removeItem(SESSION_KEY)
    } catch { /* 连删都删不了：上面那条「先写 id」已保证 id 与旧句子对不上，仍不会串场 */ }
    console.error('[storage] 开场失败，本场句子将不做中途暂存', e)
    return ''
  }
}

/**
 * 写入本场优化句子（练习页每优化成功一句写一次，点「结束」再写一次收口）。
 *
 * ⚠️ try/catch 不能删：本函数是 practice/page.tsx handleEnd 的【第一行】，其后还有打卡记录与
 *    navigate('/feedback')；而包在外面的 useAsyncAction 只有 try/finally、没有 catch。
 *    一旦 setItem 抛异常（Safari 无痕模式、iOS 存储限制、配额），异常会一路冒出去变成无人接管的
 *    promise rejection —— 打卡不记、页面不跳、不报错，用户看到的是「点了结束没反应」。
 *    本文件其余写函数（markPracticeIntroSeen 等）一直都有这层保护，唯独这里漏了。
 *
 * @param items 本场优化条目（全量覆盖写，不做增量合并）
 * @param scope 本场题目参数，随句子一起存，供重载后核对是不是同一场
 * @returns     是否写入成功（false = 存储不可用，句子这一路没了；调用方据此决定是否告知用户）
 */
export function setSessionPolishes(items: SessionPolish[], scope: PracticeSessionScope): boolean {
  if (typeof window === 'undefined') return false
  try {
    const sessionId = sessionStorage.getItem(PRACTICE_SESSION_ID_KEY) ?? ''
    const envelope: SessionPolishEnvelope = { sessionId, scope, items }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(envelope))
    return true
  } catch (e) {
    // 不静默：这条路失败等于用户这场的句子全丢，反馈页会显示「这次没有要回顾的句子」——
    // 那句文案在这种情况下是误导（用户明明标了星）。留日志供排查，是否提示交调用方。
    console.error('[storage] 本场优化句子写入失败，反馈页将没有句子', e)
    return false
  }
}

/**
 * 读本场优化句子（反馈页用）。签名与语义与修复前完全一致：拿到什么就展示什么，不做身份核对
 * ——反馈页读的是练习页刚交接过来的那一批，核对是回填那一侧（resumeSessionPolishes）的事。
 * @returns 优化条目数组；无 / 读不出 / 解析失败一律空数组
 */
export function getSessionPolishes(): SessionPolish[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    // 老格式（裸数组）：发版那一刻正在练习的用户，存的就是这个。必须读得出、不能丢。
    if (Array.isArray(parsed)) return parsed as SessionPolish[]
    const env = asEnvelope(parsed)
    return env === null ? [] : env.items
  } catch {
    return []
  }
}

/**
 * 页面重载后取回本场已攒下的句子（练习页 usePolish 初始化时唯一调用点）。
 * @param  scope 当前 URL 上的题目参数
 * @returns      两个判据都通过时返回已攒的条目，否则空数组（= 从空开始，等同修复前）
 *
 * 判据：① 本场 id 存在，且与存的那一批写入时的 id 相同；② 题目参数与当前 URL 完全一致。
 * ②不能省：用户可能从浏览器历史/书签直接打开 /practice?...，这条路不经入口、不会开场，
 * 而 sessionStorage 里可能还留着上一场的句子 —— 参数对不上就不回填。
 */
export function resumeSessionPolishes(scope: PracticeSessionScope): SessionPolish[] {
  if (typeof window === 'undefined') return []
  try {
    const sessionId = sessionStorage.getItem(PRACTICE_SESSION_ID_KEY)
    if (sessionId === null || sessionId === '') return []
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw === null) return []
    // 老格式裸数组没有 id / 参数可核对 → asEnvelope 返回 null → 不回填。
    // 只影响「发版瞬间正在练习且恰好又被重载」的极少数人，且他们修复前本来就会丢，不算变糟。
    const env = asEnvelope(JSON.parse(raw) as unknown)
    if (env === null) return []
    if (env.sessionId !== sessionId) return []
    if (!sameScope(env.scope, scope)) return []
    return env.items
  } catch {
    return []
  }
}

/** 清掉本场暂存句子（反馈页处理完所有卡片时调用；本场 id 留着无害，判据对不上自然不会被回填）。 */
export function clearSessionPolishes(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* 存储不可用：读也读不出来，等同已清 */
  }
}

// ── 练习页功能引导：首次进入弹一次（跨会话持久 → localStorage） ──
const PRACTICE_INTRO_SEEN_KEY = 'lingobridge:practice_intro_seen'

/** 是否已看过练习页功能引导。SSR / localStorage 不可用（隐私模式）时当作「已看过」，绝不误弹或报错。 */
export function hasSeenPracticeIntro(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(PRACTICE_INTRO_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/** 标记已看过；隐私模式写不了则静默（本次会话内靠组件 state 已不再弹）。 */
export function markPracticeIntroSeen(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PRACTICE_INTRO_SEEN_KEY, '1')
  } catch {
    /* 隐私模式：忽略 */
  }
}

// ── 版本更新公告：按版本号只弹一次（首页公告卡 ChangelogAnnouncement 用；与顶栏铃铛红点各用各的 key，互不影响） ──
const CHANGELOG_SEEN_PREFIX = 'lingobridge:changelog_seen_'

/**
 * 是否已看过某版本的更新公告。SSR / localStorage 不可用（隐私模式）时当作「已看过」，绝不误弹或报错。
 * @param  version  版本号（CHANGELOG[0].version，如 'v0.8.0'）
 * @returns         是否已看过该版本公告
 */
export function hasSeenChangelog(version: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(`${CHANGELOG_SEEN_PREFIX}${version}`) === '1'
  } catch {
    return true
  }
}

/**
 * 标记某版本公告已看过（关闭公告卡时调用）；隐私模式写不了则静默。
 * @param  version  版本号（CHANGELOG[0].version）
 * @sideEffect      写 localStorage
 */
export function markChangelogSeen(version: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${CHANGELOG_SEEN_PREFIX}${version}`, '1')
  } catch {
    /* 隐私模式：忽略 */
  }
}

// ── 目标分提醒弹窗：给「未设目标分」的注册用户提醒一次「词组已按目标分出」（首页 TargetBandNudge 用；只弹一次） ──
const TARGETBAND_NUDGE_SEEN_KEY = 'lingobridge:targetband_nudge_seen'

/** 是否已看过目标分提醒。SSR / localStorage 不可用（隐私模式）时一律当作「已看过」，绝不误弹或报错。 */
export function hasSeenTargetBandNudge(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(TARGETBAND_NUDGE_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/** 标记目标分提醒已看过（三种关闭路径都调）；隐私模式写不了则静默（本次会话靠组件 state 已不再弹）。 */
export function markTargetBandNudgeSeen(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TARGETBAND_NUDGE_SEEN_KEY, '1')
  } catch {
    /* 隐私模式：忽略 */
  }
}
