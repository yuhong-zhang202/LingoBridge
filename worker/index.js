// next-pwa 自定义 worker：编译进生成的 SW（产物 public/worker-*.js 已在 .gitignore）。
// 收到页面发来的 SKIP_WAITING 后让 waiting 中的新 SW 立即接管，配合「点此刷新」平滑发版。
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
