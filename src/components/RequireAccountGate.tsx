/**
 * @module   RequireAccountGate
 * @desc     试用墙守卫 — 已登录永远放行；匿名用户首次免费走完整圈（到达 /feedback 即标记），
 *           标记置位后在被守卫的入口（录音/题库/素材库）整页显示登录引导。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { getAccount } from '@/lib/auth'
import { isTrialDone } from '@/lib/storage'
import LoginPrompt from '@/app/profile/_components/LoginPrompt'

type GateState = 'loading' | 'allow' | 'block'

interface Props {
  children: ReactNode
}

export default function RequireAccountGate({ children }: Props): JSX.Element {
  const router = useRouter()
  const [state, setState] = useState<GateState>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const acct = await getAccount()
        if (cancelled) return
        const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
        if (loggedIn) {
          setState('allow')
        } else if (isTrialDone()) {
          setState('block')
        } else {
          setState('allow')
        }
      } catch {
        if (!cancelled) setState(isTrialDone() ? 'block' : 'allow')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state === 'loading') return <div className="flex-1" />
  if (state === 'allow') return <>{children}</>

  // block
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <LoginPrompt
        title="想继续练习？登录后接着用"
        subtitle="你刚才的故事和收藏都在，登录一条都不会丢"
      />
      <button
        onClick={() => router.push('/')}
        className="text-[13px] text-v2-text-muted mt-4"
      >
        返回首页
      </button>
    </div>
  )
}
