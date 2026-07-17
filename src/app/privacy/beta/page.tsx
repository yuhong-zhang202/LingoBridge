/**
 * @module   BetaPrivacyPage
 * @desc     内测数据处理说明 — 纯展示版（"点击即可查看"，无勾选、不落库）。
 *           文案唯一真源在 src/lib/privacy-copy.ts；本页仅负责渲染。
 * @author   LingoBridge
 * @created  2026-07-17
 */
import TopBar from '@/components/TopBar'
import {
  BETA_PRIVACY_TITLE,
  BETA_PRIVACY_SECTIONS,
  BETA_PRIVACY_UPDATED_AT,
} from '@/lib/privacy-copy'

export default function BetaPrivacyPage() {
  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title={BETA_PRIVACY_TITLE} />

      <div className="flex-1 overflow-y-auto px-5 pt-2 pb-10 relative z-10">
        <p className="text-[12px] text-v2-text-muted mb-4">最后更新：{BETA_PRIVACY_UPDATED_AT}</p>

        {BETA_PRIVACY_SECTIONS.map((section) => (
          <section key={section.heading} className="mb-5">
            <h2 className="text-[15px] font-semibold text-v2-text-primary mb-1.5">{section.heading}</h2>
            {section.paragraphs.map((text, i) => (
              <p key={i} className="text-[13px] text-v2-text-secondary leading-relaxed mb-1.5">
                {text}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
