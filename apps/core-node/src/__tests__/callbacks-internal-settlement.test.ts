import { createCipheriv, createDecipheriv, createHash, createSign, createVerify, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, constants } from 'node:crypto'
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

const platformKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const merchantKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const platformPrivatePem = platformKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const platformPublicPem = platformKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const merchantPrivatePem = merchantKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const merchantPublicPem = merchantKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

process.env.NODE_ENV = 'test'
process.env.INTERNAL_TOKEN = 'internal-test-token'
process.env.NATS_CALLBACK_SUBJECT = 'betogo.callback.test'
process.env.YFPAY_API_KEY = 'yfpay-secret'
process.env.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY = merchantPrivatePem
process.env.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY = platformPublicPem

type QueryResult = [unknown[], unknown?]
type ExecuteResult = [unknown, unknown?]

interface FakeConn {
  queries: Array<{ sql: string; params?: unknown[] }>
  executes: Array<{ sql: string; params?: unknown[] }>
  beginTransaction: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  release: () => void
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>
  execute: (sql: string, params?: unknown[]) => Promise<ExecuteResult>
  committed: boolean
  rolledBack: boolean
  released: boolean
}

interface FakePool {
  queries: Array<{ sql: string; params?: unknown[] }>
  executes: Array<{ sql: string; params?: unknown[] }>
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>
  execute: (sql: string, params?: unknown[]) => Promise<ExecuteResult>
  getConnection: () => Promise<FakeConn>
  conn: FakeConn
}

function createConn(opts: {
  query?: (sql: string, params?: unknown[]) => QueryResult
  execute?: (sql: string, params?: unknown[]) => ExecuteResult
} = {}): FakeConn {
  const conn: FakeConn = {
    queries: [] as Array<{ sql: string; params?: unknown[] }>,
    executes: [] as Array<{ sql: string; params?: unknown[] }>,
    committed: false,
    rolledBack: false,
    released: false,
    async beginTransaction() {},
    async commit() { conn.committed = true },
    async rollback() { conn.rolledBack = true },
    release() { conn.released = true },
    async query(sql: string, params?: unknown[]) {
      conn.queries.push({ sql, params })
      return opts.query?.(sql, params) ?? [[]]
    },
    async execute(sql: string, params?: unknown[]) {
      conn.executes.push({ sql, params })
      return opts.execute?.(sql, params) ?? [{}]
    },
  }
  return conn
}

function createPool(opts: {
  query?: (sql: string, params?: unknown[]) => QueryResult
  execute?: (sql: string, params?: unknown[]) => ExecuteResult
  conn?: FakeConn
} = {}): FakePool {
  const conn = opts.conn ?? createConn()
  const pool: FakePool = {
    queries: [] as Array<{ sql: string; params?: unknown[] }>,
    executes: [] as Array<{ sql: string; params?: unknown[] }>,
    conn,
    async query(sql: string, params?: unknown[]) {
      pool.queries.push({ sql, params })
      return opts.query?.(sql, params) ?? [[]]
    },
    async execute(sql: string, params?: unknown[]) {
      pool.executes.push({ sql, params })
      return opts.execute?.(sql, params) ?? [[]]
    },
    async getConnection() {
      return conn
    },
  }
  return pool
}

function createRedis(setResult: string | null = 'OK') {
  return {
    setCalls: [] as unknown[][],
    getCalls: [] as string[],
    async set(...args: unknown[]) {
      this.setCalls.push(args)
      return setResult
    },
    async get(key: string) {
      this.getCalls.push(key)
      return null
    },
  }
}

async function createApp(opts: { mysql?: FakePool; redis?: ReturnType<typeof createRedis>; js?: { publish: (subject: string, payload: string) => Promise<void> } } = {}) {
  const { internalRoutes } = await import('../routes/internal.routes.js')
  const { callbackRoutes } = await import('../routes/callback.routes.js')
  const app = Fastify({ logger: false })
  app.decorate('mysql', (opts.mysql ?? createPool()) as never)
  app.decorate('redis', (opts.redis ?? createRedis()) as never)
  app.decorate('js', (opts.js ?? { async publish() {} }) as never)
  await app.register(callbackRoutes, { prefix: '/api/v1' })
  await app.register(internalRoutes)
  return app
}

