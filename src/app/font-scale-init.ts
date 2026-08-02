/**
 * @module   font-scale-init
 * @desc     全局字体档「防 FOUC 内联同步脚本」（作为字符串注入 layout 的 <head>，
 *           在 React/框架挂载前就同步执行，读 localStorage['lingobridge:font_scale']
 *           并写入根元素 --fs-scale，令首屏字号一步到位、零闪烁）。
 *           仿 self-heal-chunk.ts 的 head 内联脚本模式：内联进 HTML 才能保证「React 之前执行」。
 *           运行时代码刻意用 ES5 语法（var/function、无可选链），最大化老旧/降级环境兼容。
 *           无存值或存值非法 → 默认 1（视觉等于改动前）。键名与 lib/fontScale.ts 保持一致。
 * @author   LingoBridge
 * @created  2026-08-02
 */

/** 首屏字体档同步脚本源码（原样塞进 <head> 的 <script>）。 */
export const FONT_SCALE_INIT_SCRIPT = `(function () {
  try {
    var v = localStorage.getItem('lingobridge:font_scale');
    var n = v ? parseFloat(v) : 1;
    if (!(n > 0) || !isFinite(n)) n = 1;
    document.documentElement.style.setProperty('--fs-scale', String(n));
  } catch (e) {}
})();`
