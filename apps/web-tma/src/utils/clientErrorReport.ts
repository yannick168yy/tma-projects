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
    .find((s) => /\/assets\/index-[\w-]+\.js/.test(s))
  return src?.match(/index-([\w-]+)\.js/)?.[1] ?? ''
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

export function initClientErrorReport(): void {
  window.addEventListener('error', (e) => {
    // 资源加载失败（img/script）也走 error 事件但没有 error 对象，只报脚本错误
    if (e.error) reportClientError('error', e.error)
  })
  window.addEventListener('unhandledrejection', (e) => reportClientError('unhandledrejection', e.reason))
}