function yfpaySign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHash('md5').update(`${sorted}&key=${apiKey}`).digest('hex').toUpperCase()
}

function matrixRequestEnvelope(bizData: unknown) {
  const aesKey = randomBytes(32)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(bizData), 'utf8'), cipher.final()])
  const encrypted = Buffer.concat([body, cipher.getAuthTag()])
  const data = encrypted.toString('base64')
  const key = publicEncrypt(
    { key: merchantPublicPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.concat([aesKey, iv]),
  ).toString('base64')
  const timestamp = String(Date.now())
  const signer = createSign('SHA256')
  signer.update(`data=${data}&key=${key}&timestamp=${timestamp}`)
  const sig = signer.sign(platformPrivatePem).toString('base64')
  return { timestamp, data, key, sig, rsaType: 'ECB_OAEP', aesType: 'GCM_NOPADDING' }
}

function parseMatrixResponse(envelope: { data: string; key: string; timestamp: string; sig: string }) {
  const verifier = createVerify('SHA256')
  verifier.update(`data=${envelope.data}&key=${envelope.key}&timestamp=${envelope.timestamp}`)
  assert.equal(verifier.verify(merchantKeys.publicKey, envelope.sig, 'base64'), true)
  const keyMaterial = privateDecrypt(
    { key: platformPrivatePem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(envelope.key, 'base64'),
  )
  const aesKey = keyMaterial.subarray(0, 32)
  const iv = keyMaterial.subarray(32, 48)
  const ciphertextWithTag = Buffer.from(envelope.data, 'base64')
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16)
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as Record<string, unknown>
}

describe('内部支付入账接口', () => {
  it('拒绝缺少内部 token 的请求', async () => {
    const app = await createApp()
    const res = await app.inject({
      method: 'POST',
      url: '/internal/payment/tg-wallet',
      payload: { orderId: 'D1', userId: 'U1', creditedCents: 100 },
    })

    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.json(), { error: 'Unauthorized' })
  })

  it('TG Wallet 入账成功时写钱包、ledger、订单状态并提交事务', async () => {
    const conn = createConn({
      query(sql) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: 1000 }]]
        return [[]]
      },
    })
    const pool = createPool({
      conn,
      query(sql) {
        if (sql.includes('SELECT status FROM bg_deposit_order')) return [[{ status: 'pending' }]]
        return [[]]
      },
    })
    const redis = createRedis()
    const app = await createApp({ mysql: pool, redis })

    const res = await app.inject({
      method: 'POST',
      url: '/internal/payment/tg-wallet',
      headers: { 'x-internal-token': 'internal-test-token' },
      payload: { orderId: 'D1', userId: 'U1', creditedCents: 1000, currency: 'PHP', description: 'TG paid' },
    })

    assert.equal(res.statusCode, 200)
    assert.equal(res.json().balanceAfter, 1000)
    assert.equal(redis.setCalls[0][0], 'tgwallet:cb:D1')
    assert.equal(conn.committed, true)
    assert.equal(conn.rolledBack, false)
    assert.equal(conn.released, true)
    assert.equal(conn.executes.some((e) => e.sql.includes('INSERT INTO bg_wallet_ledger') && e.params?.[3] === 1000), true)
    assert.equal(conn.executes.some((e) => e.sql.includes("UPDATE bg_deposit_order SET status='paid'")), true)
    assert.equal(conn.executes.some((e) => e.sql.includes('UPDATE bg_team_node')), true)
  })

  it('YFPay 重复回调命中 Redis 幂等锁时不访问数据库', async () => {
    const pool = createPool()
    const app = await createApp({ mysql: pool, redis: createRedis(null) })

    const res = await app.inject({
      method: 'POST',
      url: '/internal/payment/yfpay',
      headers: { 'x-internal-token': 'internal-test-token' },
      payload: { orderId: 'YD1', userId: 'U1', creditedCents: 500 },
    })

    assert.equal(res.statusCode, 200)
    assert.equal(res.json().message, 'duplicate, skipped')
    assert.equal(pool.queries.length, 0)
  })

  it('入账事务中订单更新失败时回滚，不提交部分账变', async () => {
    const conn = createConn({
      query(sql) {
        if (sql.includes('SELECT available FROM bg_wallet')) return [[{ available: 1000 }]]
        return [[]]
      },
      execute(sql) {
        if (sql.includes('UPDATE bg_deposit_order')) throw new Error('update failed')
        return [{}]
      },
    })
    const pool = createPool({
      conn,
      query(sql) {
        if (sql.includes('SELECT status FROM bg_deposit_order')) return [[{ status: 'pending' }]]
        return [[]]
      },
    })
    const app = await createApp({ mysql: pool })

    const res = await app.inject({
      method: 'POST',
      url: '/internal/payment/yfpay',
      headers: { 'x-internal-token': 'internal-test-token' },
      payload: { orderId: 'YD2', userId: 'U1', creditedCents: 500 },
    })

    assert.equal(res.statusCode, 500)
    assert.equal(conn.committed, false)
    assert.equal(conn.rolledBack, true)
    assert.equal(conn.released, true)
  })
})

