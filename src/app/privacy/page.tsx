/**
 * @module   PrivacyPage
 * @desc     隐私政策 — 最小占位条款，上线前需人工审校替换为正式版本。
 *           本页只挂 TopBar（其返回键 lg:hidden），桌面端另补 DesktopBackLink 出口：入口有设置页、
 *           登录页、首次同意弹窗三处，无唯一上级 ⇒ 走 router.back()，兜底回首页（条款链接可能被直接
 *           粘贴打开 / 新标签页打开，此时历史栈为空、back() 是空操作）。
 * @author   LingoBridge
 * @created  2026-06-17
 */
import TopBar from '@/components/TopBar'
import DesktopBackLink from '@/components/DesktopBackLink'
import { PRIVACY_VENDOR, PRIVACY_HUMAN_READ_DISCLOSURE } from '@/lib/privacy-copy'

export default function PrivacyPage() {
  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title="隐私政策" />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-10 relative z-10 lg:max-w-[640px] lg:mx-auto lg:w-full lg:px-10">
        <DesktopBackLink fallback="/" />
        <h1 className="sr-only">隐私政策</h1>
        <p className="text-[0.75rem] text-v2-text-muted mb-4">最后更新：2026-06-17</p>

        <section className="mb-6">
          <h2 className="text-[1rem] font-semibold text-v2-text-primary mb-2 lg:text-[1.0625rem]">我们收集什么</h2>
          <p className="text-[0.9375rem] text-v2-text-secondary leading-relaxed">
            邮箱（用于登录与保存你的练习进度），以及你录入的故事与练习记录（录音/文字、整理后的故事、匹配题目、AI 反馈等）。
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-[1rem] font-semibold text-v2-text-primary mb-2 lg:text-[1.0625rem]">用途</h2>
          <p className="text-[0.9375rem] text-v2-text-secondary leading-relaxed">
            仅用于提供与改进练习功能本身（如匹配题目、生成反馈、回顾词组等）。不向第三方出售你的数据。
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-[1rem] font-semibold text-v2-text-primary mb-2 lg:text-[1.0625rem]">第三方 AI 处理</h2>
          <p className="text-[0.9375rem] text-v2-text-secondary leading-relaxed">
            为了把你的录音转成文字、并生成匹配题目与练习反馈，你的录音与文字会发送给我们使用的第三方 AI 服务进行处理：语音转写由{PRIVACY_VENDOR.voice}完成，内容分析与反馈由{PRIVACY_VENDOR.text}完成。我们仅为提供上述功能而发送这些数据，不向任何第三方出售。
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-[1rem] font-semibold text-v2-text-primary mb-2 lg:text-[1.0625rem]">存储</h2>
          <p className="text-[0.9375rem] text-v2-text-secondary leading-relaxed">
            数据存储于 Supabase，按账户隔离，其他用户无法看到你的故事与练习记录。{PRIVACY_HUMAN_READ_DISCLOSURE}我们不会向任何第三方出售你的数据。
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-[1rem] font-semibold text-v2-text-primary mb-2 lg:text-[1.0625rem]">你的权利</h2>
          <p className="text-[0.9375rem] text-v2-text-secondary leading-relaxed">
            你可随时在「设置」中删除全部数据（被遗忘权）。删除后无法恢复。
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-[1rem] font-semibold text-v2-text-primary mb-2 lg:text-[1.0625rem]">联系方式</h2>
          <p className="text-[0.9375rem] text-v2-text-secondary leading-relaxed">
            如有隐私相关问题，或想行使删除等权利，可通过应用内右上角的「反馈」入口联系我们，我们会尽快回复。
          </p>
        </section>
      </div>
    </div>
  )
}
