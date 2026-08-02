/**
 * @module   LowMatchView
 * @desc     匹配页「B 类·低相关兜底」展示 —— 候选有分但全部 < SCORE_MID（谁都算不上贴合）时，
 *           不再一刀切走 NoMatchView，而是把相关性最高的前几道（lowShown，page.tsx 派生）如实展示：
 *           识别维度行 + 说明卡 + 「最相关」置顶组 + 「其他相关题目」其余组 + 「换个角度重新讲一个故事」出口。
 *           卡片复用 MatchedQuestionCard（isHighMatch=false，自带分析 CTA/选中竖条/存对子/键盘可达），
 *           不新造任何样式/token/尺寸；分组标题一律 mid 灰（切勿绿/high，避免误 signal 高匹配）。
 *           移动端与桌面端共用本组件（桌面端居中单列 max-w-[600px]，不走 master-detail）。
 * @author   LingoBridge
 * @created  2026-08-02
 */
'use client'
import Card from '@/components/Card'
import MatchedQuestionCard from '@/components/matching/MatchedQuestionCard'
import type { MatchedPoint } from '@/lib/types'
import type { FunnelQuestion } from '@/app/matching/types'

interface Props {
  /** 识别出的主观察点（识别维度行）；null 时不渲染该行 */
  primary: MatchedPoint | null
  /** 识别出的副观察点（识别维度行补充）；null 时省略 */
  secondary: MatchedPoint | null
  /** 低相关展示切片（相关性降序，最多 LOW_MATCH_SHOW_MAX 道）；lowShown[0] = 最高分那道，置顶 */
  lowShown: FunnelQuestion[]
  selectedId: string | null
  savedIds: Set<string>
  savingId: string | null
  onToggleSelect: (id: string) => void
  onPractice: (id: string) => void
  onSavePair: (id: string) => void
  /** 「换个角度，重新讲一个故事」出口（回首页） */
  onExit: () => void
}

/** 分组标题行（mid 灰样式，与 Matching{Mobile,Desktop} 的 GroupHeader variant='mid' 同款，不新造样式） */
function GroupHeaderMid({ label, count }: { label: string; count: number }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[11px] text-v2-text-secondary font-medium">{label} · {count} 道</span>
      <div className="flex-1 h-px bg-black/[0.05]" />
    </div>
  )
}

/**
 * B 类低相关兜底展示（移动/桌面共用）
 * @param lowShown  已按分降序的低相关切片（page.tsx 保证非空才渲染本组件；[0] 置顶）
 * @returns         识别维度 + 说明卡 + 分组卡片 + 换故事出口
 */
export default function LowMatchView({
  primary, secondary, lowShown, selectedId, savedIds, savingId,
  onToggleSelect, onPractice, onSavePair, onExit,
}: Props): React.ReactElement {
  // 单题存对子三态：进行中 > 已存 > 未存（与 MatchingMobile 同口径）
  const saveStateOf = (id: string): 'idle' | 'saving' | 'saved' =>
    savingId === id ? 'saving' : savedIds.has(id) ? 'saved' : 'idle'

  const top = lowShown[0]
  const rest = lowShown.slice(1)

  const renderCard = (q: FunnelQuestion): React.ReactElement => (
    <MatchedQuestionCard
      key={q.id}
      question={q}
      selected={selectedId === q.id}
      onToggle={() => onToggleSelect(q.id)}
      onPractice={() => onPractice(q.id)}
      isPrimaryMatch={q.isPrimaryMatch}
      isHighMatch={false}
      saveState={saveStateOf(q.id)}
      onSave={() => onSavePair(q.id)}
    />
  )

  return (
    <div>
      {/* 标题 + 识别维度 */}
      <div className="mb-4">
        <h2 className="text-[20px] font-bold text-v2-text-primary">暂时没有完全贴合的题目</h2>
        {primary && (
          <p className="text-[12px] text-v2-text-muted mt-1">
            识别维度：{primary.dimension} · {primary.pointName}
            {secondary && ` ／ ${secondary.dimension} · ${secondary.pointName}`}
          </p>
        )}
      </div>

      {/* 说明卡：诚实告知这几道都算不上特别贴合，给「先练手」与「换故事」两条路 */}
      <Card className="px-4 py-3 mb-5">
        <p className="text-[13px] text-v2-text-primary leading-snug mb-1">
          题库里和你的故事最相关的，就是下面这几道
        </p>
        <p className="text-[12px] text-v2-text-secondary leading-relaxed">
          它们都算不上特别贴合。可以先挑最相关的一道练手；也可以换个角度、重新讲一个故事，也许能遇到更合适的题。
        </p>
      </Card>

      {/* 最相关（置顶单道） */}
      {top && (
        <div className="mb-5">
          <GroupHeaderMid label="最相关" count={1} />
          <div className="flex flex-col gap-3">{renderCard(top)}</div>
        </div>
      )}

      {/* 其他相关题目（仅多于一道时） */}
      {rest.length > 0 && (
        <div className="mb-5">
          <GroupHeaderMid label="其他相关题目" count={rest.length} />
          <div className="flex flex-col gap-3">{rest.map(renderCard)}</div>
        </div>
      )}

      {/* 换个角度出口：真 button，min-h-44，回首页重讲 */}
      <div className="text-center mb-6">
        <button
          onClick={onExit}
          className="min-h-[44px] inline-flex items-center justify-center px-3 text-[13px] font-medium text-brand-primary-dark active:opacity-60"
        >
          换个角度，重新讲一个故事 →
        </button>
      </div>
    </div>
  )
}
