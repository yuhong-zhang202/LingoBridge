/**
 * @module   PronunciationTab
 * @desc     素材库「发音」Tab — 收藏的发音正音，喇叭播放 + AI 音标/怎么念（首次打开缓存）。
 *           移动端左滑删除（SwipeToDelete）；桌面端复用 useSelectMode 多选删除（选择态由 SelectableCardWrapper 叠加）。
 * @author   LingoBridge
 * @created  2026-06-11
 */
'use client'
import { type JSX, useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Volume2, Trash2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import SelectableCardWrapper from '@/components/library/SelectableCardWrapper'
import UndoToast from '@/components/UndoToast'
import IconButton from '@/components/IconButton'
import useSelectMode from '@/hooks/useSelectMode'
import { makeSearchFilter, searchEmptyTitle, type SearchCounts } from '@/lib/search'
import { removeSavedPronunciation, updateSavedPronunciation } from '@/lib/db/saved-pronunciations'
import { useSavedPronunciations, refreshSavedPronunciations } from '@/hooks/library-data'
import { apiFetch } from '@/lib/api-client'
import { track } from '@/lib/client-events'
// AI 调用结局的取值域【来自 event-schema 这一份真源】，本文件不手抄：服务端 sanitize 对不认识的值
// 是静默丢弃，打错一个字母就成了「埋了但库里查不到」，本地测不出来。
import type { AiResult } from '@/lib/event-schema'
import { GRADIENT_BORDER_STYLE_FULL_OPAQUE } from '@/lib/constants'
import type { SavedPronunciation, PronunciationTip } from '@/lib/types'

/** 用浏览器 TTS 读一个英文词 */
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  window.speechSynthesis.speak(utt)
}

/** 一行：标签 + 词 + 音标 + 喇叭 */
function WordRow({ label, word, ipa }: { label: string; word: string; ipa?: string }): JSX.Element {
  return (
    <>
      <p className="text-[0.6875rem] text-v2-text-muted mb-[5px]">{label}</p>
      <div className="flex items-center gap-1.5 mb-[11px]">
        <span className="text-[0.9375rem] text-v2-text-primary">
          <span className="font-medium">{word}</span>
          {ipa && <span className="ml-2 text-[0.75rem] text-v2-text-secondary">{ipa}</span>}
        </span>
        <button
          onClick={() => speak(word)}
          aria-label="播放"
          className="flex-shrink-0 active:opacity-50 transition-opacity"
        >
          <Volume2 size={14} className="text-v2-text-muted" />
        </button>
      </div>
    </>
  )
}

