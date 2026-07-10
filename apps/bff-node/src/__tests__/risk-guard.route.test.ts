/**
 * 风控闸门在路由层的端到端行为：名单命中时用户必须真的收到 403，而不只是 service 返回 deny。
 * 需真实 MySQL：RISK_TEST_MYSQL_URL=mysql://root:test@127.0.0.1:13400/betogo
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import request from 'supertest'
import mysql, { type Pool } from 'mysql2/promise'

vi.mock('../services/store.js', () => ({
  getUser: vi.fn(), saveUser: vi.fn(), creditWallet: vi.fn(), listLedger: vi.fn(), getKyc: vi.fn(),
}))
vi.mock('../services/promo-config.service.js', () => ({ getPromoConfig: vi.fn() }))

import promotionRouter from '../routes/promotion.routes.js'

const url = process.env.RISK_TEST_MYSQL_URL
let pool: Pool

function createApp(userId = 'BG-RISK-1') {
  const app = new Koa()
  app.use(bodyParser())
  app.use(async (ctx, next) => {
    ctx.state.userId = userId
    ctx.state.redis = {} as never
    ctx.state.env = {} as never
    ctx.state.traceId = 'test-trace'
    await next()
  })
  app.use(promotionRouter.routes())
  app.use(promotionRouter.allowedMethods())
  return app.callback()
}

describe.skipIf(!url)('风控闸门 · 路由层', () => {
  beforeAll(async () => {
    const u = new URL(url!)
    // 独立库：与 risk.integration.test.ts 并行跑时不会互相 DELETE 同一批表
    const DB = 'betogo_risk_route'
    const admin = mysql.createPool({ host: u.hostname, port: Number(u.port), user: u.username, password: u.password })
    await admin.query(`CREATE DATABASE IF NOT EXISTS ${DB}`)
    await admin.end()

    // getMysqlPool 走 process.env 且 lazy 建池，故在首个请求前设好即可
    process.env.BFF_STORAGE = 'mysql'
    process.env.MYSQL_HOST = u.hostname
    process.env.MYSQL_PORT = u.port
    process.env.MYSQL_USER = u.username
    process.env.MYSQL_PASSWORD = u.password
    process.env.MYSQL_DATABASE = DB

    pool = mysql.createPool({ host: u.hostname, port: Number(u.port), user: u.username, password: u.password, database: DB })
    await pool.query(`CREATE TABLE IF NOT EXISTS bg_risk_blacklist (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, type ENUM('ip','device','region','user') NOT NULL,
      value VARCHAR(128) NOT NULL, reason VARCHAR(255) NULL, created_by VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id), UNIQUE KEY uniq_type_value (type, value))`)
    await pool.query(`CREATE TABLE IF NOT EXISTS bg_risk_policy (
      checkpoint VARCHAR(32) NOT NULL, rule_code VARCHAR(48) NOT NULL,
      action ENUM('tag_only','limit','deny','escalate') NOT NULL DEFAULT 'tag_only',
      enabled TINYINT(1) NOT NULL DEFAULT 1, params JSON NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (checkpoint, rule_code))`)
    await pool.query(`CREATE TABLE IF NOT EXISTS bg_risk_hit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id VARCHAR(32) NULL,
      checkpoint VARCHAR(32) NOT NULL, rule_code VARCHAR(48) NOT NULL,
      action ENUM('tag_only','limit','deny','escalate') NOT NULL,
      matched_value VARCHAR(128) NULL, detail JSON NULL, ip VARCHAR(64) NULL,
      device_id VARCHAR(128) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id))`)
  })
  afterAll(async () => { await pool?.end() })

  beforeEach(async () => {
    for (const t of ['bg_risk_blacklist', 'bg_risk_policy', 'bg_risk_hit_log']) await pool.query(`DELETE FROM ${t}`)
  })

  it('用户在名单 + 策略 deny → 领取接口返回 403 risk_denied', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('user','BG-RISK-1')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('promo_claim','blacklist_user','deny',1,NULL,NOW(3))")

    const res = await request(createApp()).post('/promotions/trial-play/claim')
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('risk_denied')

    const [rows] = await pool.query<never[]>("SELECT action FROM bg_risk_hit_log WHERE user_id='BG-RISK-1'")
    expect(rows.length).toBe(1)
  })

  it('影子模式（tag_only）→ 不返回 403，闸门放行给后续业务逻辑', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('user','BG-RISK-1')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('promo_claim','blacklist_user','tag_only',1,NULL,NOW(3))")

    const res = await request(createApp()).post('/promotions/trial-play/claim')
    expect(res.status).not.toBe(403)

    const [rows] = await pool.query<never[]>("SELECT action FROM bg_risk_hit_log WHERE user_id='BG-RISK-1'")
    expect(rows.length).toBe(1) // 仍需留痕
  })

  it('不在名单的用户 → 闸门放行', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('user','SOMEONE-ELSE')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('promo_claim','blacklist_user','deny',1,NULL,NOW(3))")

    const res = await request(createApp()).post('/promotions/trial-play/claim')
    expect(res.status).not.toBe(403)
  })
})
