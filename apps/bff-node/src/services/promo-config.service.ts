import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'

export interface FirstDepTier {
  depositAmount: number
  bonusAmount: number
}

/** 首充嘉年华支持的币种（USDC 暂未开通充值通道，先预留配置） */
export const FIRSTDEP_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TON', 'TRX'] as const
export type FirstDepCurrency = (typeof FIRSTDEP_CURRENCIES)[number]

export interface PromoConfig {
  trial:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  referral: { inviterAmount: number; inviteeAmount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  firstdep: { enabled: boolean; turnoverX: number; turnoverDays: number; tiers: Record<string, FirstDepTier[]> }
}

const DEFAULT_FIRSTDEP_TIERS: Record<string, FirstDepTier[]> = {
  PHP: [
    { depositAmount: 20, bonusAmount: 5 }, { depositAmount: 50, bonusAmount: 10 },
    { depositAmount: 100, bonusAmount: 15 }, { depositAmount: 200, bonusAmount: 30 },
    { depositAmount: 500, bonusAmount: 60 }, { depositAmount: 1000, bonusAmount: 70 },
    { depositAmount: 5000, bonusAmount: 100 }, { depositAmount: 10000, bonusAmount: 150 },
    { depositAmount: 50000, bonusAmount: 1000 },
  ],
  USDT: [
    { depositAmount: 1, bonusAmount: 0.2 }, { depositAmount: 5, bonusAmount: 1 },
    { depositAmount: 10, bonusAmount: 2 }, { depositAmount: 50, bonusAmount: 8 },
    { depositAmount: 100, bonusAmount: 15 }, { depositAmount: 500, bonusAmount: 60 },
    { depositAmount: 1000, bonusAmount: 100 },
  ],
  USDC: [
    { depositAmount: 1, bonusAmount: 0.2 }, { depositAmount: 5, bonusAmount: 1 },
    { depositAmount: 10, bonusAmount: 2 }, { depositAmount: 50, bonusAmount: 8 },
    { depositAmount: 100, bonusAmount: 15 }, { depositAmount: 500, bonusAmount: 60 },
    { depositAmount: 1000, bonusAmount: 100 },
  ],
  TON: [
    { depositAmount: 1, bonusAmount: 0.2 }, { depositAmount: 5, bonusAmount: 1 },
    { depositAmount: 10, bonusAmount: 2 }, { depositAmount: 50, bonusAmount: 8 },
    { depositAmount: 100, bonusAmount: 15 },
  ],
  TRX: [
    { depositAmount: 100, bonusAmount: 2 }, { depositAmount: 500, bonusAmount: 10 },
    { depositAmount: 1000, bonusAmount: 20 }, { depositAmount: 5000, bonusAmount: 80 },
    { depositAmount: 10000, bonusAmount: 150 },
  ],
}

export const PROMO_DEFAULTS: PromoConfig = {
  trial:    { amount: 88, enabled: true, turnoverX: 0, turnoverDays: 0 },
  referral: { inviterAmount: 50, inviteeAmount: 30, enabled: true, turnoverX: 0, turnoverDays: 0 },
  firstdep: { enabled: true, turnoverX: 15, turnoverDays: 30, tiers: DEFAULT_FIRSTDEP_TIERS },
}

function num(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? '')
  return isNaN(n) ? fallback : n
}
function bool(v: string | undefined, fallback: boolean): boolean {
  return v != null ? v === '1' : fallback
}

async function loadFirstDepTiers(env: Env): Promise<Record<string, FirstDepTier[]>> {
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT currency, deposit_amount, bonus_amount FROM bg_firstdep_tiers ORDER BY currency, deposit_amount',
  )
  const tiers: Record<string, FirstDepTier[]> = {}
  for (const r of rows) {
    const cur = String(r.currency)
    if (!tiers[cur]) tiers[cur] = []
    tiers[cur].push({ depositAmount: Number(r.deposit_amount), bonusAmount: Number(r.bonus_amount) })
  }
  for (const cur of FIRSTDEP_CURRENCIES) if (!tiers[cur]) tiers[cur] = []
  return tiers
}

export async function getPromoConfig(env: Env): Promise<PromoConfig> {
  if (!isMysqlEnabled(env)) return PROMO_DEFAULTS
  try {
    const pool = getMysqlPool(env)
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT promo_id, config_key, config_value FROM bg_promo_config',
    )
    const map: Record<string, Record<string, string>> = {}
    for (const r of rows) {
      const pid = String(r.promo_id)
      if (!map[pid]) map[pid] = {}
      map[pid][String(r.config_key)] = String(r.config_value)
    }
    const t = map.trial ?? {}
    const r = map.referral ?? {}
    const f = map.firstdep ?? {}
    const D = PROMO_DEFAULTS
    const tiers = await loadFirstDepTiers(env)
    return {
      trial:    { amount: num(t.amount, D.trial.amount), enabled: bool(t.enabled, D.trial.enabled), turnoverX: num(t.turnover_x, D.trial.turnoverX), turnoverDays: num(t.turnover_days, D.trial.turnoverDays) },
      referral: { inviterAmount: num(r.inviter_amount, D.referral.inviterAmount), inviteeAmount: num(r.invitee_amount, D.referral.inviteeAmount), enabled: bool(r.enabled, D.referral.enabled), turnoverX: num(r.turnover_x, D.referral.turnoverX), turnoverDays: num(r.turnover_days, D.referral.turnoverDays) },
      firstdep: { enabled: bool(f.enabled, D.firstdep.enabled), turnoverX: num(f.turnover_x, D.firstdep.turnoverX), turnoverDays: num(f.turnover_days, D.firstdep.turnoverDays), tiers },
    }
  } catch {
    return PROMO_DEFAULTS
  }
}

