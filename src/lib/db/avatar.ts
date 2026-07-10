/**
 * @module   db/avatar
 * @desc     头像上传 — 校验后传 Supabase Storage（avatars/{userId}/{ts}.{ext}，公开读），
 *           公开 URL 写入 user_metadata.avatar_url。桶与 RLS 见 migrations/0008_avatars_bucket.sql。
 * @author   LingoBridge
 * @created  2026-07-10
 */
import type { AppError } from '@/types/errors'
import { getSupabase, ensureSession } from '@/lib/supabase'

/** 头像大小上限（字节）；选择与上传两处共用同一阈值 */
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024

function appError(code: string, message: string, cause?: unknown): AppError {
  return { code, message, cause }
}

/**
 * 校验待上传的头像文件（选图时即可提前校验，避免到保存才报错）
 * @param  file 用户选择的文件
 * @throws INVALID_TYPE / TOO_LARGE（message 可直接展示给用户）
 */
export function validateAvatarFile(file: File): void {
  if (!file.type.startsWith('image/')) {
    throw appError('INVALID_TYPE', '请选择图片文件（JPG / PNG 等）')
  }
  if (file.size > MAX_AVATAR_SIZE) {
    throw appError('TOO_LARGE', '图片不能超过 2MB，换一张小一点的吧')
  }
}

/**
 * 上传头像并写入账号 metadata
 * @param  file 已选择的图片文件
 * @returns     新头像的公开 URL
 * @throws      INVALID_TYPE / TOO_LARGE / UPLOAD_FAILED / SAVE_FAILED
 * @sideEffect  写 Storage avatars 桶 + auth.updateUser（触发 USER_UPDATED，各 useAccount 实例自动刷新）
 */
export async function uploadAvatar(file: File): Promise<string> {
  validateAvatarFile(file)
  const userId = await ensureSession()
  const supabase = getSupabase()

  // 扩展名取文件名后缀，取不到回退 MIME 子类型（时间戳文件名天然避免覆盖冲突）
  const ext = (file.name.includes('.') ? file.name.split('.').pop()! : file.type.split('/')[1] ?? 'jpg')
    .toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { contentType: file.type })
  if (uploadError) {
    throw appError('UPLOAD_FAILED', '上传失败，请检查网络后再试', uploadError)
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  const avatarUrl = data.publicUrl

  const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } })
  if (updateError) {
    throw appError('SAVE_FAILED', '保存头像失败，请稍后再试', updateError)
  }
  return avatarUrl
}
