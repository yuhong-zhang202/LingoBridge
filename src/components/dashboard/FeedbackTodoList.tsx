'use client'
/**
 * @module   dashboard/FeedbackTodoList
 * @desc     看板「有新反馈吗」折叠区 —— 用户反馈待办清单。未处理每条一张 Card（checkbox+label 命中区
 *           ≥44px、message 全文露出、kind chip / route / 东八区时间 / user_id 前 8 位、email 仅有才显、
 *           crash 的 errorMessage 可展开）；勾选 = 乐观移入「已处理」折叠组 + POST /api/feedback-handled，
 *           失败回滚 + Toast；已处理项显「已处理 M/D」并可点撤销。handledSupported=false（迁移 0055 未跑）
 *           退化为只读列表；loadFailed 显加载失败而非误导性空态。
 *
 *   【折叠开合的实现选择】外层 <details> 用「非受控 + 只算一次的初始 open」：open 属性取首帧数据算出的
 *   defaultOpen 并终身不变（useState 惰性初始化）。这样 React 在区间切换重渲染 / 数据刷新时 diff 到的
 *   open 值恒相同、不会去改 DOM，用户手动开合的状态天然保留——方案自评担心的「defaultOpen 与手动开合
 *   打架」在此消解，无需上受控 state。代价是「刷新后才来的新反馈不会自动弹开区块」，summary 上的
 *   未处理计数仍然实时，可接受。
 * @author   LingoBridge
 * @created  2026-08-03
 */
import { useEffect, useState } from 'react'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Toast from '@/components/Toast'
import { apiFetch } from '@/lib/api-client'

/** 单条反馈（与 /api/dashboard 返回体的 feedback.unhandled/handled 条目一致；user_id 已被服务端截前 8 位） */
export type FeedbackTodoItem = {
  id: string
  kind: 'crash' | 'manual'
  message: string
  category: string | null
  route: string | null
  email: string | null
  errorMessage: string | null
  created_at: string
  handled_at: string | null
  userIdShort: string
}

/** /api/dashboard 返回体的 feedback 字段（服务端三态自降级，恒有值） */
export type FeedbackTodoPayload = {
  handledSupported: boolean
  unhandled: FeedbackTodoItem[]
  handled: FeedbackTodoItem[]
  unhandledCount: number
  handledCount: number
  loadFailed: boolean
}

// category 键 → 中文（与 FeedbackPopup 的选项一一对应；未知键原样显示，不吞）
const CATEGORY_LABEL: Record<string, string> = {
  suggestion:          '功能建议',
  bug:                 '遇到问题',
  other:               '其他',
  contact_dev:         '联系开发者',
  password_reset:      '重置密码求助',
  analysis_inaccurate: '分析不准确',
  match_inaccurate:    '匹配不准确',
}

// 部署在香港、DB 存 UTC：展示时间一律按东八区折算（与看板其余口径一致，见 dashboard route HK_OFFSET_MS）
const HK_OFFSET_MS = 8 * 60 * 60 * 1000

