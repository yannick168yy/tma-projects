/**
 * 底部导航配置（P3-2）。由 `/site/config` 随 bootstrap 下发，
 * 在 `initSiteMarketConfig()` 里填充。
 *
 * 拉不到就用内置默认 —— 与功能开关同一个取向：一次 bootstrap 抖动不该让底栏消失。
 */
export interface BottomNavItem {
  id: string
  hidden: boolean
  sortOrder: number
  icon: string
  targetPath: string
}

// 与 bff 的 NAV_SLOTS 同序同默认值。两处清单无法合成一处（不共享 TS 包），
// 服务端总会下发，这份只在 bootstrap 失败时用
const DEFAULT_NAV: BottomNavItem[] = [
  { id: 'casino', hidden: false, sortOrder: 1, icon: 'home', targetPath: '/home' },
  { id: 'bonuses', hidden: false, sortOrder: 2, icon: 'gift', targetPath: '/bonuses' },
  { id: 'team', hidden: false, sortOrder: 3, icon: 'users', targetPath: '/team' },
  { id: 'games', hidden: false, sortOrder: 4, icon: 'gamepad', targetPath: '/games' },
  { id: 'menu', hidden: false, sortOrder: 5, icon: 'menu', targetPath: '/menu' },
]

let navItems: BottomNavItem[] | null = null

export function setBottomNav(raw: unknown): void {
  if (!Array.isArray(raw) || raw.length === 0) return
  const parsed = raw
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .map((x) => ({
      id: String(x.id ?? ''),
      hidden: x.hidden === true,
      sortOrder: Number(x.sortOrder ?? 0),
      icon: String(x.icon ?? ''),
      targetPath: String(x.targetPath ?? ''),
    }))
    .filter((x) => x.id && x.icon && x.targetPath)
  if (parsed.length > 0) navItems = parsed.sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getBottomNav(): BottomNavItem[] {
  return (navItems ?? DEFAULT_NAV).filter((x) => !x.hidden)
}
