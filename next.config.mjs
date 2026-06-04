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
  skipWaiting: true,
})(nextConfig);
