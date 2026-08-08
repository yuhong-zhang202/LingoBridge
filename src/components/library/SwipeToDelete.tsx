/**
 * @module   SwipeToDelete
 * @desc     移动端左滑删除容器 —— 子内容左滑露出红底删除按钮，越过阈值锁定、点删除弹二次确认后才真删。
 *           带方向锁：首次位移 >6px 时按 |dx|>|dy| 定轴，判定为纵向手势（卡内滚动）则整段忽略横移，
 *           避免卡内滚动时误拖出删除底。
 *
 *           三条无障碍约束（2026-08-08 修，改动前对用鼠标的明眼人完全无感，所以一直没被发现）：
 *           1. 红底删除按钮常驻 DOM、只是被卡片盖住。未滑出时必须既不可聚焦也不被读屏拾取，否则靠 Tab
 *              导航的用户会在【每一张卡】上撞到一个屏幕上看不见的「删除」。滑出后必须恢复可聚焦，
 *              不然手势用户反而用不了。
 *           2. 点删除不能一按即删。确认流程做在本组件内部（而不是甩给调用方），理由见文件末尾。
 *           3. 删完要把焦点交给幸存的相邻卡，否则卡片一卸载焦点就掉回 <body>，键盘用户想接着删下一张
 *              得从页首重新 Tab 一遍。落点规则见 lib/focus-handoff.ts，同样做在组件内部、四个调用方白拿。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { announce } from '@/components/A11yAnnouncer'
import { DELETE_ITEM_ATTR, isRendered, pickFocusTarget } from '@/lib/focus-handoff'

const DEL_BG = 'linear-gradient(to right, rgba(212,83,79,0.0) 0%, rgba(212,83,79,0.6) 15%, #D4534F 40%)'

// 位移越过这个值就算「删除按钮已经露出来了」，此时才让它进入 Tab 顺序 / 读屏。
// 与 onTouchEnd 的锁定阈值同数：手指松开时若没到这个位移，卡片会弹回、按钮重新被盖住。
const REVEALED_PX = -65

interface Props {
  onDelete: () => void
  borderRadius?: number
  /** 二次确认的说明文案。默认通用措辞；调用方知道删的是什么时应传更具体的一句 */
  confirmDescription?: string
  /** 删除后的读屏播报。只写状态，绝不能把语料 / 词组 / 句子原文塞进来 */
  announceOnDelete?: string
  children: React.ReactNode
}

