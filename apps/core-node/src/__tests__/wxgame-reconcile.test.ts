import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'

process.env.NODE_ENV = 'test'
process.env.WXGAME_ACCESS_KEY_ID = 'id'
process.env.WXGAME_ACCESS_KEY_SECRET = 'secret'

const { reconcileWxgame } = await import('../services/wxgame-reconcile.service.js')

type Diff = { roundId: string; type: string; upBet: unknown; upWin: unknown; locBet: unknown; locWin: unknown }

// 用一页上游记录 + 一组本地局，跑一轮对账，收集写入的差异
function makeApp(upstream: unknown[], localRounds: Array<{ round_id: string; user_id: string; bet_amount: number; win_amount: number }>) {
  const diffs: Diff[] = []
  let cursorSaved: unknown = null
  const app = {
    mysql: {
      async query(sql: string, params: unknown[] = []) {
        if (sql.includes('FROM bg_wxgame_recon_cursor')) return [[{ next_time_utc: null, next_id: null }], undefined]
        if (sql.includes('INSERT INTO bg_wxgame_recon_cursor')) { cursorSaved = params; return [{}, undefined] }
        if (sql.includes('FROM bg_bet_round')) return [localRounds, undefined]
        if (sql.includes('INSERT INTO bg_wxgame_recon_diff')) {
          diffs.push({ roundId: String(params[0]), type: String(params[4]), upBet: params[5], upWin: params[6], locBet: params[8], locWin: params[9] })
          return [{}, undefined]
        }
        return [[], undefined]
      },
    },
    log: { error() {}, warn() {}, info() {} },
  } as unknown as FastifyInstance

  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    json: async () => ({ code: 0, data: { list: upstream, pageToken: Buffer.from(JSON.stringify({ nextID: 9, nextTimeAtUTC: 1788800000, pageSize: 500 })).toString('base64') } }),
  })) as unknown as typeof fetch
  return { app, diffs, restore: () => { globalThis.fetch = realFetch }, cursor: () => cursorSaved }
}

const up = (o: Record<string, unknown>) => ({
  roundId: 'r1', transactionId: 't1', playerId: 'BG1', bet: 100, win: 0, status: 'SETTLED', ...o,
})

describe('WXGame 对账', () => {
  it('上游有、本地没有 → missing_local（掉单，最要抓的一类）', async () => {
    const t = makeApp([up({ roundId: 'r-lost' })], [])
    try {
      const r = await reconcileWxgame(t.app)
      assert.equal(r.diffs, 1)
      assert.equal(t.diffs[0].type, 'missing_local')
      assert.equal(t.diffs[0].roundId, 'r-lost')
    } finally { t.restore() }
  })

  it('INIT / BET 状态不算掉单（上游只是还没结算完）', async () => {
    for (const status of ['INIT', 'BET']) {
      const t = makeApp([up({ roundId: `r-${status}`, status })], [])
      try {
        assert.equal((await reconcileWxgame(t.app)).diffs, 0, status)
      } finally { t.restore() }
    }
  })

  it('金额对不上 → amount_mismatch，且带上双方数值', async () => {
    const t = makeApp(
      [up({ roundId: 'r2', bet: 100, win: 50 })],
      [{ round_id: 'r2', user_id: 'BG-1', bet_amount: 100, win_amount: 30 }],
    )
    try {
      await reconcileWxgame(t.app)
      assert.equal(t.diffs.length, 1)
      assert.equal(t.diffs[0].type, 'amount_mismatch')
      assert.equal(t.diffs[0].upWin, 50)
      assert.equal(t.diffs[0].locWin, 30)
    } finally { t.restore() }
  })

  it('金额一致不报差异', async () => {
    const t = makeApp(
      [up({ roundId: 'r3', bet: 100, win: 250 })],
      [{ round_id: 'r3', user_id: 'BG-1', bet_amount: 100, win_amount: 250 }],
    )
    try { assert.equal((await reconcileWxgame(t.app)).diffs, 0) } finally { t.restore() }
  })

  // 浮点：0.1+0.2 这类累加误差不该被当成资损差异
  it('一分以内的差额忽略', async () => {
    const t = makeApp(
      [up({ roundId: 'r4', bet: 0.3, win: 0 })],
      [{ round_id: 'r4', user_id: 'BG-1', bet_amount: 0.1 + 0.2, win_amount: 0 }],
    )
    try { assert.equal((await reconcileWxgame(t.app)).diffs, 0) } finally { t.restore() }
  })

  // 撤销局我方是 bet + refund 两行，汇总后 win_amount 含退款额，与上游 bet/win 口径不同
  it('CANCELED 局跳过金额比对', async () => {
    const t = makeApp(
      [up({ roundId: 'r5', bet: 100, win: 0, status: 'CANCELED' })],
      [{ round_id: 'r5', user_id: 'BG-1', bet_amount: 100, win_amount: 100 }],
    )
    try { assert.equal((await reconcileWxgame(t.app)).diffs, 0) } finally { t.restore() }
  })

  // 实测：上游无数据时连 list 字段都不返回，默认成数组会直接 TypeError
  it('上游不返回 list 字段时不崩', async () => {
    const t = makeApp([], [])
    globalThis.fetch = (async () => ({ json: async () => ({ code: 0, data: {} }) })) as unknown as typeof fetch
    try {
      const r = await reconcileWxgame(t.app)
      assert.equal(r.scanned, 0)
      assert.equal(r.diffs, 0)
    } finally { t.restore() }
  })
})
