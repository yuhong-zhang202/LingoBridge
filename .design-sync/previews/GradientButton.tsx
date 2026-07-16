import { GradientButton } from 'lingobridge'

export const Primary = () => (
  <GradientButton className="px-6 py-3 rounded-full text-[14px] font-medium">免费开始练习</GradientButton>
)

export const Disabled = () => (
  <GradientButton disabled className="px-6 py-3 rounded-full text-[14px] font-medium">开始分析 →</GradientButton>
)

export const FullWidth = () => (
  <div style={{ width: 280 }}>
    <GradientButton className="w-full py-3 rounded-full text-[14px] font-medium">用文字输入</GradientButton>
  </div>
)
