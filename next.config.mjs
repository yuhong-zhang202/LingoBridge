import withPWAInit from "@ducanh2912/next-pwa";
import path from "path";
import { fileURLToPath } from "url";

// Next15 会因 home 目录下存在其它 lockfile 而误推断 workspace root；显式钉死为本项目目录，
// 让下面 outputFileTracingIncludes 的相对路径从项目根解析。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 全站安全响应头（审计 P1-4：生产站六个头全缺，删号按钮可被 clickjacking）。
 *
 * 真实攻击面：把 /settings 放进透明 iframe 覆在诱导页上，已登录用户点两下就触发删号。
 * 这【不是 CSRF】——所有写接口都要 Authorization: Bearer，跨站表单设不了自定义头；
 * 但 clickjacking 走的是「用户自己的页面自己的 token」，与 CSRF 防护无关，只能靠禁止被嵌。
 *
 * ⚠️ 本次【故意只配 CSP 的 frame-ancestors】，不配 script-src / style-src / default-src。
 *    layout 的 <head> 里有两处内联脚本（self-heal-chunk.ts 的 chunk 自愈、font-scale-init.ts 的
 *    防 FOUC 字号），加 script-src 而不做 nonce 改造会被直接拦掉——尤其自愈脚本，它服务的故障
 *    场景就是「chunk 拿不到」，被拦=用户遇到 chunk 404 时白屏且无自愈。完整 CSP 另案。
 *
 * @returns Next headers 配置数组（对全部路由生效）
 */
