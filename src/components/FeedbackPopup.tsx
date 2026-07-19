/**
 * @module   FeedbackPopup
 * @desc     反馈小弹窗 — 单选分类 + 可选补充文字 + 可选邮箱；按入口/路由决定选项与文案。
 *           写入 feedback 表，kind='manual'，context 含 category/route/上下文 id/email。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { Check } from 'lucide-react'
import Card from '@/components/Card'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import { submitFeedback } from '@/lib/db/feedback'

interface Option { key: string; label: string }

interface Spec {
  title: string
  subtitle?: string
  options: Option[]
  lockedKey?: string
  alwaysEmail?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  source?: 'profile' | 'password'
}

function resolveSpec(source: Props['source'], pathname: string): Spec {
  if (source === 'password') {
    return {
      title: '联系开发者',
      subtitle: '收不到重置密码邮件？留下邮箱，开发者会手动给你发重置链接',
      options: [{ key: 'password_reset', label: '联系开发者' }],
      lockedKey: 'password_reset',
      alwaysEmail: true,
    }
  }
  if (source === 'profile') {
    return {
      title: '帮助与反馈',
      options: [
        { key: 'suggestion',  label: '功能建议' },
        { key: 'bug',         label: '遇到问题' },
        { key: 'contact_dev', label: '联系开发者' },
        { key: 'other',       label: '其他' },
      ],
    }
  }
  if (pathname.startsWith('/analysis')) {
    return {
      title: '帮助与反馈',
      subtitle: '关于你刚才的这次分析',
      options: [
        { key: 'analysis_inaccurate', label: '分析不准确' },
        { key: 'other',               label: '其他' },
      ],
    }
  }
  if (pathname.startsWith('/matching')) {
    return {
      title: '帮助与反馈',
      subtitle: '关于这次题目匹配',
      options: [
        { key: 'match_inaccurate', label: '匹配不准确' },
        { key: 'other',            label: '其他' },
      ],
    }
  }
  return {
    title: '帮助与反馈',
    options: [
      { key: 'suggestion', label: '功能建议' },
      { key: 'bug',        label: '遇到问题' },
      { key: 'other',      label: '其他' },
    ],
  }
}

function readContextIds(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const out: Record<string, string> = {}
  for (const k of ['corpusId', 'questionId', 'storyId']) {
    const v = sp.get(k)
    if (v) out[k] = v
  }
  return out
}

export default function FeedbackPopup({ open, onClose, source }: Props) {
  const pathname = usePathname() ?? '/'
  const spec = useMemo(() => resolveSpec(source, pathname), [source, pathname])

  const [selectedKey, setSelectedKey] = useState<string>(spec.lockedKey ?? '')
  const [text, setText]               = useState('')
  const [email, setEmail]             = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [done, setDone]               = useState(false)
  const [err, setErr]                 = useState<string | null>(null)

  // 开/关时重置内部状态
  useEffect(() => {
    if (open) {
      setSelectedKey(spec.lockedKey ?? '')
      setText('')
      setEmail('')
      setSubmitting(false)
      setDone(false)
      setErr(null)
    }
  }, [open, spec.lockedKey])

  const showEmail = spec.alwaysEmail === true || selectedKey === 'contact_dev'

  const selectedLabel = useMemo(
    () => spec.options.find(o => o.key === selectedKey)?.label ?? '',
    [spec.options, selectedKey],
  )

  // 提交校验：按选中类型分三类
  // 选填类（选了就能交）：analysis_inaccurate / match_inaccurate
  // 必填文字类：suggestion / bug / other
  // 必填邮箱类（文字仍选填）：contact_dev / password_reset
  const requiresText  = selectedKey === 'suggestion' || selectedKey === 'bug' || selectedKey === 'other'
  const requiresEmail = selectedKey === 'contact_dev' || selectedKey === 'password_reset'
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const canSubmit =
    !!selectedKey &&
    (!requiresText  || text.trim().length > 0) &&
    (!requiresEmail || EMAIL_RE.test(email.trim())) &&
    !submitting

  const textPlaceholder = requiresText
    ? '请描述你的建议或遇到的问题'
    : '补充说明（选填）'

  const handleSubmit = useCallback(async () => {
    if (!selectedKey) { setErr('请先选择一项'); return }
    setErr(null)
    setSubmitting(true)
    try {
      const context: Record<string, unknown> = {
        category: selectedKey,
        route: pathname,
        ...readContextIds(),
      }
      const trimmedEmail = email.trim()
      if (showEmail && trimmedEmail) context.email = trimmedEmail
      const message = text.trim() || `[${selectedLabel}]`
      await submitFeedback({ kind: 'manual', message, context })
      setDone(true)
      window.setTimeout(onClose, 1200)
    } catch (e) {
      const msg = (typeof e === 'object' && e !== null && 'message' in e)
        ? String((e as { message: unknown }).message)
        : '提交失败，请稍后再试'
      setErr(msg)
    } finally {
      setSubmitting(false)
    }
  }, [selectedKey, selectedLabel, text, email, showEmail, pathname, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <Card className="max-w-[300px] w-full px-[18px] py-[18px] animate-fade-up" >
        <div onClick={(e) => e.stopPropagation()}>
          {done ? (
            <div className="flex flex-col items-center py-4">
              <Check size={28} className="text-brand-accent mb-2" />
              <p className="text-[14px] text-v2-text-primary">已收到，谢谢你的反馈</p>
            </div>
          ) : (
            <>
              <h3 className="text-[15px] font-semibold text-v2-text-primary text-center">{spec.title}</h3>
              {spec.subtitle && (
                <p className="text-[12px] text-v2-text-muted text-center mt-1.5 leading-relaxed">{spec.subtitle}</p>
              )}

              <div className="flex flex-wrap justify-center gap-2 mt-3.5">
                {spec.options.map(opt => {
                  const selected = selectedKey === opt.key
                  const locked = spec.lockedKey === opt.key
                  return (
                    <Chip
                      key={opt.key}
                      variant={selected ? 'gradient' : 'ghost'}
                      size="sm"
                      onClick={() => { if (!locked) setSelectedKey(opt.key) }}
                    >
                      {opt.label}
                    </Chip>
                  )
                })}
              </div>

              <div className="surface mt-3 px-3 py-2">
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={textPlaceholder}
                  rows={3}
                  className="w-full bg-transparent text-[16px] lg:text-[13px] text-v2-text-primary placeholder:text-v2-text-muted outline-none resize-none leading-relaxed"
                />
              </div>

              {showEmail && (
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="你的注册邮箱"
                  autoComplete="email"
                  className="w-full bg-white border border-neutral-line rounded-[16px] px-4 py-3 text-[16px] text-v2-text-primary placeholder:text-neutral-mute outline-none focus:border-brand-primary transition-colors mt-3"
                />
              )}

              {err && <p className="text-[12px] text-error mt-2 px-1">{err}</p>}

              <GradientButton
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className="w-full mt-4 py-2.5 rounded-full text-[13px] font-medium disabled:cursor-not-allowed"
              >
                {submitting ? '提交中…' : '提交反馈'}
              </GradientButton>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
