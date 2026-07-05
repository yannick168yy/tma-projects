// 最小化 Service Worker：只为满足 PWA 可安装性 + 后续 Web Push 挂载点。
// 刻意不做任何缓存（网络直通），避免部署后新旧 bundle 混用。
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // 网络直通：不拦截、不缓存
})
