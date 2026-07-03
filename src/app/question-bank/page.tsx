/**
 * @module   QuestionBankPage
 * @desc     当季题库入口 — 数据统一由 useQuestionBank 加载，按断点分发两套 UI：
 *           移动端(lg 以下)走改版前独立设计，桌面端(lg 及以上)走密面板版
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useQuestionBank } from './useQuestionBank'
import QuestionBankMobile from './QuestionBankMobile'
import QuestionBankDesktop from './QuestionBankDesktop'

export default function QuestionBankPage() {
  const qb = useQuestionBank()   // 一次加载，两套 UI 共用同一份数据
  return (
    <>
      <div className="lg:hidden"><QuestionBankMobile qb={qb} /></div>
      <div className="hidden lg:block"><QuestionBankDesktop qb={qb} /></div>
    </>
  )
}
