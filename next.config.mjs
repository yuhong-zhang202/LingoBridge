import withPWA from "next-pwa";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.0.209'],
  experimental: {
    // ffmpeg-static / fluent-ffmpeg 包含原生二进制，不能被 webpack 打包
    serverComponentsExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg'],
    // 让 Vercel output tracing 包含 ffmpeg 二进制
    outputFileTracingIncludes: {
      '/api/transcribe': ['./node_modules/ffmpeg-static/**'],
    },
  },
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // 新 SW 进入 waiting 不自动接管；由 SwUpdatePrompt 让用户点「刷新」后再切换（避免发版白屏）
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
})(nextConfig);
