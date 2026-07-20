/**
 * @module   BetaPrivacyPage
 * @desc     内测数据处理说明 — 纯展示版（"点击即可查看"，无勾选、不落库）。
 *           文案唯一真源在 src/lib/privacy-copy.ts；本页仅负责渲染。
 *           本页只挂 TopBar（其返回键 lg:hidden），桌面端另补 DesktopBackLink 出口：入口有设置页与
 *           首次同意弹窗两处，无唯一上级 ⇒ 走 router.back()，兜底回首页（说明链接可能被直接粘贴 /
 *           新标签页打开，此时历史栈为空、back() 是空操作）。
 * @author   LingoBridge
 * @created  2026-07-17
 */
import TopBar from '@/components/TopBar'
import DesktopBackLink from '@/components/DesktopBackLink'
import {
  BETA_PRIVACY_TITLE,
  BETA_PRIVACY_SECTIONS,
  BETA_PRIVACY_UPDATED_AT,
} from '@/lib/privacy-copy'

export default function BetaPrivacyPage() {
  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title={BETA_PRIVACY_TITLE} />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-10 relative z-10 lg:max-w-[640px] lg:mx-auto lg:w-full lg:px-10">
        <DesktopBackLink fallback="/" />
        <h1 className="sr-only">{BETA_PRIVACY_TITLE}</h1>
        <p className="text-[12px] text-v2-text-muted mb-4">最后更新：{BETA_PRIVACY_UPDATED_AT}</p>

        {BETA_PRIVACY_SECTIONS.map((section) => (
          <section key={section.heading} className="mb-6">
            <h2 className="text-[16px] font-semibold text-v2-text-primary mb-2 lg:text-[17px]">{section.heading}</h2>
            <ul className="list-disc pl-5 space-y-2">
              {section.paragraphs.map((text, i) => (
                <li key={i} className="text-[15px] text-v2-text-secondary leading-relaxed">
                  {text}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
