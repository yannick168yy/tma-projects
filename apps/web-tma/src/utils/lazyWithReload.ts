import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'

const RELOAD_KEY = 'chunk_reload_ts'

/**
 * 懒加载动态 import 的安全包装。
 *
 * 部署后旧客户端（长时间未刷新的 SPA 会话）内存里引用的旧 chunk 已被新构建覆盖删除，
 * SPA 内跳转触发 import() 会 404 失败。若不处理，rejection 冒泡至无 ErrorBoundary 的
 * Suspense 之上 → 整棵 React 树卸载 → 黑屏（表现为「一闪而过然后黑屏」）。
 *
 * 这里捕获加载失败并自动整页刷新一次：重新拉取 no-store 的 index.html + 新 chunk 自愈。
 * 10s 内只刷一次，避免真·网络故障时无限刷新。
 */
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err) => {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || '0')
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        window.location.reload()
      }
      throw err
    }),
  )
}
