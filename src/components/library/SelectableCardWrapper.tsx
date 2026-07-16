/**
 * @module   SelectableCardWrapper
 * @desc     通用「选择态外壳」—— 不改内层卡片组件，为其叠加多选态：右上角 checkbox + 选中主题色描边覆盖 +
 *           透明层拦截整卡点击。checkbox 视觉复刻 CollectedCard；仅 selecting=true 时生效，退出后完全透明。
 *           （checkbox 的落位空间由内层卡片自身顶部内边距提供，本外壳不再撑高。）
 * @author   LingoBridge
 * @created  2026-07-07
 */
'use client'
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'

interface SelectableCardWrapperProps {
  selecting: boolean
  selected: boolean
  onToggle: () => void
  /** 描边覆盖层圆角，需匹配内层卡片；默认 16，phrases 传 14 */
  radius?: number
  /** checkbox 靠左/靠右，躲开卡片自带角标；默认 right */
  checkboxSide?: 'left' | 'right'
  children: ReactNode
}

/**
 * 选择态外壳
 * @param selecting     是否处于选择模式（false 时完全透明、卡片原样）
 * @param selected      当前卡是否选中
 * @param onToggle      点击整卡时切换选中
 * @param radius        描边覆盖层圆角（匹配内层卡片）
 * @param checkboxSide  checkbox 靠边方向
 */
export default function SelectableCardWrapper({
  selecting,
  selected,
  onToggle,
  radius = 16,
  checkboxSide = 'right',
  children,
}: SelectableCardWrapperProps) {
  return (
    <div className="relative">
      {children}

      {selecting && (
        <>
          {/* 透明拦截层：盖住整卡，点击→切换选中；底层按钮/Link 因被覆盖而失效 */}
          <button
            type="button"
            onClick={onToggle}
            aria-label={selected ? '取消选择' : '选择'}
            className="absolute inset-0 z-10"
          />

          {/* 选中态描边覆盖层：贴满整卡，盖住内层自带描边 */}
          {selected && (
            <div
              className="absolute inset-0 border-2 border-brand-primary pointer-events-none z-20"
              style={{ borderRadius: radius }}
            />
          )}

          {/* checkbox：卡片内部右上角（落位空间由内层卡片顶部内边距提供），纯视觉（pointer-events-none 让点击落到拦截层）。视觉复刻 CollectedCard */}
          <div
            className={
              `absolute top-2 z-30 pointer-events-none w-5 h-5 rounded-full flex items-center justify-center ` +
              (checkboxSide === 'left' ? 'left-2 ' : 'right-2 ') +
              (selected ? 'bg-brand-primary' : 'bg-white border-2 border-black/[0.2]')
            }
          >
            {selected && <Check size={14} strokeWidth={3} className="text-white" />}
          </div>
        </>
      )}
    </div>
  )
}