async function securityHeaders() {
  return [
    {
      // 覆盖全部路由：页面、/api、public 静态文件都要带（漏配任一处都可能被单独嵌进 iframe）
      source: '/:path*',
      headers: [
        // 取 DENY 而非 SAMEORIGIN：全站无任何 <iframe>（已 grep 确认），同源嵌套也不需要，
        // 留 SAMEORIGIN 只会给未来的同源 XSS/开放重定向多留一条组合路径。
        { key: 'X-Frame-Options', value: 'DENY' },
        // frame-ancestors 是 X-Frame-Options 的现代替代（且是唯一被现代浏览器认真执行的那个）；
        // 二者同时给，是为了兼容仍只认 XFO 的老 WebView（国内机型内置浏览器版本参差）。
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        // 关掉 MIME 嗅探：用户上传的头像走 Supabase Storage 域，但本域仍有 /public 下的静态文件，
        // 嗅探会让「被当作 text/plain 返回的内容」有机会被当 script 执行。
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        // 取 strict-origin-when-cross-origin：同源保留完整路径，跨源只发 origin——本站 URL 里
        // 出现过 corpus id / 题目 id 这类标识符，路径绝不能跨站泄露。
        // 不取更严的 same-origin/no-referrer：额外收益只是藏住「用户来自本站」这一点，
        // 代价是将来接任何按 Referer 域名鉴权的三方（图片防盗链、支付网关）会静默失败。
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // HSTS —— 【本表唯一不可逆的一条】，浏览器会把该 host 记住 max-age 这么久。
        // max-age=15552000（180 天）：足以覆盖绝大多数回访周期、拿到 HSTS 的实际防护（防 SSL strip），
        //   又把「万一将来要改协议策略」的锁定期压在半年而非一年。
        // includeSubDomains 安全：HSTS 只作用于发出它的 host 及其子域，即 lingobridge.zeabur.app
        //   及 *.lingobridge.zeabur.app —— 【不会】波及 zeabur.app 上的其它租户；而我们这一级下面
        //   目前没有任何子域，将来绑自定义域名时本头也只对当时提供响应的那个 host 生效。
        // 【不加 preload】：preload 摘除周期以月计且不能自助，而当前生产域是平台共享域 zeabur.app
        //   的子域、后续还要换自定义域名——把一个临时域名钉进浏览器内置列表纯亏。
        // 本头在 http 响应上按规范被浏览器忽略，故本机 `next start`（http）不会污染开发环境。
        { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
        // ⚠️ microphone=(self) 是硬红线：录音是本产品核心链路（口语练习、故事采集），
        //    写成 microphone=() 会让 getUserMedia 直接拒绝，且报错不像权限问题、极难定位。
        // camera / geolocation / usb / display-capture / payment：全站零调用（已 grep 确认），
        //   显式关掉是把「将来某个依赖或误加的代码悄悄要权限」这条路提前堵死，当前零功能代价。
        // 【故意不列】autoplay、fullscreen、clipboard-*：autoplay 与 Web Audio 的播放门控相关
        //   （Orb 的 AudioContext），fullscreen/clipboard 将来可能要用，关了才是自找 bug。
        {
          key: 'Permissions-Policy',
          value: 'microphone=(self), camera=(), geolocation=(), usb=(), display-capture=(), payment=()',
        },
      ],
    },
  ]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.0.209'],
  // 不发 x-powered-by: Next.js —— 白送攻击者框架指纹，没有任何功能价值
  poweredByHeader: false,
  headers: securityHeaders,
  // 钉死 workspace root 为项目目录（否则 Next15 误选 home 目录 lockfile 作根，连累下面的 ffmpeg tracing）
  outputFileTracingRoot: __dirname,
  // ffmpeg-static / fluent-ffmpeg 包含原生二进制，不能被 webpack 打包（Next15：已从 experimental 提升到顶层）
  serverExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg'],
  // ⚠️ 下面两项 outputFileTracing* 是 Vercel 时代遗留，在当前部署方式下【不生效】：
  //    Zeabur 跑标准 `next start` + 完整 node_modules（未开 output:'standalone'），产物追踪结果根本不被消费。
  //    当前生产的 ffmpeg 二进制靠的是 Zeabur 环境变量
  //      ZBPACK_INSTALL_COMMAND = npm install && node node_modules/ffmpeg-static/install.js
  //    （构建机 npm 默认拦安装脚本，见 docs/部署交接-香港PaaS.md §10）——与这里的配置无关。
  //    保留而不删：目前无害，且若将来改用 standalone 产物仍需要它；删改属部署面变更，要单独验证。
  // 让 output tracing 包含 ffmpeg 二进制（Next15：已从 experimental 提升到顶层）
  outputFileTracingIncludes: {
    '/api/transcribe': ['./node_modules/ffmpeg-static/**'],
  },
};

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // customWorkerSrc 默认 "worker"（相对根目录）→ 现有 worker/index.js 仍被编译进 SW
  workboxOptions: {
    // 新 SW 进入 waiting 不自动接管；由 SwUpdatePrompt 让用户点「刷新」后再切换（避免发版白屏）。
    // skipWaiting:false 时该包会注入 message 监听，配合 worker/index.js 的 SKIP_WAITING 平滑发版
    skipWaiting: false,
    // 按 AI + 登录态产品裁剪缓存策略，替换 next-pwa 默认 runtimeCaching
    runtimeCaching: [
      // /api/* 一律实时：AI 输出 / 用户数据 / 额度 / 成本都不缓存
      { urlPattern: /\/api\/.*/i, handler: "NetworkOnly" },
      // 页面导航在线取最新，离线回退缓存外壳（外壳不含用户数据，共享设备不串用户）
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        // 2.5s：目标用户在国内跨境链路，等满 5s 才回退缓存体验差；2.5s 足够区分「网络正常」与「网络劣化」。
        options: { cacheName: "pages", networkTimeoutSeconds: 2.5, expiration: { maxEntries: 32 } },
      },
      // 其余静态资源 stale-while-revalidate（构建产物已被版本化预缓存）
      {
        urlPattern: /\.(?:js|css|woff2?|png|jpe?g|svg|gif|webp|ico)$/i,
        handler: "StaleWhileRevalidate",
        options: { cacheName: "static-assets", expiration: { maxEntries: 200, maxAgeSeconds: 2592000 } },
      },
    ],
  },
});

export default withPWA(nextConfig);
