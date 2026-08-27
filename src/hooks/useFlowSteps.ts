/**
 * @module   useFlowSteps
 * @desc     步骤条的序列来源 —— 按本次链路形态（sessionStorage 里的 flow-shape）派生该走哪几步。
 *           两个消费方：移动端 `StepBar`、桌面端 `FlowShellDesktop`，各自的页面不必知道自己在哪条流上。
 *
 *   【为什么必须在 effect 里读、不能在 useState 初始值里读】sessionStorage 在服务端读不到：
 *   初始值里读会让 SSR 渲染 5 步、客户端首帧渲染 4 步 → hydration mismatch。
 *   故首帧一律用全量 5 步（= 安全降级序列），挂载后再校正。步骤条是纯展示，这一帧的差异无功能影响。
 *
 * @author   LingoBridge
 * @created  2026-08-27
 */
'use client'
import { useEffect, useState } from 'react'
import { STEPS, deriveSteps, readFlowShape, type FlowStep, type StepKey } from '@/lib/flow-shape'

/**
 * 取当前链路该显示的步骤序列。
 * @param  currentStep  当前页所处的步骤
 * @returns             步骤序列；首帧与「读不到形态标识」时为全量 5 步
 * @sideEffect          挂载后读一次 sessionStorage（只读，不写）
 */
export function useFlowSteps(currentStep: StepKey): FlowStep[] {
  const [steps, setSteps] = useState<FlowStep[]>(STEPS)
  useEffect(() => {
    setSteps(deriveSteps(readFlowShape(), currentStep))
  }, [currentStep])
  return steps
}
