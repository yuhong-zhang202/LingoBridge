/**
 * @module   AvatarModal
 * @desc     更换头像弹窗 — 选择本地图片 → 预览 → 上传 Supabase Storage 并写入 user_metadata.avatar_url。
 *           匿名/未登录禁用上传入口；file input 用 sr-only 保持键盘可聚焦（Enter/Space 打开选择器）。
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX, useState, type ChangeEvent } from 'react'
import Image from 'next/image'
import { UploadCloud } from 'lucide-react'
import GradientButton from '@/components/GradientButton'
import ProfileModal from './ProfileModal'
import OrbAvatar from './OrbAvatar'
import { useAccount } from '@/hooks/useAccount'
import { uploadAvatar, validateAvatarFile } from '@/lib/db/avatar'

function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return '出了点问题，请稍后再试'
}

/**
 * 更换头像弹窗
 * @param onClose 关闭回调
 * @sideEffect    保存时上传 Storage + updateUser（触发 USER_UPDATED，IdentityCard/TopNav 自动刷新）
 */
export default function AvatarModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { account, refresh } = useAccount()
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 匿名/未登录不能写 user_metadata：禁用上传入口并提示（account 未加载完时同样先禁用）
  const canUpload = !!account && !account.isAnonymous

  function handleFile(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (!f) return
    setErr(null)
    try {
      validateAvatarFile(f)   // 选图时提前校验类型/大小，别等到保存才报错
    } catch (error) {
      setErr(messageOf(error))
      return
    }
    setFile(f)
    const reader = new FileReader()
    reader.onload = () => setPreview(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(f)
  }

  async function handleSave(): Promise<void> {
    if (!file) return
    setErr(null)
    setSaving(true)
    try {
      await uploadAvatar(file)
      refresh()   // USER_UPDATED 已广播各处刷新；显式兜底一次，语义清晰
      onClose()
    } catch (error) {
      setErr(messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProfileModal title="更换头像" onClose={onClose} className="max-w-[360px]">
      <div className="flex justify-center mb-5">
        {preview ? (
          <Image
            src={preview}
            alt="头像预览"
            width={80}
            height={80}
            unoptimized
            className="w-20 h-20 rounded-full object-cover"
          />
        ) : (
          <OrbAvatar size={80} />
        )}
      </div>

      {/* label 包裹 sr-only input：键盘可聚焦（Enter/Space 打开系统选择器），聚焦时 label 显示焦点环 */}
      <label
        className={
          'flex flex-col items-center justify-center gap-2 border border-dashed border-black/[0.15] rounded-[12px] py-6 transition-colors ' +
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-primary has-[:focus-visible]:ring-offset-2 ' +
          (canUpload ? 'cursor-pointer hover:bg-bg-muted/50' : 'opacity-50 cursor-not-allowed')
        }
      >
        <UploadCloud size={20} className="text-v2-text-muted" />
        <span className="text-[0.75rem] text-v2-text-muted">
          {canUpload ? '点击上传图片，支持 JPG / PNG，不超过 2MB' : '登录后可上传自定义头像'}
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={!canUpload}
          onChange={handleFile}
        />
      </label>

      {err && <p className="text-[0.75rem] text-error mt-2 px-1">{err}</p>}

      <GradientButton
        onClick={() => void handleSave()}
        disabled={!file || !canUpload}
        loading={saving}
        className="w-full mt-5 py-3 rounded-full text-[0.875rem] font-medium disabled:cursor-not-allowed"
      >
        {saving ? '保存中…' : '保存头像'}
      </GradientButton>
    </ProfileModal>
  )
}
