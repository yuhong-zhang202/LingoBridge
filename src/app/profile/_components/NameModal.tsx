/**
 * @module   NameModal
 * @desc     昵称编辑弹窗 —— 单文本输入（最长 20 字符，允许 emoji）。留空 / 纯空格保存即清除昵称、回退打码邮箱。
 *           保存写 user_metadata.display_name，useAccount 经 USER_UPDATED 自动刷新。壳复用 ProfileModal。
 * @author   LingoBridge
 * @created  2026-07-11
 */
'use client'
import { type JSX, useState } from 'react'
import GradientButton from '@/components/GradientButton'
import ProfileModal from './ProfileModal'
import { saveDisplayName } from '@/lib/auth'

function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return '出了点问题，请稍后再试'
}

interface NameModalProps {
  /** 当前昵称（null=未设，输入框留空） */
  currentName: string | null
  onClose: () => void
}

/**
 * 昵称编辑弹窗
 * @param currentName 当前昵称（预填输入框）
 * @param onClose     关闭回调
 * @returns           弹窗元素
 * @sideEffect        保存时 updateUser 写 user_metadata.display_name
 */
export default function NameModal({ currentName, onClose }: NameModalProps): JSX.Element {
  const [name, setName] = useState<string>(currentName ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave(): Promise<void> {
    setErr(null)
    setSaving(true)
    try {
      await saveDisplayName(name)
      onClose()
    } catch (e) {
      setErr(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProfileModal title="修改昵称" onClose={onClose} className="max-w-[400px]">
      <form onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
        <label htmlFor="display-name" className="text-[0.75rem] text-v2-text-secondary mb-1.5 block">
          昵称<span className="text-v2-text-muted">（留空则显示邮箱）</span>
        </label>
        <input
          id="display-name"
          name="display-name"
          type="text"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          placeholder="起个名字吧"
          className="w-full h-[40px] px-3.5 rounded-[10px] border border-black/[0.1] text-[1rem] lg:text-[0.8125rem] text-v2-text-primary bg-bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 transition-colors"
        />

        {err && <p role="alert" className="text-[0.75rem] text-error mt-3 px-1">{err}</p>}

        {/* 必须显式 type="submit"：GradientButton 默认 type="button"（全站 CTA 多在 form 外，默认值防误提交），
            不写就退化成普通按钮、onSubmit 永不触发＝「点了没反应」。
            不传 onClick：让点击与 Enter 同走 onSubmit，避免双触发 */}
        <GradientButton
          type="submit"
          disabled={saving}
          loading={saving}
          className="w-full mt-5 py-3 rounded-full text-[0.875rem] font-medium disabled:cursor-not-allowed"
        >
          {saving ? '保存中…' : '保存昵称'}
        </GradientButton>
      </form>
    </ProfileModal>
  )
}
