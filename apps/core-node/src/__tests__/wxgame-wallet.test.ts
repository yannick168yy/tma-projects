import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyInstance, FastifyRequest } from 'fastify'

process.env.NODE_ENV = 'test'
process.env.WXGAME_ACCESS_KEY_SECRET = 'test-secret'
process.env.WXGAME_ALLOWED_IPS = '203.0.113.9'

const { wxgameSign } = await import('../clients/wxgame.client.js')
const { WxgameWalletService, WX } = await import('../services/wxgame-wallet.service.js')

function signedReq(over: { nonce?: string; timestamp?: number; sign?: string; ip?: string } = {}) {
  const nonce = over.nonce ?? Math.random().toString(36).slice(2)
  const timestamp = over.timestamp ?? Math.floor(Date.now() / 1000)
  return {
    ip: '127.0.0.1',
    headers: {
      'x-real-ip': over.ip ?? '203.0.113.9',
      accesskeyid: 'test-id',
      nonce,
      timestamp: String(timestamp),
      sign: over.sign ?? wxgameSign('test-secret', nonce, timestamp),
    },
  } as unknown as FastifyRequest
}

// Redis 替身：只实现用到的 set(NX) / getdel 两个语义
function fakeRedis(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  return {
    async set(key: string, value: string, _ex: string, _ttl: number, nx?: string) {
      if (nx === 'NX' && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    },
    async getdel(key: string) {
      const v = store.get(key) ?? null
      store.delete(key)
      return v
    },
    store,
  }
}

function makeApp(over: { redis?: unknown; player?: Record<string, unknown> | null; balance?: number } = {}) {
  const player = over.player === undefined
    ? { user_id: 'BG-10025', external_username: 'BG10025', currency: 'PHP', status: 'active' }
    : over.player
  const conn = {
    async execute() { return [{}, undefined] },
    async query(sql: string) {
      if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: over.balance ?? 1234.5 }], undefined]
      return [[], undefined]
    },
    release() {},
  }
  return {
    mysql: {
      async query(sql: string) {
        if (sql.includes('bg_aggregator_player')) return [[player].filter(Boolean), undefined]
        return [[], undefined]
      },
      async getConnection() { return conn },
    },
    redis: over.redis ?? fakeRedis(),
    log: { error() {}, warn() {}, info() {} },
  } as unknown as FastifyInstance
}

describe('WXGame 回调门禁', () => {
  it('IP 不在白名单直接拒', async () => {
    const res = await new WxgameWalletService(makeApp()).balance(signedReq({ ip: '198.51.100.1' }), { playerId: 'BG10025' })
    assert.equal(res.code, WX.BAD_IP)
  })

  it('签名不匹配拒绝', async () => {
    const res = await new WxgameWalletService(makeApp()).balance(signedReq({ sign: 'deadbeef' }), { playerId: 'BG10025' })
    assert.equal(res.code, WX.BAD_SIGN)
  })

  it('时间戳超出 60 秒窗口拒绝', async () => {
    const old = Math.floor(Date.now() / 1000) - 120
    const res = await new WxgameWalletService(makeApp()).balance(signedReq({ timestamp: old }), { playerId: 'BG10025' })
    assert.equal(res.code, WX.BAD_SIGN)
  })

  // 上游签名式子不含 body，同一组 Nonce+Timestamp 的 Sign 能配任意请求体复用。
  // 这条测的就是「换个 body 原样重放」必须被挡住。
  it('同一 Nonce 重放被拒，即使签名合法', async () => {
    const app = makeApp()
    const svc = new WxgameWalletService(app)
    const req = signedReq({ nonce: 'fixed-nonce' })

    const first = await svc.balance(req, { playerId: 'BG10025' })
    assert.equal(first.code, WX.OK)

    const replay = await svc.balance(req, { playerId: 'BG10025', amount: 999999 })
    assert.equal(replay.code, WX.BAD_SIGN)
    assert.equal(replay.msg, 'Duplicated nonce')
  })
})

describe('WXGame verify', () => {
  const payload = {
    userId: 'BG-10025', playerId: 'BG10025', currency: 'PHP',
    gameBrand: 'jili', gameId: '171',
  }

  it('用有效 token 换回玩家信息与余额', async () => {
    const redis = fakeRedis({ 'wxgame:launch:tok1': JSON.stringify(payload) })
    const res = await new WxgameWalletService(makeApp({ redis, balance: 8888 }))
      .verify(signedReq(), { token: 'tok1', gameId: '171' })
    assert.equal(res.code, WX.OK)
    assert.deepEqual(res.data, { playerId: 'BG10025', balance: 8888, currency: 'PHP' })
  })

  it('token 只能用一次，重放返回 1006', async () => {
    const redis = fakeRedis({ 'wxgame:launch:tok1': JSON.stringify(payload) })
    const svc = new WxgameWalletService(makeApp({ redis }))
    assert.equal((await svc.verify(signedReq(), { token: 'tok1', gameId: '171' })).code, WX.OK)
    assert.equal((await svc.verify(signedReq(), { token: 'tok1', gameId: '171' })).code, WX.BAD_TOKEN)
  })

  it('gameId 与签发时绑定的不一致时拒绝，防止拿 A 游戏 token 起 B 游戏', async () => {
    const redis = fakeRedis({ 'wxgame:launch:tok1': JSON.stringify(payload) })
    const res = await new WxgameWalletService(makeApp({ redis }))
      .verify(signedReq(), { token: 'tok1', gameId: '999' })
    assert.equal(res.code, WX.BAD_TOKEN)
  })

  it('不存在的 token 返回 1006', async () => {
    const res = await new WxgameWalletService(makeApp({ redis: fakeRedis() }))
      .verify(signedReq(), { token: 'nope', gameId: '171' })
    assert.equal(res.code, WX.BAD_TOKEN)
  })
})

describe('WXGame balance', () => {
  it('返回余额与币种', async () => {
    const res = await new WxgameWalletService(makeApp({ balance: 500.25 })).balance(signedReq(), { playerId: 'BG10025' })
    assert.equal(res.code, WX.OK)
    assert.deepEqual(res.data, { balance: 500.25, currency: 'PHP' })
  })

  it('玩家不存在返回 1012', async () => {
    const res = await new WxgameWalletService(makeApp({ player: null })).balance(signedReq(), { playerId: 'ghost' })
    assert.equal(res.code, WX.NO_PLAYER)
  })
})
