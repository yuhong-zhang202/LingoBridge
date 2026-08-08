/**
 * @module   MyCorpusFilterBar
 * @desc     「我的语料」tab 顶部的三档筛选行（全部 / 已结对 / 还没绑题目）。纯展示组件：状态由 tab 持有。
 *           措辞用「还没绑题目」而不是「未结对」—— 后者读起来像失败（系统没给我匹配到），
 *           实际是未进行（你还没去绑），且「结对」不是用户词汇。
 * @author   LingoBridge
 * @created  2026-08-08
 */
'use client'
import type { JSX } from 'react'
import Chip from '@/components/Chip'
import type { CorpusFilter } from './my-corpus-model'

interface Props {
  value: CorpusFilter
  onChange: (next: CorpusFilter) => void
  counts: { all: number; paired: number; unpaired: number }
}

/** 三档的展示顺序与文案（顺序固定：全部在前，其余按「已做到 / 还没做」排）。 */
const OPTIONS: readonly { id: CorpusFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'paired', label: '已结对' },
  { id: 'unpaired', label: '还没绑题目' },
]

/**
 * 三档筛选行
 * @param value    当前档
 * @param onChange 切换档
 * @param counts   三档各自条数（由 tab 按「搜索过滤后」的集合算，与用户看到的条数一致）
 */
export default function MyCorpusFilterBar({ value, onChange, counts }: Props): JSX.Element {
  return (
    <div role="group" aria-label="按结对状态筛选语料" className="flex items-center gap-2 flex-wrap pt-3">
      {OPTIONS.map((opt) => (
        <Chip
          key={opt.id}
          variant="ghost"
          size="md"
          active={value === opt.id}
          ariaPressed={value === opt.id}
          onClick={() => onChange(opt.id)}
          // 移动端 min-h-[44px]：筛选是常按的触控目标，达 WCAG 2.5.5；桌面鼠标精度足够，收窄到 32px 免得一行过厚
          className="min-h-[44px] lg:min-h-[32px]"
        >
          {opt.label}
          <span className={value === opt.id ? 'text-v2-text-secondary' : 'text-v2-text-muted'}>
            {opt.id === 'all' ? counts.all : opt.id === 'paired' ? counts.paired : counts.unpaired}
          </span>
        </Chip>
      ))}
    </div>
  )
}
