// 最小化 Service Worker：只为满足 PWA 可安装性 + 后续 Web Push 挂载点。
// 刻意不做任何缓存（网络直通），避免部署后新旧 bundle 混用。
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// 空 fetch 监听只挂在 Chromium（Android 装桌面的判定条件曾要求有 fetch handler）。
// Chromium 会识别空监听并跳过 SW；WebKit（iPhone 上所有浏览器，UA 里没有 "Chrome/"）不会，
// 只要注册了就让导航和每个静态资源都先唤醒 SW 再转发，iPhone 每次刷新落地页多等 2~3 秒
if (/Chrome\//.test(self.navigator.userAgent)) {
  self.addEventListener('fetch', () => {
    // 网络直通：不拦截、不缓存
  })
}
