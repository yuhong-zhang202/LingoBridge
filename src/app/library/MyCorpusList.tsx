/**
 * @module   MyCorpusList
 * @desc     「我的语料」列表容器（纯展示）—— 一条语料一个 <li>，桌面两列等高，移动端卡角 44×44 删除入口。
 *           用 <ul>/<li> 而不是 div 堆叠：读屏才会报「共 N 项、第 3 项」（本项目既有约定，
 *           见 components/anki/QuestionFlashCard.tsx 顶注）。
 * @author   LingoBridge
 * @created  2026-08-08
 */
'use client'
import type { JSX } from 'react'
import { Trash2 } from 'lucide-react'
import SelectableCardWrapper from '@/components/library/SelectableCardWrapper'
import MyCorpusCard from './MyCorpusCard'
import type { MyCorpusItem } from './my-corpus-model'

interface Props {
  items: MyCorpusItem[]
  /** 桌面多选态（移动端恒 false）。 */
  selecting: boolean
  isSelected: (id: string) => boolean
  onToggleSelect: (id: string) => void
  /** 移动端卡角删除按钮：把该条置为待确认（桌面隐藏，走顶部多选工具栏）。 */
  onRequestDelete: (item: MyCorpusItem) => void
  onOpenQuestion: (corpusId: string, questionId: string) => void
  onFindQuestions: (corpusId: string) => void
}

/** 删除按钮 aria-label 用的短标签：概括优先，否则截正文前 14 字。 */
function shortLabel(item: MyCorpusItem): string {
  if (item.summary && item.summary.trim() !== '') return item.summary
  const t = item.text.trim()
  return t.length > 14 ? `${t.slice(0, 14)}…` : t
}

/**
 * 「我的语料」列表
 * @param items           已按搜索 + 筛选过滤后的可见项
 * @param selecting       是否处于桌面多选态
 * @param isSelected      某项是否选中
 * @param onToggleSelect  切换选中
 * @param onRequestDelete 移动端卡角删除
 * @param onOpenQuestion  点卡内题目 Chip
 * @param onFindQuestions 点「去匹配题目」
 */
export default function MyCorpusList({
  items,
  selecting,
  isSelected,
  onToggleSelect,
  onRequestDelete,
  onOpenQuestion,
  onFindQuestions,
}: Props): JSX.Element {
  return (
    <ul className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-stretch">
      {items.map((item) => (
        <li key={item.id} className="lg:h-full">
          {/* 选择态外壳（桌面多选）：selecting=false 时完全透明、卡片原样；移动端恒不 selecting → 透明穿透 */}
          <SelectableCardWrapper
            selecting={selecting}
            selected={isSelected(item.id)}
            onToggle={() => onToggleSelect(item.id)}
            radius={16}
          >
            {/* relative 容器：卡片本身不再整卡可点（卡内有多枚 Chip / CTA，整卡按钮会造成交互嵌套），
                移动端删除按钮与卡内动作并列 */}
            <div className="relative lg:h-full">
              <MyCorpusCard item={item} onOpenQuestion={onOpenQuestion} onFindQuestions={onFindQuestions} />

              {/* 移动端卡右上角删除入口（桌面 lg:hidden，改走顶部多选工具栏）：44×44 命中区 */}
              <button
                type="button"
                onClick={() => onRequestDelete(item)}
                aria-label={`删除语料：${shortLabel(item)}`}
                className="lg:hidden absolute top-1.5 right-1.5 w-11 h-11 flex items-center justify-center rounded-full text-v2-text-muted hover:text-error hover:bg-error/5 active:scale-[0.94] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </SelectableCardWrapper>
        </li>
      ))}
    </ul>
  )
}
