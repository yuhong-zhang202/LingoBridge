/**
 * @module   codemod-text-px-to-rem
 * @desc     全局字体档机制配套 codemod：把 src/ 下所有 Tailwind 字号 arbitrary value
 *           `text-[<N>px]` 换成 `text-[<N/16>rem]`（N 可为整数或 .5 小数，分母 16/32 恒有限小数，
 *           scale=1.0 时 rem×16px 精确还原原 px、逐像素一致）。
 *           只命中字号：正则限定 `text-\[<数字>px\]`；绝不碰 `text-[#hex]`（颜色）、
 *           `tracking-/leading-/w-/h-/p-/m-/gap-/rounded-/border-[Npx]`（间距/布局/圆角/边框）——
 *           这些前缀不是 `text-`，正则天然排除。响应式前缀（lg:text-[14px]）因只匹配 `text-[...]`
 *           括号段而照常命中。一次性工具，跑完 grep 复核 `text-\[[0-9]+px\]` 应归零。
 * @author   LingoBridge
 * @created  2026-08-02
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// 仅命中 text-[<数字(可带.5小数)>px]，不匹配颜色/间距/布局的 arbitrary value
const RE = /text-\[(\d+(?:\.\d+)?)px\]/g

/** px 数值 → rem 字符串（除以 16，去尾零）。N/16 与 N/32 恒有限，无浮点残留。 */
function pxToRem(pxStr) {
  const px = Number(pxStr)
  const rem = parseFloat((px / 16).toFixed(6))
  return `text-[${rem}rem]`
}

const files = execSync('grep -rlE "text-\\[[0-9]+(\\.[0-9]+)?px\\]" src', {
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean)

let totalHits = 0
let changedFiles = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  let hits = 0
  const out = src.replace(RE, (_m, n) => {
    hits += 1
    return pxToRem(n)
  })
  if (hits > 0) {
    writeFileSync(file, out)
    totalHits += hits
    changedFiles += 1
  }
}

console.log(`替换处数: ${totalHits}`)
console.log(`改动文件: ${changedFiles}`)
