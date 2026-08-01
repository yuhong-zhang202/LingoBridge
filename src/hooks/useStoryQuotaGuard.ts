/**
 * @module   useStoryQuotaGuard
 * @desc     「建新故事」入口守卫共享 hook —— 首页（开始录音 / 移动端文本输入 / 桌面「或用文字输入」）、
 *           /write（提交 / 切换到语音）、/recording（完成）、/practice-question（添加语料）
 *           七个入口共用一份判断，保证行为一致。
 *
 *           两类额度、两种文案，走同一条判定链：
 *           · 匿名试用用户 → 语料【总条数】≥ ANON_CORPUS_LIMIT → QuotaReached variant="trial"（引导注册）
 *           · 注册用户     → 【当月】语料数 ≥ STORY_MONTHLY_LIMIT → QuotaReached variant="story"
 *           匿名那道闸此前只在保存语料（/api/corpus 402）时才触发，用户录完/写完整理完才被告知试用结束，
 *           等于白输入一场 —— 本 hook 把它前置到用户开始投入内容之前。
 *
 *           范式沿用原页面内 blockedByStoryQuota：挂载时预取（点击零延迟）→ 预取未就绪则现场查 →
 *           查不到 / 出错一律放行（fail-open）。服务端 402 仍是硬防线，前端只负责「早点说」。
 *
 *           【只拦建新故事，不拦改已有故事】本 hook 只挂在上述七个「新建」入口上；编辑/重新整理已有语料
 *           走的是 /restructure?corpusId=...（从 matching / analysis / 我的故事进入），不经过这些入口，
 *           故匿名用户建满 1 条后仍可回去改那条（其容错余量由 ANON_RESTRUCTURE_LIMIT 管）。
 *
 * @author   LingoBridge
 * @created  2026-07-20
 */
'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { getAccount } from '@/lib/auth'
import { countCorpusThisMonth, countCorpusTotal, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { ANON_CORPUS_LIMIT } from '@/lib/constants'
import { isInternalAccount } from '@/lib/internal-accounts'

/** 额度覆盖层变体：trial = 匿名试用结束（引导注册）；story = 注册用户当月故事额度用尽 */
export type StoryQuotaVariant = 'trial' | 'story'

interface QuotaState {
  over: boolean
  variant: StoryQuotaVariant
}

export interface StoryQuotaGuard {
  /** 非 null 时调用方渲染 <QuotaReached variant={blockedVariant} asOverlay />；null = 不弹 */
  blockedVariant: StoryQuotaVariant | null
  /** 入口守卫：额度已满时置 blockedVariant 并返回 true（调用方须中止后续动作）；其余一律 false */
  checkBlocked: () => Promise<boolean>
  /** 关闭覆盖层 */
  dismiss: () => void
}

/**
 * 核当前账号的建新故事额度。
 * @returns  额度状态；未登录 / 无 session 返回 null（不受本 hook 约束，放行）
 * @throws   Error —— 计数查询失败（由调用方 catch 成放行）
 */
async function resolveQuota(): Promise<QuotaState | null> {
  const acct = await getAccount()
  if (!acct) return null
  // 内部账户豁免：客户端预检也放行（与服务端 corpus 闸 + bumpDailyUsage 同一套 isInternalAccount），
  // 否则用户在首页/write 等入口的客户端预检就被弹「额度已用完」、根本走不到已豁免的服务端。
  if (isInternalAccount(acct.id)) return { over: false, variant: 'story' }
  // 匿名试用：总条数口径。注意仅 isAnonymous 才算匿名 —— 「非匿名但无 email」保持原有放行语义，不改判。
  if (acct.isAnonymous) {
    return { over: (await countCorpusTotal()) >= ANON_CORPUS_LIMIT, variant: 'trial' }
  }
  if (!acct.email) return null
  return { over: (await countCorpusThisMonth()) >= STORY_MONTHLY_LIMIT, variant: 'story' }
}

/**
 * 建新故事入口守卫。
 * @returns  { blockedVariant, checkBlocked, dismiss }
 * @sideEffect  挂载时后台预取一次额度（不渲染、不阻塞页面，失败静默）
 */
export function useStoryQuotaGuard(): StoryQuotaGuard {
  // 预取结果：null = 尚未取到 / 不受额度约束（点击时再现取）。只预取、不渲染 ——
  // 额度提示绝不在加载完成时自动盖住页面，仅在用户真正点入口时才弹。
  const [quota, setQuota] = useState<QuotaState | null>(null)
  const [blockedVariant, setBlockedVariant] = useState<StoryQuotaVariant | null>(null)
  // 供 checkBlocked 读最新预取值又不进依赖数组（保持回调引用稳定，recording 页把它放进 useCallback 依赖）
  const quotaRef = useRef<QuotaState | null>(null)
  quotaRef.current = quota

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const q = await resolveQuota()
        if (!cancelled && q) setQuota(q)
      } catch { /* 静默：不挡正常流程 */ }
    })()
    return () => { cancelled = true }
  }, [])

  const checkBlocked = useCallback(async (): Promise<boolean> => {
    let q = quotaRef.current
    if (q === null) {
      try {
        q = await resolveQuota()
        if (q) setQuota(q)
      } catch { return false }   // 静默：核不准额度不挡用户，服务端 402 仍是硬防线
    }
    if (q?.over) { setBlockedVariant(q.variant); return true }
    return false
  }, [])

  const dismiss = useCallback((): void => setBlockedVariant(null), [])

  return { blockedVariant, checkBlocked, dismiss }
}
