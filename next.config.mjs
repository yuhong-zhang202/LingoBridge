import withPWAInit from "@ducanh2912/next-pwa";
import path from "path";
import { fileURLToPath } from "url";

// Next15 会因 home 目录下存在其它 lockfile 而误推断 workspace root；显式钉死为本项目目录，
// 让下面 outputFileTracingIncludes 的相对路径从项目根解析。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.0.209'],
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
        options: { cacheName: "pages", networkTimeoutSeconds: 5, expiration: { maxEntries: 32 } },
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
