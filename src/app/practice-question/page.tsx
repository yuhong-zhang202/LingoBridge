/**
 * @module   PracticeQuestionPage
 * @desc     练习题目页 — 展示一道雅思题 + 能匹配它的语料列表 + 添加语料；
 *           选中语料后出现「练习」按钮直达分析，「添加语料」复用雅思直达流（?qid=）。
 *           「添加语料」是建新语料入口，故挂 useStoryQuotaGuard：额度已满时当场弹覆盖层、不进录音页，
 *           与首页 /write /recording 同一份判断（避免用户录完整理完才被告知试用结束）。
 *           本页只挂 TopBar（其返回键 lg:hidden），桌面端另补 DesktopBackLink 出口：走 router.back()，
 *           与移动端 TopBar 默认返回行为完全一致（不改变本页原有退出语义——本页无未保存状态，
 *           返回即离开，无需确认）；兜底 /question-bank，因为唯一入口就是题库列表的题目卡。
 * @author   LingoBridge
 * @created  2026-06-21
 */
'use client'
import { type JSX, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Plus, RefreshCw, Loader2 } from 'lucide-react'
import TopBar from '@/components/TopBar'
import DesktopBackLink from '@/components/DesktopBackLink'
import Card from '@/components/Card'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'
import MicPermissionSheet from '@/components/MicPermissionSheet'
import GradientButton from '@/components/GradientButton'
import QuotaReached from '@/components/QuotaReached'
import { useStoryQuotaGuard } from '@/hooks/useStoryQuotaGuard'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import { getQuestionById } from '@/lib/db/questions'
import { listCorpusByQuestion, type CorpusMatch, type MatchLevel } from '@/lib/db/matches'
import { formatRelativeTime } from '@/lib/utils'
import { putHandoff } from '@/lib/handoff'
import type { QuestionWithLinks } from '@/lib/types'
import { BRAND_GRADIENT_VERTICAL } from '@/lib/constants'

// 选中态竖条渐变 —— 全站复用的品牌竖向渐变
const SELECTED_BAR = BRAND_GRADIENT_VERTICAL

/** 匹配档位 → 标签：high 绿标「高匹配」；mid/chosen 灰标「中匹配」；low 灰标「低匹配」 */
function levelTag(level: MatchLevel): JSX.Element {
  if (level === 'high') return <Tag variant="green" label="高匹配" />
  return <Tag variant="gray" label={level === 'low' ? '低匹配' : '中匹配'} />
}

/** 语料卡 —— 选中切换、渐变竖条、珊瑚阴影照搬 MatchedQuestionCard */
function CorpusMatchCard({ item, selected, onToggle, onPractice }: {
  item: CorpusMatch; selected: boolean; onToggle: () => void; onPractice: () => void
}): JSX.Element {
  return (
    <div
      onClick={onToggle}
      className={`bg-white rounded-[14px] overflow-hidden flex cursor-pointer border border-black/[0.05] transition-shadow duration-200 ${
        selected ? 'shadow-[0_2px_16px_rgba(212,135,90,0.12)]' : 'shadow-[0_1px_8px_rgba(0,0,0,0.06)]'
      }`}
    >
      {/* 左侧竖条 */}
      <div className="w-[4px] flex-shrink-0 self-stretch">
        {selected ? (
          <div className="w-full h-full" style={{ background: SELECTED_BAR }} />
        ) : (
          <div className="w-full h-full bg-transparent" />
        )}
      </div>

      <div className="flex-1 p-4">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          {levelTag(item.matchLevel)}
          <span className="text-[11px] text-v2-text-muted flex-shrink-0">
            {item.source === 'voice' ? '录音' : '文字'} · {formatRelativeTime(item.createdAt)}
          </span>
        </div>

        <p className="text-[14px] text-v2-text-secondary leading-relaxed line-clamp-2">{item.cleanedText ?? ''}</p>

        {selected && (
          <div className="flex items-center justify-end mt-3">
            <Chip
              variant="gradient"
              onClick={(e) => { e.stopPropagation(); onPractice() }}
              className="px-3 py-1.5 flex-shrink-0"
            >
              练习
              <ArrowRight size={12} />
            </Chip>
          </div>
        )}
      </div>
    </div>
  )
}

/** 添加语料：虚线珊瑚边卡（与「练习」按钮的白底渐变描边刻意区分）。
 *  loading（查额度 + 探麦克风期间）时：禁用 + aria-busy + 图标换 spinner + 文案改「正在打开录音…」，
 *  给国内高延迟下的这段静默等待一个明确反馈（否则用户以为按钮坏了）。 */