/** ISO 时刻 → 东八区「M/D HH:mm」 */
function hkDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + HK_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`
}

/** ISO 时刻 → 东八区「M/D」（「已处理 M/D」用） */
function hkDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + HK_OFFSET_MS)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** kind 徽标：crash 红底「崩溃」（沿用看板既有 badge 写法，如「匿名」badge）；manual 灰 Tag 显 category */
function KindBadge({ item }: { item: FeedbackTodoItem }) {
  if (item.kind === 'crash') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-error/15 text-error">
        崩溃
      </span>
    )
  }
  const label = item.category ? (CATEGORY_LABEL[item.category] ?? item.category) : '反馈'
  return <Tag variant="gray" label={label} className="!text-[0.625rem] !px-2 !py-0.5" />
}

/** 元信息行：kind 徽标 + route + 东八区时间 + user_id 前 8 位（monospace） */
function MetaRow({ item }: { item: FeedbackTodoItem }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5">
      <KindBadge item={item} />
      {item.route && <span className="text-[0.6875rem] text-v2-text-muted">{item.route}</span>}
      <span className="text-[0.6875rem] text-v2-text-muted tabular-nums">{hkDateTime(item.created_at)}</span>
      <span className="text-[0.6875rem] text-v2-text-muted" style={{ fontFamily: 'monospace' }}>{item.userIdShort}</span>
    </div>
  )
}

/**
 * 一张反馈卡：label 包住 checkbox + message 全文（整块可点、命中区 ≥44px）。
 * 已处理态 = 勾选态 + 「已处理 M/D」文字双承载（不靠色）；readOnly 时不渲染 checkbox（迁移未跑退化只读）。
 * @param item      反馈条目
 * @param checked   是否已处理（决定勾选态与「已处理 M/D」行）
 * @param readOnly  只读（handledSupported=false）
 * @param onToggle  勾选/撤销回调（readOnly 时不传）
 */
function FeedbackCard({ item, checked, readOnly, onToggle }: {
  item: FeedbackTodoItem
  checked: boolean
  readOnly: boolean
  onToggle?: (item: FeedbackTodoItem, toHandled: boolean, reply?: string) => void
}) {
  const checkboxId = `fb-todo-${item.id}`
  const replyId = `fb-reply-${item.id}`
  // 勾「已处理」时顺手写的一句回复：勾选那一刻随请求发出，成为闭环弹窗里给用户看的正文。
  // 只在「未处理 + 可写 + 主动反馈」时出现：crash 是用户在报错页写的，不一定期待回音（产品方拍板只对主动反馈发通知）。
  const [reply, setReply] = useState('')
  const canReply = !readOnly && !checked && item.kind !== 'crash'
  return (
    <Card className="px-4 py-3">
      <label htmlFor={checkboxId} className={`flex items-start gap-3 min-h-[44px] ${readOnly ? '' : 'cursor-pointer'}`}>
        {!readOnly && (
          <input
            id={checkboxId}
            type="checkbox"
            checked={checked}
            onChange={() => onToggle?.(item, !checked, reply)}
            className="w-[18px] h-[18px] mt-[2px] flex-shrink-0 accent-brand-accent"
          />
        )}
        {/* message 全文露出：反馈往往就一两句，截断会把关键信息截没 */}
        <span className="flex-1 text-[0.8125rem] text-v2-text-primary leading-relaxed whitespace-pre-wrap break-words">
          {item.message}
        </span>
      </label>
      <div className={readOnly ? '' : 'pl-[30px]'}>
        {/* 已处理状态双承载：勾形（上方 checkbox）+ 文字，不靠颜色 */}
        {checked && item.handled_at && (
          <div className="text-[0.6875rem] text-v2-text-muted mt-1">已处理 {hkDate(item.handled_at)} · 点勾可撤销</div>
        )}
        <MetaRow item={item} />
        {/* email 是用户主动留的联系方式（PII）：只在管理员看板露出，有才显 */}
        {item.email && (
          <div className="text-[0.6875rem] text-v2-text-secondary mt-1 break-all">邮箱 {item.email}</div>
        )}
        {/* crash 的技术副字：默认收起，点开看堆栈级信息 */}
        {item.errorMessage && (
          <details className="mt-1">
            <summary className="text-[0.625rem] text-v2-text-muted cursor-pointer select-none">技术信息</summary>
            <div className="text-[0.625rem] text-v2-text-muted break-all mt-0.5" style={{ fontFamily: 'monospace' }}>
              {item.errorMessage}
            </div>
          </details>
        )}
        {/* 回复输入：选填。写了它，勾选时这句会连同「已处理」一起存下，该用户下次进首页就会看到
            一个带着他自己原话的弹窗。不写也能勾（只是不通知他）。 */}
        {canReply && (
          <div className="mt-2">
            <label htmlFor={replyId} className="text-[0.625rem] text-v2-text-muted">
              回复（选填，勾选后会弹窗告诉这位用户）
            </label>
            <textarea
              id={replyId}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="例如：你说的转写慢，我们把上传体积降到了三分之一，现在应该快很多了"
              className="mt-1 w-full text-[0.75rem] leading-relaxed text-v2-text-primary bg-white border border-black/[0.08] rounded-[12px] px-2.5 py-2 resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
            />
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * 「有新反馈吗」折叠区主组件。
 * @param feedback  /api/dashboard 返回体的 feedback 字段（区间切换会重取，本组件用 useEffect 同步进本地
 *                  乐观状态；in-flight 的乐观操作会被服务端真值覆盖，语义正确）
 * @sideEffect      勾选/撤销时 POST /api/feedback-handled（乐观更新，失败回滚 + Toast）
 */
export default function FeedbackTodoList({ feedback }: { feedback: FeedbackTodoPayload | undefined }) {
  // 本地乐观列表：props 刷新（区间切换重取）时整体回到服务端真值
  const [unhandled, setUnhandled] = useState<FeedbackTodoItem[]>(feedback?.unhandled ?? [])
  const [handled, setHandled]     = useState<FeedbackTodoItem[]>(feedback?.handled ?? [])
  const [toast, setToast]         = useState<string | null>(null)
  // 勾选结果的读屏播报（aria-live）：视觉上列表移动已自证，读屏用户需要显式一句
  const [announce, setAnnounce]   = useState('')

  // 初始 open 只算一次、终身不变（非受控 details 的可靠前提，理由见顶注）：有未处理即默认展开
  const [initialOpen] = useState<boolean>(
    () => feedback != null && !feedback.loadFailed && feedback.unhandled.length > 0,
  )

  useEffect(() => {
    setUnhandled(feedback?.unhandled ?? [])
    setHandled(feedback?.handled ?? [])
  }, [feedback])

  /**
   * 勾选/撤销：先乐观移动列表，POST 失败（含 409 待迁移）回滚 + Toast。
   * @sideEffect POST /api/feedback-handled
   */
  const toggle = async (item: FeedbackTodoItem, toHandled: boolean, reply?: string): Promise<void> => {
    const prevUnhandled = unhandled
    const prevHandled = handled
    if (toHandled) {
      setUnhandled(u => u.filter(x => x.id !== item.id))
      setHandled(h => [{ ...item, handled_at: new Date().toISOString() }, ...h])
    } else {
      setHandled(h => h.filter(x => x.id !== item.id))
      // 撤销回未处理列表：保持 created_at 倒序（与服务端排序一致，别插头搅乱时间线）
      setUnhandled(u => [...u, { ...item, handled_at: null }]
        .sort((a, b) => b.created_at.localeCompare(a.created_at)))
    }
    try {
      // reply 只在「标为已处理」时随请求带出（撤销时服务端会连同回复与通知标记一起清空，不必也不该带）
      const res = await apiFetch('/api/feedback-handled', {
        method: 'POST',
        json: { id: item.id, handled: toHandled, ...(toHandled && reply?.trim() ? { reply: reply.trim() } : {}) },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null
        setUnhandled(prevUnhandled)
        setHandled(prevHandled)
        setToast(body?.code === 'HANDLED_NOT_MIGRATED' ? '已处理标记待迁移 0055，暂时标不了' : '没标上，再试一次')
        return
      }
      setAnnounce(toHandled
        ? (reply?.trim() ? '已标记为已处理，回复将在该用户下次进首页时弹出' : '已标记为已处理')
        : '已撤销处理标记')
    } catch {
      setUnhandled(prevUnhandled)
      setHandled(prevHandled)
      setToast('没标上，再试一次')
    }
  }

  const supported  = feedback?.handledSupported ?? false
  const loadFailed = feedback == null || feedback.loadFailed
  // 「历史 N 条」的 N：服务端总数 + 本地乐观增减（handled 只回近 20，不能拿列表长度冒充总数）
  const handledTotal = (feedback?.handledCount ?? 0) + (handled.length - (feedback?.handled.length ?? 0))
  const isEmpty = !loadFailed && unhandled.length === 0 && handledTotal === 0

  // summary 右侧状态字：有未处理用品牌深色强调（不是错误，不用 error 红）；其余 muted
  const summaryStatus = loadFailed
    ? <span className="text-[0.6875rem] text-v2-text-muted">加载失败</span>
    : unhandled.length > 0
      ? <span className="text-[0.6875rem] font-semibold text-brand-primary-dark">{unhandled.length} 条未处理</span>
      : <span className="text-[0.6875rem] text-v2-text-muted">0 条未处理 · 历史 {handledTotal} 条</span>

  return (
    <>
      {/* 折叠外壳照搬 CollapsibleSection 的视觉与 a11y 范式；不直接复用它是因为 summary 需要
          带强调色的状态字（它的 subtitle 固定 muted），以及 open 需要「只算一次」的初始值 */}
      <details open={initialOpen} className="group bg-white rounded-[16px] border border-black/[0.05] mb-3 overflow-hidden">
        <summary className="flex items-center gap-2 min-h-[44px] px-4 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
          <span className="text-[0.8125rem] font-semibold text-v2-text-primary">有新反馈吗</span>
          {summaryStatus}
          <svg className="ml-auto flex-shrink-0 transition-transform duration-200 group-open:rotate-180"
            width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="#7C6B5E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="px-4 pb-4 pt-1">
          {/* 勾选结果播报：视觉上列表移动自证，读屏靠这句 */}
          <p aria-live="polite" className="sr-only">{announce}</p>

          {loadFailed && (
            <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">反馈数据暂时加载失败，刷新页面重试。</div>
          )}

          {!loadFailed && !supported && (
            <div className="text-[0.625rem] text-v2-text-muted mb-2 leading-relaxed">
              已处理标记待迁移 0055，当前按近 7 天全列
            </div>
          )}

          {isEmpty && (
            <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">
              还没有人提过反馈。反馈入口在练习页、题库和素材库里。
            </div>
          )}

          {!loadFailed && unhandled.length > 0 && (
            <ul className="space-y-2.5 list-none">
              {unhandled.map(item => (
                <li key={item.id}>
                  <FeedbackCard item={item} checked={false} readOnly={!supported}
                    onToggle={supported ? (i, to, r) => { void toggle(i, to, r) } : undefined} />
                </li>
              ))}
            </ul>
          )}

          {/* 已处理折叠组：仅迁移后有意义；近 20 条，勾选态可点撤销 */}
          {supported && handled.length > 0 && (
            <details className="mt-3">
              <summary className="min-h-[44px] flex items-center text-[0.75rem] font-medium text-v2-text-secondary cursor-pointer select-none">
                已处理 · 最近 {handled.length} 条{handledTotal > handled.length ? `（历史共 ${handledTotal} 条）` : ''}
              </summary>
              <ul className="space-y-2.5 list-none mt-1">
                {handled.map(item => (
                  <li key={item.id}>
                    <FeedbackCard item={item} checked readOnly={false}
                      onToggle={(i, to, r) => { void toggle(i, to, r) }} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </details>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}