export async function savePromoConfig(env: Env, config: PromoConfig): Promise<void> {
  const pool = getMysqlPool(env)
  const D = PROMO_DEFAULTS
  const entries: [string, string, string][] = [
    ['trial',    'amount',         String(config.trial.amount            ?? D.trial.amount)],
    ['trial',    'enabled',        config.trial.enabled                  ? '1' : '0'],
    ['trial',    'turnover_x',     String(config.trial.turnoverX         ?? D.trial.turnoverX)],
    ['trial',    'turnover_days',  String(config.trial.turnoverDays      ?? D.trial.turnoverDays)],
    ['referral', 'inviter_amount', String(config.referral.inviterAmount  ?? D.referral.inviterAmount)],
    ['referral', 'invitee_amount', String(config.referral.inviteeAmount  ?? D.referral.inviteeAmount)],
    ['referral', 'enabled',        config.referral.enabled               ? '1' : '0'],
    ['referral', 'turnover_x',     String(config.referral.turnoverX      ?? D.referral.turnoverX)],
    ['referral', 'turnover_days',  String(config.referral.turnoverDays   ?? D.referral.turnoverDays)],
    ['firstdep', 'turnover_x',     String(config.firstdep.turnoverX      ?? D.firstdep.turnoverX)],
    ['firstdep', 'turnover_days',  String(config.firstdep.turnoverDays   ?? D.firstdep.turnoverDays)],
    ['firstdep', 'enabled',        config.firstdep.enabled               ? '1' : '0'],
  ]
  await pool.query(
    `INSERT INTO bg_promo_config (promo_id, config_key, config_value) VALUES ?
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [entries],
  )
  await saveFirstDepTiers(env, config.firstdep.tiers)
}

/** 整表替换各币种档位：按币种清掉旧档位后写入新档位（仅处理传入的币种）。 */
export async function saveFirstDepTiers(env: Env, tiers: Record<string, FirstDepTier[]>): Promise<void> {
  const pool = getMysqlPool(env)
  for (const [currency, list] of Object.entries(tiers)) {
    await pool.execute('DELETE FROM bg_firstdep_tiers WHERE currency = ?', [currency])
    const valid = list.filter((tier) => tier.depositAmount > 0 && tier.bonusAmount >= 0)
    if (valid.length === 0) continue
    const rows = valid.map((tier) => [currency, tier.depositAmount, tier.bonusAmount])
    await pool.query(
      'INSERT INTO bg_firstdep_tiers (currency, deposit_amount, bonus_amount) VALUES ?',
      [rows],
    )
  }
}

/** 充值结算时按 Pool 直接读首充配置（避免在结算链路里再传 env）。 */
export async function getFirstDepConfigByPool(pool: Pool): Promise<PromoConfig['firstdep']> {
  const D = PROMO_DEFAULTS.firstdep
  try {
    const [cfgRows] = await pool.query<RowDataPacket[]>(
      "SELECT config_key, config_value FROM bg_promo_config WHERE promo_id = 'firstdep'",
    )
    const f: Record<string, string> = {}
    for (const r of cfgRows) f[String(r.config_key)] = String(r.config_value)
    const [tierRows] = await pool.query<RowDataPacket[]>(
      'SELECT currency, deposit_amount, bonus_amount FROM bg_firstdep_tiers ORDER BY currency, deposit_amount',
    )
    const tiers: Record<string, FirstDepTier[]> = {}
    for (const r of tierRows) {
      const cur = String(r.currency)
      if (!tiers[cur]) tiers[cur] = []
      tiers[cur].push({ depositAmount: Number(r.deposit_amount), bonusAmount: Number(r.bonus_amount) })
    }
    return { enabled: bool(f.enabled, D.enabled), turnoverX: num(f.turnover_x, D.turnoverX), turnoverDays: num(f.turnover_days, D.turnoverDays), tiers }
  } catch {
    return D
  }
}

/** 向下匹配：返回 amount 命中的最大档位奖励；无命中返回 0。 */
export function matchFirstDepBonus(tiers: FirstDepTier[] | undefined, amount: number): number {
  if (!tiers || tiers.length === 0 || amount <= 0) return 0
  let bonus = 0
  let best = -1
  for (const tier of tiers) {
    if (amount >= tier.depositAmount && tier.depositAmount > best) {
      best = tier.depositAmount
      bonus = tier.bonusAmount
    }
  }
  return bonus
}
