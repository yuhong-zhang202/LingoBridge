/**
 * @module   PrivacyPage
 * @desc     隐私政策 — 最小占位条款，上线前需人工审校替换为正式版本
 * @author   LingoBridge
 * @created  2026-06-17
 */
import TopBar from '@/components/TopBar'

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="隐私政策" />

      <div className="flex-1 overflow-y-auto px-5 pt-2 pb-10 relative z-10">
        <p className="text-[12px] text-v2-text-muted mb-4">最后更新：2026-06-17</p>

        <section className="mb-5">
          <h2 className="text-[15px] font-semibold text-v2-text-primary mb-1.5">我们收集什么</h2>
          <p className="text-[13px] text-v2-text-secondary leading-relaxed">
            邮箱（用于登录与保存你的练习进度），以及你录入的故事与练习记录（录音/文字、整理后的故事、匹配题目、AI 反馈等）。
          </p>
        </section>

        <section className="mb-5">
          <h2 className="text-[15px] font-semibold text-v2-text-primary mb-1.5">用途</h2>
          <p className="text-[13px] text-v2-text-secondary leading-relaxed">
            仅用于提供与改进练习功能本身（如匹配题目、生成反馈、回顾词组等）。不向第三方出售你的数据。
          </p>
        </section>

        <section className="mb-5">
          <h2 className="text-[15px] font-semibold text-v2-text-primary mb-1.5">存储</h2>
          <p className="text-[13px] text-v2-text-secondary leading-relaxed">
            数据存储于 Supabase。仅你本人（按账户隔离）可访问自己的故事与练习记录。
          </p>
        </section>

        <section className="mb-5">
          <h2 className="text-[15px] font-semibold text-v2-text-primary mb-1.5">你的权利</h2>
          <p className="text-[13px] text-v2-text-secondary leading-relaxed">
            你可随时在「设置」中删除全部数据（被遗忘权）。删除后无法恢复。
          </p>
        </section>

        <section className="mb-5">
          <h2 className="text-[15px] font-semibold text-v2-text-primary mb-1.5">联系方式</h2>
          <p className="text-[13px] text-v2-text-secondary leading-relaxed">
            如有问题或想行使你的权利，请联系：privacy@lingobridge.example（占位）。
          </p>
        </section>

        <p className="text-[12px] text-v2-text-muted mt-6 leading-relaxed">
          以上为占位文本，上线前由产品/法务团队替换为正式条款。
        </p>
      </div>
    </div>
  )
}
