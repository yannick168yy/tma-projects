import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('bottom-nav')

/**
 * 底部导航配置（P3-2）。
 *
 * 5 个槽位的顺序、显示、图标、跳转目标可配。槽位 id 本身不可增删 ——
 * 每个槽位背后是一个已经存在的页面组件，凭空多一个 id 不会有页面跟着长出来。
 * 想换内容就改 targetPath 指向另一个已有页面。
 */
export interface NavSlotDef {
  id: string
  label: string
  defaultIcon: string
  defaultPath: string
  /** 该槽位依赖的功能开关；关掉时整槽消失（P1-8） */
  feature?: string
  /** 不允许隐藏的槽位：没有它用户回不了家 */
  required?: boolean
}

export const NAV_SLOTS: NavSlotDef[] = [
  { id: 'casino', label: '首页', defaultIcon: 'home', defaultPath: '/home', required: true },
  { id: 'bonuses', label: '优惠', defaultIcon: 'gift', defaultPath: '/bonuses' },
  { id: 'team', label: '三圈（团队）', defaultIcon: 'users', defaultPath: '/team', feature: 'team_commission' },
  { id: 'games', label: '游戏', defaultIcon: 'gamepad', defaultPath: '/games' },
  { id: 'menu', label: '菜单', defaultIcon: 'menu', defaultPath: '/menu' },
]

/**
 * 图标白名单。前端按名字取 lucide 组件 —— 不给自由字符串是因为写错名字的结果是
 * 底栏少一个图标，而这种问题没人会在后台保存时发现。
 */
export const NAV_ICONS = [
  'home', 'gamepad', 'gift', 'menu', 'users', 'crown', 'percent', 'trophy',
  'sparkles', 'ticket', 'wallet', 'star',
] as const

/**
 * 跳转目标白名单：只允许指向已经存在的页面与浮层（与 appRoutes 的 TAB_PATHS /
 * OVERLAY_PATHS 对齐）。填一个不存在的路径，前端解析为 null 会直接跳回首页，
 * 表现成「点了没反应」。
 */
export const NAV_TARGETS = [
  '/home', '/games', '/bonuses', '/menu',
  '/team', '/agent', '/vip', '/rebate', '/tasks', '/rewards-spin', '/download', '/perya', '/search',
] as const

export interface BottomNavItem {
  id: string
  hidden: boolean
  sortOrder: number
  icon: string
  targetPath: string
}

interface NavRow extends RowDataPacket {
  nav_id: string
  hidden: number
  sort_order: number
  icon: string | null
  target_path: string | null
}

/** 合并默认值与配置行。表不存在（迁移还没跑）时退回全默认，不让首屏 500 */
export async function getBottomNav(env: Env): Promise<BottomNavItem[]> {
  let rows: NavRow[] = []
  try {
    const [res] = await getMysqlPool(env).query<NavRow[]>(
      'SELECT nav_id, hidden, sort_order, icon, target_path FROM bg_bottom_nav')
    rows = res
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e }, '读底部导航配置失败，用默认值')
  }
  const byId = new Map(rows.map((r) => [r.nav_id, r]))
  return NAV_SLOTS
    .map((slot, idx) => {
      const row = byId.get(slot.id)
      return {
        id: slot.id,
        hidden: row?.hidden === 1,
        // sort_order=0 表示没配过，用代码里的位置（+1 避开 0）
        sortOrder: row?.sort_order || idx + 1,
        icon: row?.icon || slot.defaultIcon,
        targetPath: row?.target_path || slot.defaultPath,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export interface NavInput {
  navId: string
  hidden: boolean
  icon: string | null
  targetPath: string | null
}

/**
 * 保存。校验放服务端：底栏配坏了是整站级故障（点不动、回不了首页），
 * 而后台的下拉框只是「不容易点错」。
 */
export function validateBottomNav(items: NavInput[]): string | null {
  const ids = new Set(NAV_SLOTS.map((s) => s.id))
  for (const item of items) {
    if (!ids.has(item.navId)) return `未知的导航槽位 ${item.navId}`
    if (item.icon && !(NAV_ICONS as readonly string[]).includes(item.icon)) return `图标 ${item.icon} 不在白名单内`
    if (item.targetPath && !(NAV_TARGETS as readonly string[]).includes(item.targetPath)) {
      return `跳转目标 ${item.targetPath} 不在白名单内`
    }
  }
  const hiddenIds = new Set(items.filter((i) => i.hidden).map((i) => i.navId))
  for (const slot of NAV_SLOTS) {
    if (slot.required && hiddenIds.has(slot.id)) return `${slot.label}不能隐藏，否则用户回不了首页`
  }
  // 少于两个入口的底栏等于没有底栏，用户会以为 App 坏了
  if (NAV_SLOTS.length - hiddenIds.size < 2) return '至少要保留两个导航入口'
  return null
}

export async function saveBottomNav(env: Env, items: NavInput[]): Promise<void> {
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 顺序按传入数组，从 1 开始
    for (const [idx, item] of items.entries()) {
      await conn.execute(
        `INSERT INTO bg_bottom_nav (nav_id, hidden, sort_order, icon, target_path)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE hidden = VALUES(hidden), sort_order = VALUES(sort_order),
           icon = VALUES(icon), target_path = VALUES(target_path)`,
        [item.navId, item.hidden ? 1 : 0, idx + 1, item.icon, item.targetPath])
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** 后台编辑页要的完整目录：槽位定义 + 当前配置 + 可选项 */
export async function bottomNavCatalog(env: Env): Promise<{
  slots: NavSlotDef[]
  items: BottomNavItem[]
  icons: string[]
  targets: string[]
}> {
  return {
    slots: NAV_SLOTS,
    items: await getBottomNav(env),
    icons: [...NAV_ICONS],
    targets: [...NAV_TARGETS],
  }
}
