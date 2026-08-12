/**
 * @module   security-headers-config.test
 * @desc     next.config.mjs 安全响应头的源码扫描守卫（审计 2026-08-06 P1-4）。
 *           不 import 该配置（ESM + next-pwa 包装在 jest 环境跑不动），照仓库既有
 *           「读源码断言不变式」的守卫风格（同 library-corpus-count.test.ts）。
 *           钉住两条会当场搞坏产品的红线：
 *           ① Permissions-Policy 必须是 microphone=(self) —— 写成 microphone=() 录音直接坏，
 *              而录音是本产品核心链路（口语练习、故事采集），且报错形态不像权限问题、极难定位；
 *           ② CSP 只许有 frame-ancestors —— 一旦加上 script-src，layout <head> 里的两处内联脚本
 *              （self-heal-chunk / font-scale-init）会被拦掉，chunk 404 时用户白屏且无自愈。
 *           ⚠️ 断言【只针对头的 value 字符串】、不扫全文：配置里的中文注释本身就提到了
 *              microphone=() / script-src 这些反例，扫全文会把注释当成配置误判。
 *           响应头「是否真的发出来」不在本文件的能力范围内，须用 curl 抓生产 build 验证。
 * @author   LingoBridge
 * @created  2026-08-07
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const config = readFileSync(join(__dirname, '../../next.config.mjs'), 'utf8')

/**
 * 从 next.config.mjs 里取出某个响应头配置的 value 字面量。
 * @param  key  响应头名（如 'Permissions-Policy'）
 * @returns     该头配置的 value 字符串；未配置则抛错（断言里直接暴露成失败）
 */
function headerValue(key: string): string {
  const re = new RegExp(`key:\\s*'${key}',\\s*\\n?\\s*value:\\s*(['"])([\\s\\S]*?)\\1`)
  const m = re.exec(config)
  if (!m) throw new Error(`next.config.mjs 里找不到响应头 ${key} 的配置`)
  return m[2] as string
}

describe('安全响应头 · 红线', () => {
  test('Permissions-Policy 保留 microphone=(self)，绝不能收成 microphone=()', () => {
    const v = headerValue('Permissions-Policy')
    expect(v).toContain('microphone=(self)')
    expect(v).not.toContain('microphone=()')
  })

  test('CSP 只配 frame-ancestors，不引入需要 nonce 改造的指令', () => {
    // 全等而非包含：多一条指令就是多一次「内联脚本被拦」的机会（完整 CSP 另案）
    expect(headerValue('Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })

  test('不误关会连累现有功能的能力（autoplay / fullscreen / clipboard 均未被禁）', () => {
    const v = headerValue('Permissions-Policy')
    for (const feature of ['autoplay', 'fullscreen', 'clipboard']) {
      expect(v).not.toContain(feature)
    }
  })
})

describe('安全响应头 · 六个头齐全', () => {
  test.each([
    ['X-Frame-Options', 'DENY'],
    ['Content-Security-Policy', "frame-ancestors 'none'"],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Strict-Transport-Security', 'max-age='],
    ['Permissions-Policy', 'microphone=(self)'],
  ])('%s 已配置', (key, expected) => {
    expect(headerValue(key)).toContain(expected)
  })

  test('HSTS 不带 preload（摘除周期以月计、且当前是平台共享域的子域，后续还要换自定义域名）', () => {
    expect(headerValue('Strict-Transport-Security')).not.toContain('preload')
  })

  test('关闭 x-powered-by（白送框架指纹）', () => {
    expect(config).toContain('poweredByHeader: false')
  })
})
