import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '@/utils/clientErrorReport'

interface State { error: Error | null }

// 全局兜底：此前没有任何错误边界，任一渲染异常或 chunk 加载失败都会卸载整棵树，
// 用户只看到背景色（黑屏）且无从自救。这里改为可点击重试的提示页，并把堆栈上报。
export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const withStack = new Error(error.message)
    withStack.stack = `${error.stack ?? ''}\n--- component stack ---${info.componentStack ?? ''}`
    reportClientError('render', withStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#080b14] px-8 text-center text-white">
        <p className="text-2xl font-black tracking-tight">BETO<span className="text-[#ffb800]">GO</span></p>
        <p className="text-base font-bold">Something went wrong</p>
        <p className="text-sm text-white/60">Your account and balance are safe. Tap below to reload.</p>
        <button
          type="button"
          className="mt-2 h-11 rounded-xl bg-[#ffb800] px-8 text-sm font-black text-[#281800] active:scale-95"
          onClick={() => {
            try { sessionStorage.removeItem('chunk_reload_ts') } catch { /* 忽略 */ }
            window.location.reload()
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
