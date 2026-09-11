import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { ensureWxgamePlayer, toWxgamePlayerId } from '../services/wxgame-player.service.js'

function fakeApp(mapped?: { external_username: string; currency: string }) {
  const calls: { sql: string; params: unknown[] }[] = []
  return {
    app: {
      mysql: {
        async query(sql: string, params: unknown[] = []) {
          calls.push({ sql, params })
          if (sql.includes('SELECT external_username')) return [[mapped].filter(Boolean), undefined]
          if (sql.includes('SELECT user_id')) return [[], undefined]
          return [{ affectedRows: 1 }, undefined]
        },
      },
    } as unknown as FastifyInstance,
    calls,
  }
}

describe('WXGame 多币种玩家映射', () => {
  it('PHP 和 IDR 使用不同的上游玩家 ID', async () => {
    const php = fakeApp()
    const idr = fakeApp()
    const phpPlayer = await ensureWxgamePlayer(php.app, 'BG-10025', 'PHP')
    const idrPlayer = await ensureWxgamePlayer(idr.app, 'BG-10025', 'IDR')

    assert.equal(phpPlayer.playerId, 'BG10025')
    assert.equal(idrPlayer.playerId, 'BG10025IDR')
    assert.notEqual(phpPlayer.playerId, idrPlayer.playerId)
    assert.equal(idr.calls.find((c) => c.sql.includes('INSERT INTO'))?.params[3], 'IDR')
  })

  it('查找已有映射时必须同时匹配币种', async () => {
    const { app, calls } = fakeApp({ external_username: 'BG10025IDR', currency: 'IDR' })
    const player = await ensureWxgamePlayer(app, 'BG-10025', 'idr')

    assert.equal(player.playerId, 'BG10025IDR')
    assert.deepEqual(calls[0].params, ['wxgame', 'BG-10025', 'IDR'])
    assert.match(calls[0].sql, /currency = \?/)
  })

  it('不会为未开放币种创建玩家', async () => {
    const { app, calls } = fakeApp()
    await assert.rejects(() => ensureWxgamePlayer(app, 'BG-10025', 'USDT'), /not supported/)
    assert.equal(calls.length, 0)
  })

  it('清理用户 ID 后仍只包含字母数字', () => {
    assert.equal(toWxgamePlayerId('BG_10-025'), 'BG10025')
  })
})