/** 单张发音卡：首次展示时若没缓存音标/提示，请求 AI 并写回 storage */
function PronunciationCard({ item }: { item: SavedPronunciation }): JSX.Element {
  const router = useRouter()
  const cached: PronunciationTip | null = item.tip
    ? { ipaIntended: item.ipaIntended ?? '', ipaHeard: item.ipaHeard ?? '', tip: item.tip }
    : null
  const [data, setData] = useState<PronunciationTip | null>(cached)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (data) return
    let cancelled = false
    const ac = new AbortController()
    setLoading(true)
    // ——— 本次发音提示生成的埋点（fire-and-forget，不参与任何分支判断、不改任何时序）———
    // 本卡片的失败【全部静默】（catch 只落个「稍后再试」占位），且 402/429/400 走的是服务端裸 return
    // ——不埋这一条，用户反复打开发音卡却永远拿不到提示这件事，在任何数据里都不存在。
    const t0 = performance.now()
    let aiReported = false
    /** 这一次调用只报一条：!res.ok 抛出的错会被下面的 catch 再兜一次，不挡就记两遍 */
    const reportAi = (result: AiResult, httpStatus: number): void => {
      if (aiReported) return
      aiReported = true
      track('flow.ai_call', { stage: 'pronounce', result, httpStatus, latencyMs: performance.now() - t0 })
    }
    void (async () => {
      try {
        const res = await apiFetch('/api/pronounce', {
          method: 'POST',
          json: { intended: item.intended, heard: item.heard, context: item.context },
          signal: ac.signal,
        })
        // 服务端同意闸拒绝（403，未捕获同意）：回首页触发同意弹窗，不静默停在「稍后再试」。
        if (res.status === 403) { reportAi('consent_403', 403); if (!cancelled) router.push('/'); return }
        // 在 throw 之前报：进了 catch 就只剩「网络失败」一种说法，而这里的 400（intended/heard 为空、
        // 内容过长）/402/429/500 会被记成凭空的网络故障。
        if (!res.ok) {
          reportAi(
            res.status === 400 ? 'bad_input_400'
              : res.status === 402 ? 'quota_402'
                : res.status === 429 ? 'rate_429'
                  : res.status === 401 ? 'auth_401'
                    : res.status >= 500 ? 'server_5xx' : 'other',
            res.status,
          )
          throw new Error('请求失败')
        }
        const tip = (await res.json()) as PronunciationTip
        reportAi('ok', 200)
        if (cancelled) return
        setData(tip)   // 本地即时展示；落库缓存音标失败也不影响本次展示
        void updateSavedPronunciation(item.id, {
          ipaIntended: tip.ipaIntended,
          ipaHeard: tip.ipaHeard,
          tip: tip.tip,
        })
          .then(() => refreshSavedPronunciations())
          .catch((e) => console.error('[PronunciationTab] 缓存音标失败', e))
      } catch {
        /* 失败静默（含中断），下次打开再试 */
        if (ac.signal.aborted) return   // 中断（卸载/切 Tab）不算失败，由 cleanup 统一报 aborted
        reportAi('network', 0)          // 到此只剩真·网络 reject（非 2xx 已分流报过、被自去重挡住）
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    // 没等到提示就离开（切 Tab / 关页面）→ aborted（不计失败）；已报结局的被自去重挡住
    return () => { cancelled = true; reportAi('aborted', 0); ac.abort() }
  }, [data, item, router])

  return (
    <div style={GRADIENT_BORDER_STYLE_FULL_OPAQUE} className="rounded-[16px] px-[14px] py-[13px]">
      <WordRow label="想说的词" word={item.intended} ipa={data?.ipaIntended} />
      <WordRow label="被听成" word={item.heard} ipa={data?.ipaHeard} />

      <div className="rounded-[12px] bg-bg-page px-3 py-2.5 mb-[11px]">
        <p className="text-[0.6875rem] text-v2-text-muted mb-1">怎么念</p>
        {data
          ? <p className="text-[0.75rem] text-v2-text-primary leading-[1.6]">{data.tip}</p>
          : <p className="text-[0.75rem] text-v2-text-muted leading-[1.6]">{loading ? '发音提示生成中…' : '稍后再试'}</p>}
      </div>

      <p className="text-[0.6875rem] text-v2-text-muted leading-[1.5]">出处：{item.context}</p>
    </div>
  )
}

/**
 * toolbarSlotRef：桌面端把「选择」/多选工具栏 Portal 到 tab 栏右侧槽（LibraryDesktop 提供）；移动端不传。
 * onSelectingChange：通知外层（LibraryDesktop）选择模式变化，用于禁用同排的搜索图标。
 * searchQuery：桌面搜索词（防抖后）；移动端不传 → 恒不过滤。
 * onSearchCountsChange：上报实时（匹配数, 总数）供 tab 胶囊显示「匹配/总数」；移动端不传。
 */
interface Props {
  toolbarSlotRef?: React.RefObject<HTMLDivElement | null>
  onSelectingChange?: (selecting: boolean) => void
  searchQuery?: string
  onSearchCountsChange?: (counts: SearchCounts) => void
}

const getPronId = (p: SavedPronunciation): string => p.id
/** 可搜文本：想说的词 + 被听成 + 出处 */
const getPronText = (p: SavedPronunciation): string => [p.intended, p.heard, p.context].join(' ')

export default function PronunciationTab({ toolbarSlotRef, onSelectingChange, searchQuery, onSearchCountsChange }: Props): JSX.Element | null {
  const { pronunciations, isLoading } = useSavedPronunciations()

  const filterFn = useMemo(() => makeSearchFilter(searchQuery ?? '', getPronText), [searchQuery])
  // 删除落库 + 失效缓存；useSelectMode 已做乐观隐藏/撤销，这里 fire-and-forget（失败记日志）
  const removeFn = useCallback((id: string): void => {
    void removeSavedPronunciation(id)
      .then(() => refreshSavedPronunciations())
      .catch((e) => console.error('[PronunciationTab] 删除发音失败', e))
  }, [])
  const sel = useSelectMode({
    initialItems: pronunciations,
    getId: getPronId,
    removeFn,
    onSelectingChange,
    filterFn,
  })
  const searching = (searchQuery ?? '').trim() !== ''

  // 上报实时计数（匹配=可见项，总数=扣除待删）供 tab 胶囊显示「匹配/总数」
  useEffect(() => {
    onSearchCountsChange?.({ matched: sel.visibleItems.length, total: sel.items.length - sel.pendingCount })
  }, [sel.visibleItems.length, sel.items.length, sel.pendingCount, onSearchCountsChange])

  // Portal 落点在 LibraryDesktop 的 DOM 里，首帧 ref.current 尚未挂载；挂载后翻标志重渲染。移动端不传 ref → 恒 null → 无工具栏。
  const [slotReady, setSlotReady] = useState(false)
  useEffect(() => { setSlotReady(true) }, [])
  const toolbarSlot = slotReady ? toolbarSlotRef?.current ?? null : null

  if (isLoading) return null
  if (sel.items.length === 0) {
    return (
      <EmptyState
        title="还没有发音收藏"
        subtitle="练习时点气泡里发音被听错的词，填上正确的词即可收藏到这里"
      />
    )
  }

  return (
    <>
      {/* 桌面端工具栏：Portal 到 tab 栏右侧槽（未选择=「选择」；选择中=取消/已选N/全选/删除） */}
      {toolbarSlot && createPortal(
        !sel.selecting ? (
          <IconButton icon={Trash2} label="选择" onClick={sel.enterSelecting} />
        ) : (
          <div className="flex items-center gap-4">
            <button onClick={sel.exitSelecting} className="text-[0.8125rem] text-v2-text-muted hover:text-v2-text-primary transition-colors">取消</button>
            <span className="text-[0.8125rem] text-v2-text-muted">已选 {sel.selectedCount} 项</span>
            <button onClick={sel.toggleSelectAll} className="text-[0.8125rem] text-v2-text-secondary hover:text-v2-text-primary transition-colors">
              {sel.allSelected ? '取消全选' : '全选'}
            </button>
            <button
              onClick={sel.deleteSelected}
              disabled={sel.selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[0.8125rem] font-medium text-white bg-error active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />删除 ({sel.selectedCount})
            </button>
          </div>
        ),
        toolbarSlot
      )}

      {searching && sel.visibleItems.length === 0 ? (
        <div className="pt-3"><EmptyState title={searchEmptyTitle(searchQuery ?? '')} subtitle="换个关键词试试" /></div>
      ) : (
        <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
          {sel.visibleItems.map(it => (
            <SelectableCardWrapper
              key={it.id}
              selecting={sel.selecting}
              selected={sel.isSelected(it.id)}
              onToggle={() => sel.toggleSelect(it.id)}
              radius={16}
              checkboxSide="right"
            >
              <SwipeToDelete
                borderRadius={16}
                onDelete={() => sel.removeImmediate(it.id)}
              >
                <PronunciationCard item={it} />
              </SwipeToDelete>
            </SelectableCardWrapper>
          ))}
        </div>
      )}

      {/* 撤销 Toast（桌面多选删除专用；key 变化重置 5s 计时） */}
      {sel.pendingCount > 0 && (
        <UndoToast
          key={sel.pendingKey}
          message={`已删除 ${sel.pendingCount} 条发音`}
          onUndo={sel.undoDelete}
          onDismiss={sel.commitPending}
        />
      )}
    </>
  )
}