function AddCorpusCard({ onClick, prominent, loading }: { onClick: () => void; prominent?: boolean; loading?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      className={`w-full rounded-[14px] border-2 border-dashed border-brand-primary/40 bg-brand-primary/[0.03] flex flex-col items-center justify-center text-center active:scale-[0.99] transition-transform disabled:opacity-50 disabled:cursor-not-allowed ${
        prominent ? 'py-8' : 'py-5'
      }`}
    >
      <div className="flex items-center gap-1.5 text-brand-primary-dark">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        <span className="text-[14px] font-semibold">添加语料</span>
      </div>
      <span className="text-[12px] text-v2-text-muted mt-1">{loading ? '正在打开录音，请稍候…' : '录一段新故事来练习这道题'}</span>
    </button>
  )
}

function PracticeQuestionContent(): JSX.Element {
  // 语料练习 / 添加语料 / 文字提交都跳「会加载 / AI 页」，一律走 navigate 亮顶部进度条，消除跳转白屏
  const { navigate } = useNav()
  const qId = useSearchParams().get('questionId') ?? ''

  const [question, setQuestion]   = useState<QuestionWithLinks | null>(null)
  const [items, setItems]         = useState<CorpusMatch[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [micSheet, setMicSheet] = useState<null | 'denied' | 'unavailable'>(null)
  const [textOpen, setTextOpen] = useState(false)
  const [textVal, setTextVal]   = useState('')
  // 文字面板「开始分析」点击后到 /restructure 跳转完成前的按钮 loading（putHandoff 同步，靠 navigate 亮进度条兜住主反馈）
  const [analyzing, setAnalyzing] = useState(false)
  // 建新故事额度守卫（与首页 / write / recording 同一份 hook）：本页「添加语料」也是建新语料入口，
  // 且它是录音与文字回退两条路的唯一入口（文字面板只从麦克风失败的 sheet 打开），故在此一处拦即可覆盖两条。
  const storyQuota = useStoryQuotaGuard()

  // 点「添加语料」先核额度、再探测麦克风：有权限照常进录音页，没权限弹 sheet（逻辑照搬首页 handleStartRecording）
  async function handleAddCorpus() {
    if (await storyQuota.checkBlocked()) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())   // 拿到权限即释放，录音页会重新获取
      navigate(`/recording?qid=${qId}`)
    } catch (err) {
      const name = (err as DOMException)?.name
      setMicSheet(name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }
  // 额度核对 + 麦克风探测期间按钮转圈（照搬首页 startingRec 范式）：pending 传给 AddCorpusCard 做 loading+disabled+aria-busy
  const [addCorpus, addingCorpus] = useAsyncAction(handleAddCorpus)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [q, list] = await Promise.all([getQuestionById(qId), listCorpusByQuestion(qId)])
        if (cancelled) return
        if (!q) { setError('题目不存在'); return }
        setQuestion(q)
        setItems(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [qId, reloadKey])

  const enText = question
    ? (question.part === 2 ? (question.cue_card_title ?? question.question_text) : question.question_text)
    : ''
  const zhText = question
    ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : (question.question_text_zh ?? ''))
    : ''

  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title="练习题目" />

      {/* 加载态用 Fragment 无容器可挂，故 aria-busy 挂在常驻滚动区、随 loading 切换 */}
      <div aria-busy={loading} className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-[72px] relative z-10 flex flex-col gap-4 lg:max-w-[640px] lg:mx-auto lg:w-full lg:px-10">
        {/* 放在所有状态分支之前：加载 / 报错 / 正常态都要有出口，尤其报错态不能让桌面用户困死 */}
        <DesktopBackLink fallback="/question-bank" />
        {loading && (
          <>
            {/* 题目卡骨架 */}
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Skeleton className="w-12 h-[18px] rounded-full" />
                <Skeleton className="w-20 h-3" />
              </div>
              <Skeleton className="w-3/4 h-[15px] mt-3" />
              <Skeleton className="w-1/2 h-3 mt-2.5" />
            </Card>

            {/* 区标题骨架 */}
            <div className="flex items-center justify-between mt-1">
              <Skeleton className="w-24 h-3.5" />
              <Skeleton className="w-8 h-3" />
            </div>

            {/* 语料卡骨架 ×3 */}
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white rounded-[14px] border border-black/[0.05] shadow-[0_1px_8px_rgba(0,0,0,0.06)] p-4">
                  <div className="flex items-center justify-between">
                    <Skeleton className="w-[52px] h-[18px] rounded-full" />
                    <Skeleton className="w-[70px] h-2.5" />
                  </div>
                  <Skeleton className="w-[94%] h-3 mt-3" />
                  <Skeleton className="w-[65%] h-3 mt-2" />
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && error && (
          typeof navigator !== 'undefined' && !navigator.onLine ? (
            <OfflineState onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <div className="flex flex-col items-center pt-16 gap-3">
              <p className="text-[13px] text-error text-center">{error}</p>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="flex items-center gap-1.5 text-[13px] text-v2-text-muted active:opacity-70"
              >
                <RefreshCw size={13} />重试
              </button>
            </div>
          )
        )}

        {!loading && !error && question && (
          <>
            {/* 题目卡 */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2.5">
                <PartTag label={`Part ${question.part}`} />
                <Tag variant="green" label={question.topic} />
              </div>
              {zhText ? (
                <>
                  <p className="text-[16px] font-bold text-v2-text-primary leading-snug">{zhText}</p>
                  <p className="text-[13px] text-v2-text-muted mt-1">{enText}</p>
                </>
              ) : (
                <p className="text-[16px] font-bold text-v2-text-primary leading-snug">{enText}</p>
              )}
            </Card>

            {/* 可匹配的语料 */}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[12px] font-medium text-v2-text-secondary">可匹配的语料 · {items.length} 条</span>
            </div>

            {items.length === 0 ? (
              <>
                <p className="text-[13px] text-v2-text-muted text-center py-2">还没有能匹配这道题的语料</p>
                <AddCorpusCard prominent loading={addingCorpus} onClick={() => void addCorpus()} />
              </>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <CorpusMatchCard
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onToggle={() => setSelectedId((id) => (id === item.id ? null : item.id))}
                    onPractice={() => navigate(`/analysis?questionId=${qId}&storyId=${item.id}&from=practice-question`)}
                  />
                ))}
                <AddCorpusCard loading={addingCorpus} onClick={() => void addCorpus()} />
              </div>
            )}
          </>
        )}
      </div>

      {/* 建新故事额度已满：只在点「添加语料」时弹，关闭即回本页正常态（仍可练已有语料）。
          匿名试用用尽 → trial（引导注册）；注册用户月额度用尽 → story。 */}
      {storyQuota.blockedVariant && (
        <QuotaReached variant={storyQuota.blockedVariant} asOverlay onClose={storyQuota.dismiss} />
      )}

      {/* 麦克风权限弹层：没权限时引导去设置或改用文字 */}
      <MicPermissionSheet
        open={micSheet !== null}
        reason={micSheet ?? 'denied'}
        onUseText={() => { setMicSheet(null); setTextOpen(true) }}
        onDismiss={() => setMicSheet(null)}
      />

      {/* 极简文字输入回退：提交后复用 putHandoff → /restructure?h=…&qid= 链路（带本题 qid） */}
      {textOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div
            className="w-full max-w-[430px] bg-bg-surface rounded-t-[20px] px-5 pt-5 sheet-enter"
            style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom))' }}
          >
            <h3 className="text-[17px] font-semibold text-v2-text-primary">用文字写下你的故事</h3>
            <p className="text-[13px] text-v2-text-secondary mt-1">用中文聊聊一件具体的小事，越具体匹配越准。</p>
            <textarea
              value={textVal}
              onChange={(e) => setTextVal(e.target.value)}
              placeholder={'和谁一起、做了什么、当时心里什么感觉，都可以写进来……'}
              className="w-full min-h-[180px] resize-none mt-3 bg-bg-page border border-black/[0.06] rounded-[14px] p-3.5 outline-none text-[16px] leading-[1.8] text-v2-text-primary placeholder:text-v2-text-muted"
              autoFocus
            />
            <div className="mt-4">
              <GradientButton
                disabled={textVal.trim().length < 10}
                loading={analyzing}
                onClick={() => {
                  const key = putHandoff(textVal)
                  if (!key) return
                  setAnalyzing(true)
                  navigate(`/restructure?h=${key}&qid=${qId}`)
                }}
                className="w-full py-3 rounded-full text-[14px] font-medium"
              >
                开始分析 →
              </GradientButton>
            </div>
            <button
              onClick={() => setTextOpen(false)}
              className="w-full text-center text-[14px] text-v2-text-muted mt-3 active:opacity-60"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PracticeQuestionPage(): JSX.Element {
  return <Suspense><PracticeQuestionContent /></Suspense>
}