export default function SwipeToDelete({
  onDelete,
  borderRadius = 20,
  confirmDescription = '确认删除这一项？此操作不可撤销。',
  announceOnDelete = '已删除 1 项',
  children,
}: Props) {
  const [offset, setOffset] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const isLocked = useRef(false)
  // 方向锁：本次触摸判定的手势轴。null=未定轴；'v'=纵向（卡内滚动，忽略横移）；'h'=横向（左滑删除）
  const axis = useRef<'h' | 'v' | null>(null)

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    axis.current = null
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startX.current
    // 首次位移超过 6px 死区时定轴，一次触摸内不再改判——防止卡内纵向滚动带出横移
    if (axis.current === null) {
      const dy = e.touches[0].clientY - startY.current
      if (Math.abs(diff) > 6 || Math.abs(dy) > 6) axis.current = Math.abs(diff) > Math.abs(dy) ? 'h' : 'v'
    }
    if (axis.current !== 'h') return
    if (isLocked.current && diff > 0) setOffset(Math.min(-130 + diff, 0))
    else if (!isLocked.current && diff < 0) setOffset(Math.max(diff, -130))
  }

  const onTouchEnd = () => {
    axis.current = null
    setOffset(prev => {
      if (isLocked.current) {
        const keep = prev <= -80
        if (!keep) isLocked.current = false
        return keep ? -130 : 0
      }
      const lock = prev < -65
      if (lock) isLocked.current = true
      return lock ? -130 : 0
    })
  }

  /**
   * 算好本卡被删后的焦点落点，返回「等这一帧 DOM 收拾完再执行」的交接动作。
   * 必须在真删之前算：卡片一卸载，就再也问不出「我的下一张是谁」了。
   */
  const planFocusHandoff = (): (() => void) => {
    const root = rootRef.current
    if (!root) return () => {}
    const items = Array.from(document.querySelectorAll<HTMLElement>(`[${DELETE_ITEM_ATTR}]`))
    const target = pickFocusTarget(items, root, isRendered)
    if (!target) return () => {}
    return () => {
      // 必须等到本次提交之后：ConfirmDialog 关闭时会把焦点还给触发它的那颗删除按钮，而那颗按钮
      // 正随本卡一起消失 —— 同步移焦点会被它盖掉，最终还是掉回 <body>。rAF 排在提交与绘制之间。
      requestAnimationFrame(() => {
        if (document.body.contains(target)) target.focus()
      })
    }
  }

  /** 二次确认通过后才真删：调用方回调 + 播报状态 + 把滑出的红底收回 + 把焦点交给相邻卡 */
  const handleConfirm = () => {
    const handoff = planFocusHandoff()
    setConfirming(false)
    onDelete()
    // 先播报、后移焦点：反过来的话读屏正在朗读的那句会被焦点变化打断，用户只听到其中一件事
    announce(announceOnDelete)
    isLocked.current = false
    setOffset(0)
    handoff()
  }

  const revealed = offset <= REVEALED_PX

  return (
    // data-delete-item + tabIndex={-1}：本卡既是「删掉别人之后能接住焦点的落点」，也是别人查找落点时的候选。
    // tabIndex 取 -1 —— 只允许程序化聚焦，不进 Tab 顺序（进了的话每张卡会多出一站空停留）。
    // 属性名写死在这里、查找用 DELETE_ITEM_ATTR 常量，两处必须同名；有单测盯着这一致性（改一处会红）。
    <div ref={rootRef} data-delete-item="" tabIndex={-1} className="relative overflow-hidden" style={{ borderRadius }}>
      <button
        type="button"
        // 用 aria-hidden + tabIndex + disabled 三件套，不用 inert：inert 在 React 19 虽已是原生布尔属性，
        // 但浏览器支持从 Safari 15.5 / Chrome 102 才开始，老设备上写了等于没写、bug 原样保留；
        // 而这三个属性是全兼容的老资格 —— aria-hidden 挡读屏、tabIndex=-1 出 Tab 顺序、disabled 兜住
        // 「被程序化聚焦后按回车」这条路。
        aria-hidden={!revealed}
        tabIndex={revealed ? 0 : -1}
        disabled={!revealed}
        className="absolute inset-0 flex items-center justify-end"
        style={{ background: DEL_BG }}
        onClick={() => setConfirming(true)}
      >
        <div className="w-[130px] flex items-center justify-center gap-1.5 text-white text-[0.875rem] font-medium">
          <Trash2 size={16} />删除
        </div>
      </button>
      <div
        className="relative z-10 transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
      {/* portal 到 body：本容器是 overflow-hidden 的卡片外壳、内层还带 transform，弹窗留在里面容易被裁
          或被别的卡片盖住。confirming 初始为 false，服务端渲染这一路永远走不到 document。 */}
      {confirming && createPortal(
        <ConfirmDialog
          open
          title="确认删除"
          description={confirmDescription}
          danger
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
        />,
        document.body,
      )}
    </div>
  )
}

/**
 * 为什么确认流程做在组件内部，而不是把「确认」的责任交给调用方（2026-08-08）
 *
 * 取舍：
 * - 交给调用方（每处自己弹 ConfirmDialog 再调 onDelete）语义更干净，本组件仍是纯手势容器；
 *   但那要求四个调用方（CollectedCard、MyStoriesTab、SavedWordsTab、PronunciationTab）各改一遍，
 *   将来第五个调用方忘了接，就又多一个「一按即删」，而且这种漏接静态检查抓不到。
 * - 做在组件内部则是「默认安全」：任何人 <SwipeToDelete onDelete={...}> 拿到的都是带确认的删除，
 *   不存在忘记接的可能。代价是文案泛化（组件不知道删的是什么），故留了 confirmDescription /
 *   announceOnDelete 两个可选 prop 让调用方补具体措辞。
 *
 * 选后者。破坏性操作的安全性不该依赖「每个调用方都记得做对」。
 * 三个 *Tab.tsx 调用方当前正被另一分支改版，本次未改动它们，因此都吃默认文案；
 * 那边收口后建议逐个补上具体的 confirmDescription（如「确认删除这条语料？」）。
 */
