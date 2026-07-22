import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserIdentity } from '../types/domain.js'

const state = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
  conn: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
    execute: vi.fn(),
  },
  listUserIdentities: vi.fn(),
  creditWallet: vi.fn(),
  getUser: vi.fn(),
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}))

vi.mock('../clients/mysql.client.js', () => ({
  getMysqlPool: vi.fn(() => state.pool),
  isMysqlEnabled: vi.fn(() => true),
}))

vi.mock('../clients/redis.client.js', () => ({
  getRedis: vi.fn(() => state.redis),
}))

vi.mock('../services/store/mysql-store.js', () => ({
  creditWallet: state.creditWallet,
  listUserIdentities: state.listUserIdentities,
  getUser: state.getUser,
}))

vi.mock('../services/turnover.service.js', () => ({
  createPromoRequirement: vi.fn(),
}))

vi.mock('../services/checkin.service.js', () => ({
  manilaToday: vi.fn(() => '2026-07-22'),
  getCheckinStatus: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../services/promo-config.service.js', () => ({
  getPromoConfig: vi.fn(() => Promise.resolve({
    trial: { enabled: false },
    appdl: { enabled: false },
    firstdep: { enabled: false },
  })),
}))

vi.mock('../services/vip.service.js', () => ({
  ensureBirthdayFromKyc: vi.fn(() => Promise.resolve(false)),
}))

import { claimTask, getTaskCenter } from '../services/task.service.js'

const identity = (provider: UserIdentity['provider']): UserIdentity => ({
  id: 1,
  userId: 'BG-10001',
  provider,
  identifier: provider,
  verifiedAt: '2026-07-22T00:00:00.000Z',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
})

const taskConfig = {
  PHP: {
    daily_deposit_t1: { enabled: true, rewardType: 'spin', amount: 0, spin: 1, turnoverX: 0, currency: 'PHP', threshold: 100, minStake: 0, category: '' },
    daily_deposit_t2: { enabled: true, rewardType: 'cash', amount: 10, spin: 0, turnoverX: 3, currency: 'PHP', threshold: 500, minStake: 0, category: '' },
    daily_deposit_t3: { enabled: true, rewardType: 'cash', amount: 30, spin: 0, turnoverX: 3, currency: 'PHP', threshold: 2000, minStake: 0, category: '' },
    daily_bets: { enabled: true, rewardType: 'spin', amount: 0, spin: 1, turnoverX: 0, currency: 'PHP', threshold: 5, minStake: 10, category: '' },
    daily_play: { enabled: false, rewardType: 'spin', amount: 0, spin: 1, turnoverX: 0, currency: 'PHP', threshold: 1, minStake: 0, category: 'slot' },
    profile_complete: { enabled: true, rewardType: 'spin', amount: 0, spin: 1, turnoverX: 10, currency: 'PHP', threshold: 2, minStake: 0, category: '' },
    first_game: { enabled: false, rewardType: 'spin', amount: 0, spin: 1, turnoverX: 10, currency: 'PHP', threshold: 1, minStake: 0, category: '' },
    invite_milestone: { enabled: false, rewardType: 'cash', amount: 10, spin: 0, turnoverX: 10, currency: 'PHP', threshold: 3, minStake: 0, category: '' },
  },
}

function setupPool(rows: {
  depositTotal?: number
  betCount?: number
  claimed?: { task_id: string; period_key: string; currency: string }[]
} = {}) {
  state.pool.query.mockImplementation((sql: string) => {
    if (sql.includes('FROM bg_admin_settings')) return Promise.resolve([[{ value: JSON.stringify(taskConfig) }]])
    if (sql.includes('FROM bg_task_claim')) return Promise.resolve([rows.claimed ?? []])
    if (sql.includes('FROM bg_deposit_order')) return Promise.resolve([[{ total: rows.depositTotal ?? 0 }]])
    if (sql.includes('FROM bg_bet_order')) return Promise.resolve([[{ n: rows.betCount ?? 0 }]])
    if (sql.includes('FROM bg_app_download_claim')) return Promise.resolve([[]])
    return Promise.resolve([[]])
  })
}

describe('任务服务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.pool.getConnection.mockReturnValue(state.conn)
    state.conn.beginTransaction.mockResolvedValue(undefined)
    state.conn.commit.mockResolvedValue(undefined)
    state.conn.rollback.mockResolvedValue(undefined)
    state.conn.release.mockReturnValue(undefined)
    state.redis.get.mockResolvedValue(null)
    state.redis.set.mockResolvedValue('OK')
    state.redis.del.mockResolvedValue(1)
    state.getUser.mockResolvedValue(null)
    state.listUserIdentities.mockResolvedValue([])
    state.creditWallet.mockResolvedValue({ available: 10, frozen: 0 })
  })

  it('Telegram OIDC 绑定计入 Link Your Accounts', async () => {
    setupPool()
    state.listUserIdentities.mockResolvedValue([identity('google'), identity('telegram_oidc')])

    const center = await getTaskCenter({} as never, 'BG-10001', 'PHP')
    const card = center.groups.newbie.find((item) => item.id === 'profile_complete')

    expect(card?.status).toBe('claimable')
    expect(card?.progress).toEqual({ current: 2, target: 2 })
  })

  it('Place 5 Bets Today 按正数投注笔数展示进度', async () => {
    setupPool({ betCount: 4 })

    const center = await getTaskCenter({} as never, 'BG-10001', 'PHP')
    const card = center.groups.daily.find((item) => item.id === 'daily_bets')

    expect(card?.status).toBe('locked')
    expect(card?.progress).toEqual({ current: 4, target: 5 })
  })

  it('存款任务未领取时只展示当前最高可领档', async () => {
    setupPool({ depositTotal: 1000 })

    const center = await getTaskCenter({} as never, 'BG-10001', 'PHP')
    const depositCards = center.groups.daily.filter((item) => item.id.startsWith('daily_deposit_t'))

    expect(depositCards).toHaveLength(1)
    expect(depositCards[0].id).toBe('daily_deposit_t2')
    expect(depositCards[0].status).toBe('claimable')
  })

  it('存款任务同日同币种已领一档后不能再领另一档', async () => {
    setupPool({ depositTotal: 1000 })
    state.conn.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM bg_task_claim')) return Promise.resolve([[{ ok: 1 }]])
      return Promise.resolve([[]])
    })

    await expect(claimTask({} as never, 'BG-10001', 'daily_deposit_t2', 'PHP'))
      .rejects.toThrow('already claimed')
    expect(state.conn.execute).not.toHaveBeenCalled()
    expect(state.creditWallet).not.toHaveBeenCalled()
  })
})
