/**
 * @module   self-heal-chunk
 * @desc     chunk 加载失败的「静默自愈一次」内联脚本（作为字符串注入 layout 的 <head>，
 *           在 React 启动前同步执行，兜住 error.tsx 边界挂载前就发生的 /_next/static 资源 404）。
 *           命门是防死循环：sessionStorage 一次性闸——本会话自愈过一次后不再刷新，
 *           放它自然落到 SSR 外壳/错误页（用户能反馈），绝不 白屏→清→刷→白屏 无限循环。
 * @author   LingoBridge
 * @created  2026-07-21
 *
 * 为何是内联字符串而非 next/script 外链：整个故障场景就是「/_next/static 里的 chunk 拿不到」，
 * 自愈逻辑本身绝不能依赖任何会被同一场景弄挂的 chunk。内联进 HTML 的脚本即便所有 chunk 全 404
 * 也一定会执行；而且 SW 缓存的旧外壳里也内嵌着这份脚本，回退到旧外壳时自愈依旧生效。
 * 运行时代码刻意用 ES5 语法（var/function、无可选链），最大化老旧/降级环境兼容性。
 */

/**
 * 自愈脚本的 JS 源码（将被原样塞进 <script> 的内容）。
 * 判据严格限定：仅 <script>/<link> 且 src/href 指向 /_next/static/ 的资源错误，
 * 或 message 命中已知 chunk 关键词的 promise rejection——绝不把普通运行时错误当 chunk 失败自愈。
 */
export const SELF_HEAL_CHUNK_SCRIPT = `(function () {
  var KEY = '__lb_chunk_healed__';
  var STATIC = '/_next/static/';
  var sawChunkError = false;
  var healing = false;

  function isChunkErrorMessage(msg) {
    if (!msg) return false;
    return msg.indexOf('ChunkLoadError') !== -1
      || msg.indexOf('Loading chunk') !== -1
      || msg.indexOf('Loading CSS chunk') !== -1
      || msg.indexOf('Failed to fetch dynamically imported module') !== -1
      || msg.indexOf('error loading dynamically imported module') !== -1;
  }

  function markGetHealed() {
    try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function markSetHealed() {
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
  }
  function markClear() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  function heal(reason) {
    if (healing) return;
    // 一次性闸：本会话已自愈过仍失败 → 不再刷新，交由 SSR 外壳/错误页兜底，杜绝死循环
    if (markGetHealed()) {
      try { console.warn('[self-heal] 已自愈过仍失败，停止刷新，交由错误页兜底：', reason); } catch (e) {}
      return;
    }
    healing = true;
    markSetHealed();
    try { console.warn('[self-heal] 检测到 chunk 加载失败，清缓存 + 注销 SW 后刷新一次：', reason); } catch (e) {}

    var reloaded = false;
    function reloadOnce() {
      if (reloaded) return;
      reloaded = true;
      try { window.location.reload(); } catch (e) {}
    }
    // 清理最多等 3 秒，超时也强制刷新——清理失败绝不能阻断自愈
    var timer = setTimeout(reloadOnce, 3000);

    var tasks = [];
    try {
      if (window.caches && caches.keys) {
        tasks.push(caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) {
            return caches.delete(k).catch(function () {});
          }));
        }).catch(function () {}));
      }
    } catch (e) {}
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        tasks.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) {
            return r.unregister().catch(function () {});
          }));
        }).catch(function () {}));
      }
    } catch (e) {}

    Promise.all(tasks).then(function () {
      clearTimeout(timer);
      reloadOnce();
    }).catch(function () {
      clearTimeout(timer);
      reloadOnce();
    });
  }

  // 1) 静态资源加载失败（<script>/<link> 指向 /_next/static/）——资源 error 不冒泡，必须捕获阶段
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (!t || t === window) return;
    var tag = (t.tagName || '').toUpperCase();
    if (tag !== 'SCRIPT' && tag !== 'LINK') return;
    var url = t.src || t.href || '';
    if (typeof url !== 'string' || url.indexOf(STATIC) === -1) return;
    sawChunkError = true;
    heal('resource ' + tag + ' ' + url);
  }, true);

  // 2) 动态 import / ChunkLoadError → 走 promise rejection
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var msg = '';
    if (r) { msg = (typeof r === 'string') ? r : (r.message || r.name || ''); }
    if (!isChunkErrorMessage(msg)) return;
    sawChunkError = true;
    heal('rejection ' + msg);
  });

  // 3) 页面成功加载完成后清标记，下次失败仍可再自愈一次。
  //    注意 window.load 即使有子资源 404 也会触发，故仅在「本次加载未见 chunk 错误」时才清，
  //    否则会抹掉一次性闸，导致自愈后仍失败时无限循环。
  window.addEventListener('load', function () {
    if (sawChunkError) return;
    markClear();
  });
})();`
