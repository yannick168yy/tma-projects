/**
 * 前端运行时错误上报到 bff（容器日志 grep "[client-error]"）。
 * 真机上的黑屏/白屏在本地和模拟器里常常复现不出来，没有堆栈只能靠猜。
 * 同一条错误只报一次、每页最多 10 条，避免错误循环把请求打满。
 */
const MAX_REPORTS = 10
const reported = new Set<string>()

function buildId(): string {
  const src = Array.from(document.querySelectorAll('script[type="module"]'))
    .map((s) => (s as HTMLScriptElement).src)
    .find((s) => /\/assets\/(index|main)-[\w-]+\.js/.test(s))
  return src?.match(/(?:index|main)-([\w-]+)\.js/)?.[1] ?? ''
}

export function reportClientError(kind: string, error: unknown, userId?: string): void {
  const err = error instanceof Error ? error : new Error(String(error))
  const key = `${kind}|${err.message}`
  if (reported.has(key) || reported.size >= MAX_REPORTS) return
  reported.add(key)
  try {
    void fetch('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ kind, message: err.message, stack: err.stack, url: location.href, build: buildId(), userId }),
    }).catch(() => {})
  } catch { /* 上报失败不影响页面 */ }
}

// 页面加载耗时上报：导航各阶段 + SW 启动 + 关键资源（transferSize=0 即命中缓存）。每页只报一次
let perfReported = false
export function reportPagePerf(kind: string): void {
  if (perfReported) return
  perfReported = true
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const r = (v: number | undefined) => (v ? Math.round(v) : 0)
    const key = /\/assets\/(main|vendor|App|IndiaLandingPage|indiaWelcome|index)-|\/site\/config|\/promotions\/config|fonts\.googleapis|telegram/
    const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((e) => key.test(e.name))
      .map((e) => `${e.name.replace(location.origin, '').replace(/\?.*/, '').slice(-40)}@${r(e.startTime)}+${r(e.duration)}${e.transferSize === 0 ? '(cache)' : ''}`)
    const detail = {
      render: r(performance.now()),
      type: nav?.type,
      sw: Boolean(navigator.serviceWorker?.controller),
      workerStart: r(nav?.workerStart),
      fetchStart: r(nav?.fetchStart),
      dns: r((nav?.domainLookupEnd ?? 0) - (nav?.domainLookupStart ?? 0)),
      connect: r((nav?.connectEnd ?? 0) - (nav?.connectStart ?? 0)),
      ttfb: r(nav?.responseStart),
      htmlEnd: r(nav?.responseEnd),
      dcl: r(nav?.domContentLoadedEventEnd),
      resources,
    }
    void fetch('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ kind, message: `render ${detail.render}ms`, url: location.href, build: buildId(), detail: JSON.stringify(detail) }),
    }).catch(() => {})
  } catch { /* 上报失败不影响页面 */ }
}

export function initClientErrorReport(): void {
  window.addEventListener('error', (e) => {
    // 资源加载失败（img/script）也走 error 事件但没有 error 对象，只报脚本错误
    if (e.error) reportClientError('error', e.error)
  })
  window.addEventListener('unhandledrejection', (e) => reportClientError('unhandledrejection', e.reason))
}
