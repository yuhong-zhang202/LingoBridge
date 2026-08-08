/**
 * @module   A11yAnnouncer
 * @desc     全站常驻读屏播报区 —— 一个挂在根布局、永不卸载的 aria-live 容器；任何组件（包括调用后
 *           自己就会被卸载的卡片）都能通过 announce() 往里写一句状态文字。
 *
 *           为什么必须常驻（项目铁律第一条）：读屏软件是「提前盯住」已存在的 live 容器，靠观察它的文本
 *           变化来播报；随消息一起被创建的容器，常常来不及被注册进去，那句播报就整条丢失。删除这类
 *           不可逆操作一旦丢播报，用户点完什么都听不到，也无从判断到底删没删。
 *
 *           播报纪律（项目铁律第二条）：只播状态、不念全文 —— 写「已删除 1 条语料」，
 *           绝不把语料 / 句子 / 词组原文塞进来。
 *
 *           实现走 useSyncExternalStore + 模块级 store：announce() 要能被「即将卸载的组件」在卸载前
 *           一刻调用，而播报区挂在根布局、调用方遍布全站，用 context 传不到。
 * @author   LingoBridge
 * @created  2026-08-08
 */
'use client'
import { useSyncExternalStore, type JSX } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let current = ''

/**
 * 订阅播报变化
 * @param onChange 播报文本变化时的回调
 * @returns        取消订阅的函数
 */
export function subscribeAnnouncements(onChange: Listener): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

/**
 * 读取当前播报文本
 * @returns 当前显示在常驻 live 容器里的文本（初始为空串）
 */
export function getAnnouncement(): string {
  return current
}

/**
 * 服务端快照：恒为空串
 * @returns 空串
 *
 * 模块级状态在服务端是跨请求共享的，绝不能把它渲染进 HTML；播报本就只在客户端交互后才发生。
 */
function getServerAnnouncement(): string {
  return ''
}

/**
 * 往全站常驻 live 容器播报一句状态
 * @param text 状态文案（只写状态，不得含用户内容原文）
 * @sideEffect 更新常驻 aria-live 容器的文本，读屏随即朗读
 */
export function announce(text: string): void {
  // 追加零宽空格制造文本差异，让「连删两次」的第二句也能被播报：文本没变化读屏不会再读一遍。
  // 零宽空格不占位、读屏也不朗读它本身。
  current = text === current ? `${text}\u200B` : text
  listeners.forEach((fn) => fn())
}

/**
 * 全站常驻播报区（挂在根布局 body 内，永不卸载）
 * @returns 视觉隐藏（sr-only）、始终存在于 DOM 的 aria-live 容器
 */
export default function A11yAnnouncer(): JSX.Element {
  const text = useSyncExternalStore(subscribeAnnouncements, getAnnouncement, getServerAnnouncement)

  // aria-atomic：每次都整句重读，避免读屏只念出与上一句的差异字。
  return <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{text}</p>
}