describe('Matrix 提现反查与通用回调', () => {
  it('Matrix withdraw-check 解密请求后按本地 pending 提现单返回 approved=true', async () => {
    const pool = createPool({
      query(sql, params) {
        assert.equal(sql.includes('FROM bg_withdraw_order'), true)
        assert.deepEqual(params, ['MX-WD-1'])
        return [[{ order_id: 'MX-WD-1' }]]
      },
    })
    const app = await createApp({ mysql: pool })
    const payload = matrixRequestEnvelope({
      merchantOrderNo: 'MX-WD-1',
      amount: 12.5,
      symbol: 'USDT',
      chain: 'TRX',
      toAddress: 'Txxx',
    })

    const res = await app.inject({ method: 'POST', url: '/api/v1/callback/matrix/withdraw-check', payload })

    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.code, 0)
    const biz = parseMatrixResponse(body)
    assert.equal(biz.merchantOrderNo, 'MX-WD-1')
    assert.equal(biz.approved, true)
  })

  it('Matrix withdraw-check 解密或验签失败时返回 400', async () => {
    const app = await createApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/callback/matrix/withdraw-check',
      payload: { timestamp: '1', data: 'bad', key: 'bad', sig: 'bad', rsaType: 'ECB_OAEP', aesType: 'GCM_NOPADDING' },
    })

    assert.equal(res.statusCode, 400)
    assert.equal(res.json().msg, 'decrypt or verify failed')
  })

  it('YFPay 通用回调验签通过后发布 NATS 并返回 success', async () => {
    const published: Array<{ subject: string; payload: string }> = []
    const app = await createApp({
      js: {
        async publish(subject, payload) {
          published.push({ subject, payload })
        },
      },
    })
    const payload = { orderNo: 'YF-1', amount: 100 }
    const signed = { ...payload, sign: yfpaySign(payload, 'yfpay-secret') }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/callback/yfpay',
      headers: { 'x-forwarded-for': '103.145.58.175' },
      payload: signed,
    })

    assert.equal(res.statusCode, 200)
    assert.equal(res.body, 'success')
    assert.equal(published.length, 1)
    assert.equal(published[0].subject, 'betogo.callback.test')
    assert.equal(JSON.parse(published[0].payload).provider, 'yfpay')
  })

  it('YFPay 通用回调拒绝非白名单 IP', async () => {
    const published: Array<{ subject: string; payload: string }> = []
    const app = await createApp({
      js: {
        async publish(subject, payload) {
          published.push({ subject, payload })
        },
      },
    })
    const payload = { orderNo: 'YF-1', amount: 100 }
    const signed = { ...payload, sign: yfpaySign(payload, 'yfpay-secret') }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/callback/yfpay',
      headers: { 'x-forwarded-for': '8.8.8.8' },
      payload: signed,
    })

    assert.equal(res.statusCode, 401)
    assert.equal(published.length, 0)
  })
})

