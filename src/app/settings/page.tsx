/**
 * @module   SettingsPage
 * @desc     设置页 — 账号 / 隐私 / 危险区（删除我的数据，GDPR 被遗忘权）
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import TopBar from '@/components/TopBar'
import Toast from '@/components/Toast'
import PasswordModal from '@/app/profile/_components/PasswordModal'
import { getAccount, logout, maskEmail } from '@/lib/auth'
import { getSupabase } from '@/lib/supabase'

/** 清掉所有 lingobridge: 开头的 localStorage 键（收藏/会话暂存等） */
function clearLocalUserData(): void {
  if (typeof window === 'undefined') return
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('lingobridge:')) toRemove.push(k)
  }
  toRemove.forEach((k) => localStorage.removeItem(k))
}

export default function SettingsPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)

  useEffect(() => {
    getAccount().then((acct) => {
      setLoggedIn(!!acct && !acct.isAnonymous && !!acct.email)
      setEmail(acct?.email ?? null)
    }).catch(() => { setLoggedIn(false); setEmail(null) })
  }, [])

  const displayEmail = loggedIn ? (email ? maskEmail(email) : '我的账号') : '未登录'

  const handleConfirmDelete = useCallback(async (): Promise<void> => {
    setDeleting(true)
    try {
      const { data: { session } } = await getSupabase().auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('未授权')
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? '删除失败，请稍后再试')
      }
      clearLocalUserData()
      await logout()
      router.replace('/')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败，请稍后再试')
      setDeleting(false)
      setConfirming(false)
    }
  }, [router])

  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title="设置" />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-10 relative z-10">
        {/* 账号 */}
        <section className="mb-6">
          <h2 className="text-[12px] font-semibold text-v2-text-muted tracking-[0.4px] mb-2">账号</h2>
          <div className="flex flex-col gap-2">
            <div className="bg-white rounded-[16px] border border-black/[0.05] px-4 py-3 flex items-center justify-between">
              <span className="text-[13px] text-v2-text-secondary">邮箱</span>
              <span className="text-[14px] text-v2-text-primary">{displayEmail}</span>
            </div>
            {/* 仅登录态：匿名/未登录用户没有密码可改 */}
            {loggedIn && (
              <button
                onClick={() => setPasswordOpen(true)}
                className="w-full bg-white rounded-[16px] border border-black/[0.05] px-4 py-3 flex items-center justify-between active:scale-[0.99] transition-transform duration-150"
              >
                <span className="text-[14px] text-v2-text-primary">修改密码</span>
                <ChevronRight size={15} className="text-v2-text-muted" />
              </button>
            )}
          </div>
        </section>

        {/* 隐私 */}
        <section className="mb-6">
          <h2 className="text-[12px] font-semibold text-v2-text-muted tracking-[0.4px] mb-2">隐私</h2>
          <div className="flex flex-col gap-2">
            <Link href="/privacy" className="block bg-white rounded-[16px] border border-black/[0.05] px-4 py-3 text-[14px] text-v2-text-primary">
              《隐私政策》
            </Link>
            <Link href="/privacy/beta" className="block bg-white rounded-[16px] border border-black/[0.05] px-4 py-3 text-[14px] text-v2-text-primary">
              内测数据处理说明
            </Link>
          </div>
        </section>

        {/* 危险区 */}
        <section>
          <h2 className="text-[12px] font-semibold text-v2-text-muted tracking-[0.4px] mb-2">危险区</h2>
          <p className="text-[12px] text-v2-text-muted leading-relaxed mb-3 px-1">
            删除后将永久移除你的账号、所有故事和练习记录，不可恢复。
          </p>
          <button
            onClick={() => setConfirming(true)}
            className="w-full bg-white border border-error text-error text-[14px] font-medium rounded-full py-3 active:scale-[0.97] transition-transform duration-150"
          >
            删除我的数据
          </button>
        </section>
      </div>

      {/* 确认模态 */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div
            className="w-full max-w-[430px] bg-white rounded-t-[20px] px-5 pt-5 animate-fade-up"
            style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom))' }}
          >
            <h3 className="text-[16px] font-semibold text-v2-text-primary text-center">确定删除全部数据？</h3>
            <p className="text-[13px] text-v2-text-secondary text-center mt-2 leading-relaxed">
              此操作不可恢复，将永久删除你的账号、所有故事和练习记录。
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="btn-ghost flex-1 h-[48px] disabled:opacity-50 active:scale-[0.97] transition-transform duration-150"
              >
                取消
              </button>
              <button
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
                className="flex-1 h-[48px] bg-white border border-error text-error text-[14px] font-medium rounded-full active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
              >
                {deleting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordOpen && <PasswordModal email={email} onClose={() => setPasswordOpen(false)} />}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
