/**
 * 风控管控点集成测试（需真实 MySQL）。
 * 用法：RISK_TEST_MYSQL_URL=mysql://root:test@127.0.0.1:13399/betogo npx vitest run risk.integration
 * 未设该变量时整体跳过，避免 CI 因缺少 DB 失败。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mysql, { type Pool } from 'mysql2/promise'
import { evaluateWithPool } from '../services/risk.service.js'

const url = process.env.RISK_TEST_MYSQL_URL
let pool: Pool

const DDL = [
  `CREATE TABLE IF NOT EXISTS bg_risk_blacklist (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     type ENUM('ip','device','region','user') NOT NULL,
     value VARCHAR(128) NOT NULL, reason VARCHAR(255) NULL,
     created_by VARCHAR(64) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     PRIMARY KEY (id), UNIQUE KEY uniq_type_value (type, value))`,
  `CREATE TABLE IF NOT EXISTS bg_risk_policy (
     checkpoint VARCHAR(32) NOT NULL, rule_code VARCHAR(48) NOT NULL,
     action ENUM('tag_only','limit','deny','escalate') NOT NULL DEFAULT 'tag_only',
     enabled TINYINT(1) NOT NULL DEFAULT 1, params JSON NULL,
     updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     PRIMARY KEY (checkpoint, rule_code))`,
  `CREATE TABLE IF NOT EXISTS bg_user_risk_signal (
     user_id VARCHAR(32) NOT NULL, bonus_total DECIMAL(18,2) NOT NULL DEFAULT 0,
     net_deposit DECIMAL(18,2) NOT NULL DEFAULT 0, bonus_ratio DECIMAL(10,4) NOT NULL DEFAULT 0,
     withdraw_count INT NOT NULL DEFAULT 0, device_shared_users INT NOT NULL DEFAULT 1,
     ip_shared_users INT NOT NULL DEFAULT 1, risk_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
     signals JSON NULL, computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     PRIMARY KEY (user_id))`,
  `CREATE TABLE IF NOT EXISTS bg_risk_hit_log (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id VARCHAR(32) NULL,
     checkpoint VARCHAR(32) NOT NULL, rule_code VARCHAR(48) NOT NULL,
     action ENUM('tag_only','limit','deny','escalate') NOT NULL,
     matched_value VARCHAR(128) NULL, detail JSON NULL,
     ip VARCHAR(64) NULL, device_id VARCHAR(128) NULL,
     created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (id))`,
]

async function hitCount(): Promise<number> {
  const [rows] = await pool.query<never[]>('SELECT COUNT(*) c FROM bg_risk_hit_log')
  return Number((rows as unknown as Array<{ c: number }>)[0].c)
}

describe.skipIf(!url)('风控管控点 evaluateWithPool', () => {
  beforeAll(async () => {
    pool = mysql.createPool(url!)
    for (const ddl of DDL) await pool.query(ddl)
  })
  afterAll(async () => { await pool?.end() })

  beforeEach(async () => {
    for (const t of ['bg_risk_blacklist', 'bg_risk_policy', 'bg_user_risk_signal', 'bg_risk_hit_log']) {
      await pool.query(`DELETE FROM ${t}`)
    }
  })

  it('无任何策略 → pass（风控默认不干预）', async () => {
    const d = await evaluateWithPool(pool, { checkpoint: 'login', userId: 'U1', ip: '1.2.3.4' })
    expect(d.action).toBe('pass')
    expect(await hitCount()).toBe(0)
  })

  it('IP 在名单且策略为 deny → deny，并落命中日志', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('ip','6.6.6.6')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('login','blacklist_ip','deny',1,NULL,NOW(3))")

    const d = await evaluateWithPool(pool, { checkpoint: 'login', userId: 'U1', ip: '6.6.6.6' })
    expect(d.action).toBe('deny')
    expect(d.ruleCode).toBe('blacklist_ip')
    expect(await hitCount()).toBe(1)
  })

  it('IP 不在名单 → pass，不落日志', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('ip','6.6.6.6')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('login','blacklist_ip','deny',1,NULL,NOW(3))")

    const d = await evaluateWithPool(pool, { checkpoint: 'login', userId: 'U1', ip: '9.9.9.9' })
    expect(d.action).toBe('pass')
    expect(await hitCount()).toBe(0)
  })

  it('策略 enabled=0 → 名单命中也不生效', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('user','U1')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('login','blacklist_user','deny',0,NULL,NOW(3))")

    const d = await evaluateWithPool(pool, { checkpoint: 'login', userId: 'U1' })
    expect(d.action).toBe('pass')
  })

  it('影子模式：tag_only 命中不阻断，但必须落日志（否则无法评估误报率）', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('device','dev-x')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('promo_claim','blacklist_device','tag_only',1,NULL,NOW(3))")

    const d = await evaluateWithPool(pool, { checkpoint: 'promo_claim', userId: 'U1', deviceId: 'dev-x' })
    expect(d.action).toBe('pass')
    expect(await hitCount()).toBe(1)
  })

  it('多规则同时命中 → 取严重度最高（deny > escalate）', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('ip','6.6.6.6'),('user','U1')")
    await pool.query(`INSERT INTO bg_risk_policy VALUES
      ('withdraw','blacklist_ip','escalate',1,NULL,NOW(3)),
      ('withdraw','blacklist_user','deny',1,NULL,NOW(3))`)

    const d = await evaluateWithPool(pool, { checkpoint: 'withdraw', userId: 'U1', ip: '6.6.6.6' })
    expect(d.action).toBe('deny')
    expect(await hitCount()).toBe(2) // 两条都要留痕
  })

  it('提现名单命中 → escalate（风控交给审核处置，不自己拒付）', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('user','U1')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('withdraw','blacklist_user','escalate',1,NULL,NOW(3))")

    const d = await evaluateWithPool(pool, { checkpoint: 'withdraw', userId: 'U1' })
    expect(d.action).toBe('escalate')
  })

  it('行为规则 bonus_abuse：比值达标且提过现 → 命中', async () => {
    await pool.query("INSERT INTO bg_user_risk_signal (user_id, bonus_ratio, withdraw_count, device_shared_users) VALUES ('U1', 2.0, 1, 1)")
    await pool.query(`INSERT INTO bg_risk_policy VALUES ('promo_claim','bonus_abuse','deny',1,'{"minRatio":1.5,"minWithdrawCount":1}',NOW(3))`)

    const d = await evaluateWithPool(pool, { checkpoint: 'promo_claim', userId: 'U1' })
    expect(d.action).toBe('deny')
  })

  it('行为规则 bonus_abuse：比值达标但未提现 → 不命中', async () => {
    await pool.query("INSERT INTO bg_user_risk_signal (user_id, bonus_ratio, withdraw_count, device_shared_users) VALUES ('U1', 9999, 0, 1)")
    await pool.query(`INSERT INTO bg_risk_policy VALUES ('promo_claim','bonus_abuse','deny',1,'{"minRatio":1.5,"minWithdrawCount":1}',NOW(3))`)

    const d = await evaluateWithPool(pool, { checkpoint: 'promo_claim', userId: 'U1' })
    expect(d.action).toBe('pass')
  })

  it('无画像记录的新用户 → 行为规则跳过，pass', async () => {
    await pool.query(`INSERT INTO bg_risk_policy VALUES ('promo_claim','bonus_abuse','deny',1,'{"minRatio":1.5}',NOW(3))`)
    const d = await evaluateWithPool(pool, { checkpoint: 'promo_claim', userId: 'brand-new' })
    expect(d.action).toBe('pass')
  })

  it('firstdep 场景：只有 userId 没有 ip/device → IP 名单规则不误命中', async () => {
    await pool.query("INSERT INTO bg_risk_blacklist (type, value) VALUES ('ip','6.6.6.6')")
    await pool.query("INSERT INTO bg_risk_policy VALUES ('promo_claim','blacklist_ip','deny',1,NULL,NOW(3))")

    const d = await evaluateWithPool(pool, { checkpoint: 'promo_claim', userId: 'U1' })
    expect(d.action).toBe('pass')
  })

  it('引擎异常（表被删）→ pass，风控绝不阻断主链路', async () => {
    await pool.query('DROP TABLE bg_risk_policy')
    const d = await evaluateWithPool(pool, { checkpoint: 'login', userId: 'U1', ip: '6.6.6.6' })
    expect(d.action).toBe('pass')
    await pool.query(DDL[1]) // 复原，避免影响后续用例
  })

  it('连接池已销毁 → pass（风控不可用时不能拖垮主链路）', async () => {
    const dead = mysql.createPool(url!)
    await dead.end()
    const d = await evaluateWithPool(dead, { checkpoint: 'login', userId: 'U1', ip: '6.6.6.6' })
    expect(d.action).toBe('pass')
  })
})

// evaluateCheckpoint 拿不到 pool 时也必须放行——这条不需要真实 DB，故不在 skipIf 内
describe('风控降级：MySQL 未启用', () => {
  it('isMysqlEnabled=false → pass', async () => {
    const { evaluateCheckpoint } = await import('../services/risk.service.js')
    const env = { BFF_STORAGE: 'redis' } as never
    const d = await evaluateCheckpoint(env, { checkpoint: 'login', userId: 'U1' })
    expect(d.action).toBe('pass')
  })
})
