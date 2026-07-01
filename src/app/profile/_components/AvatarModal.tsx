/**
 * @module   AvatarModal
 * @desc     更换头像弹窗 — 选择本地图片 → 预览 → 保存；无图片时展示当前 Orb 头像
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useState, type ChangeEvent } from 'react'
import Image from 'next/image'
import { UploadCloud } from 'lucide-react'
import GradientButton from '@/components/GradientButton'
import ProfileModal from './ProfileModal'
import OrbAvatar from './OrbAvatar'

/**
 * 更换头像弹窗
 * @param onClose 关闭回调
 */
export default function AvatarModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [preview, setPreview] = useState<string | null>(null)

  function handleFile(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPreview(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
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

      <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-black/[0.15] rounded-[12px] py-6 cursor-pointer hover:bg-bg-muted/50 transition-colors">
        <UploadCloud size={20} className="text-v2-text-muted" />
        <span className="text-[12px] text-v2-text-muted">点击上传图片，支持 JPG / PNG</span>
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </label>

      <GradientButton onClick={onClose} className="w-full mt-5 py-3 rounded-full text-[14px] font-medium">
        保存头像
      </GradientButton>
    </ProfileModal>
  )
}
