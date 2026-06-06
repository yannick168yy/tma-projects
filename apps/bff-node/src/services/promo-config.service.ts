import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'

export interface PromoConfig {
  trial:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  referral: { inviterAmount: number; inviteeAmount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  firstdep: { matchPct: number; maxBonus: number; minDeposit: number; turnoverX: number; turnoverDays: number; enabled: boolean }
}

export const PROMO_DEFAULTS: PromoConfig = {
  trial:    { amount: 88, enabled: true, turnoverX: 0, turnoverDays: 0 },
  referral: { inviterAmount: 50, inviteeAmount: 30, enabled: true, turnoverX: 0, turnoverDays: 0 },
  firstdep: { matchPct: 120, maxBonus: 1000, minDeposit: 100, turnoverX: 15, turnoverDays: 30, enabled: true },
}

function num(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? '')
  return isNaN(n) ? fallback : n
}
function bool(v: string | undefined, fallback: boolean): boolean {
  return v != null ? v === '1' : fallback
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
    return {
      trial:    { amount: num(t.amount, D.trial.amount), enabled: bool(t.enabled, D.trial.enabled), turnoverX: num(t.turnover_x, D.trial.turnoverX), turnoverDays: num(t.turnover_days, D.trial.turnoverDays) },
      referral: { inviterAmount: num(r.inviter_amount, D.referral.inviterAmount), inviteeAmount: num(r.invitee_amount, D.referral.inviteeAmount), enabled: bool(r.enabled, D.referral.enabled), turnoverX: num(r.turnover_x, D.referral.turnoverX), turnoverDays: num(r.turnover_days, D.referral.turnoverDays) },
      firstdep: { matchPct: num(f.match_pct, D.firstdep.matchPct), maxBonus: num(f.max_bonus, D.firstdep.maxBonus), minDeposit: num(f.min_deposit, D.firstdep.minDeposit), turnoverX: num(f.turnover_x, D.firstdep.turnoverX), turnoverDays: num(f.turnover_days, D.firstdep.turnoverDays), enabled: bool(f.enabled, D.firstdep.enabled) },
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
    ['firstdep', 'match_pct',      String(config.firstdep.matchPct       ?? D.firstdep.matchPct)],
    ['firstdep', 'max_bonus',      String(config.firstdep.maxBonus       ?? D.firstdep.maxBonus)],
    ['firstdep', 'min_deposit',    String(config.firstdep.minDeposit     ?? D.firstdep.minDeposit)],
    ['firstdep', 'turnover_x',     String(config.firstdep.turnoverX      ?? D.firstdep.turnoverX)],
    ['firstdep', 'turnover_days',  String(config.firstdep.turnoverDays   ?? D.firstdep.turnoverDays)],
    ['firstdep', 'enabled',        config.firstdep.enabled               ? '1' : '0'],
  ]
  await pool.query(
    `INSERT INTO bg_promo_config (promo_id, config_key, config_value) VALUES ?
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [entries],
  )
}