describe('团队日结', () => {
  it('已有结算记录且非 force 时直接跳过', async () => {
    const { runDailySettlement } = await import('../routes/internal.routes.js')
    const pool = createPool({
      query(sql) {
        if (sql.includes('SELECT COUNT(*) AS cnt')) return [[{ cnt: 1 }]]
        return [[]]
      },
    })

    await runDailySettlement({ mysql: pool, log: { info() {}, warn() {}, error() {} } } as unknown as FastifyInstance, '2026-06-28', false)

    assert.equal(pool.executes.length, 0)
  })

  it('按投注流水生成三层佣金并入账团队钱包', async () => {
    const { runDailySettlement } = await import('../routes/internal.routes.js')
    let versionReads = 0
    const pool = createPool({
      query(sql) {
        if (sql.includes('SELECT COUNT(*) AS cnt')) return [[{ cnt: 0 }]]
        if (sql.includes('FROM bg_bet_order')) return [[{ user_id: 'U1', currency_code: 'PHP', bet_cents: 10000 }]]
        if (sql.includes('FROM bg_team_rate_plan')) return [[{ l1_rate_pct: 10, l2_rate_pct: 5, l3_rate_pct: 2 }]]
        if (sql.includes('FROM bg_team_node')) {
          return [[{
            user_id: 'U1',
            l1_referrer_id: 'A1',
            l2_referrer_id: 'A2',
            l3_referrer_id: null,
            l1_rate_pct: 10,
            l2_rate_pct: 5,
            l3_rate_pct: 2,
          }]]
        }
        if (sql.includes('max_commission_per_settlement_cents')) return [[{ max_commission_per_settlement_cents: null }]]
        if (sql.includes('SUM(php_equivalent_cents)')) return [[{ beneficiary_id: 'A1', total_php: 1000 }, { beneficiary_id: 'A2', total_php: 500 }]]
        if (sql.includes('SELECT version FROM bg_team_wallet')) {
          versionReads += 1
          return [[{ version: versionReads }]]
        }
        return [[]]
      },
      execute(sql) {
        if (sql.includes('UPDATE bg_team_wallet') && sql.includes('version = ?')) return [{ affectedRows: 1 }]
        return [{}]
      },
    })

    await runDailySettlement({ mysql: pool, log: { info() {}, warn() {}, error() {} } } as unknown as FastifyInstance, '2026-06-28', false)

    assert.equal(pool.executes.some((e) => e.sql.includes('INSERT INTO bg_team_turnover_daily') && e.params?.[3] === 10000), true)
    const commissionParams = pool.executes
      .filter((e) => e.sql.includes('INSERT INTO bg_team_commission'))
      .map((e) => e.params)
    assert.equal(commissionParams.length, 2)
    assert.deepEqual(commissionParams[0]?.slice(0, 9), ['A1', 'U1', 1, '2026-06-28', 10000, 10, 1000, 1000, JSON.stringify([{ currency: 'PHP', betCents: 10000, fxRate: 1 }])])
    assert.deepEqual(commissionParams[1]?.slice(0, 9), ['A2', 'U1', 2, '2026-06-28', 10000, 5, 500, 500, JSON.stringify([{ currency: 'PHP', betCents: 10000, fxRate: 1 }])])
    assert.equal(pool.executes.filter((e) => e.sql.includes('INSERT IGNORE INTO bg_team_wallet')).length, 2)
    assert.equal(pool.executes.filter((e) => e.sql.includes('UPDATE bg_team_wallet') && e.sql.includes('available_cents')).length, 2)
    assert.equal(pool.executes.some((e) => e.sql.includes("UPDATE bg_team_commission SET status='paid'")), true)
    assert.equal(pool.executes.some((e) => e.sql.includes('UPDATE bg_team_turnover_daily SET settled=1')), true)
  })
})
