import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'

export interface FirstDepTier {
  depositAmount: number
  bonusAmount: number
}

/** 首充嘉年华支持的币种（USDC 暂未开通充值通道，先预留配置） */
export const FIRSTDEP_CURRENCIES = ['PHP', 'USDT', 'USDC'] as const
export type FirstDepCurrency = (typeof FIRSTDEP_CURRENCIES)[number]

/** 首页弹窗调度：开关/顺序/覆盖人群/弹出频率，客户端按此调度进站弹窗 */
export interface PopupConfig {
  id: string
  enabled: boolean
  order: number
  /** no_deposit=未充值用户（含访客与已登录未充值）；new=仅已登录未充值 */
  audience: 'all' | 'guest' | 'no_deposit' | 'new' | 'deposited'
  frequency: 'daily' | 'once' | 'always'
}

/** 复充限时优惠：已首充且当日未充值的用户进站触发限时窗口，窗口内充值 ≥ minDeposit 送 bonusAmount（每窗口一次） */
export interface RedepConfig {
  enabled: boolean
  /** 达标充值额（PHP） */
  minDeposit: number
  /** 达标奖励（PHP 固定金额） */
  bonusAmount: number
  /** 窗口时长（小时） */
  windowHours: number
  /** 触发冷却（天）：距上次窗口开启不足 N 天不再触发 */
  cooldownDays: number
  turnoverX: number
  turnoverDays: number
}

/** 负盈利返水（路线A·CasinoPlus 式）：每日结算，统一费率、全等级、无上限。
 *  品类白名单复用 bg_turnover_logs.sort_category（与洗码同源）；门槛+封顶当日存款防对赌套利。
 *  注：VIP 等级差异化返水（bg_vip_level_benefit.negative_rebate_pct）已降格停用，字段保留可回滚。 */
export interface LossRebateConfig {
  enabled: boolean
  /** 统一返水率 %（对净输） */
  ratePct: number
  /** 门槛：当日有效存款 ≥ 此值（同币种）才有返水资格 */
  minDeposit: number
  /** 封顶：返水基数不超过当日存款（防对赌无损套利） */
  capToDeposit: boolean
  /** 参与返水的品类白名单（turnover sort_category 取值：slots/fishing/table/live/sports/other）；排除 live/sports */
  eligibleCats: string[]
  /** 每日结算时刻（PHT 小时 0-23）：结算「昨天」整日的返水，默认 0=PHT 00:xx */
  settleHour: number
}

/** Bonuses 页卡片编排：开关/顺序/覆盖人群，客户端按此渲染各活动卡片（与 popups 进站弹窗调度相互独立） */
export type BonusCardId = 'checkin' | 'agent' | 'trial' | 'appdl' | 'firstdep' | 'lossrebate'
export interface BonusCard {
  id: BonusCardId
  enabled: boolean
  order: number
  audience: PopupConfig['audience']
}

export interface PromoConfig {
  trial:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  firstdep: { enabled: boolean; turnoverX: number; turnoverDays: number; tiers: Record<string, FirstDepTier[]> }
  appdl:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  redep:    RedepConfig
  lossRebate: LossRebateConfig
  popups:   PopupConfig[]
  bonusCards: BonusCard[]
}

const DEFAULT_FIRSTDEP_TIERS: Record<string, FirstDepTier[]> = {
  // 低充高送：首充机会只有一次，低档位给高比例拉转化（与线上运营配置一致）
  PHP: [
    { depositAmount: 20, bonusAmount: 10 }, { depositAmount: 50, bonusAmount: 20 },
    { depositAmount: 100, bonusAmount: 50 }, { depositAmount: 200, bonusAmount: 60 },
    { depositAmount: 500, bonusAmount: 100 }, { depositAmount: 1000, bonusAmount: 150 },
    { depositAmount: 5000, bonusAmount: 900 }, { depositAmount: 10000, bonusAmount: 1200 },
    { depositAmount: 50000, bonusAmount: 2000 },
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
}

export const PROMO_DEFAULTS: PromoConfig = {
  // trial 流水 3x：0x 时体验金可直接提现（资损口子），与活动展示口径一致
  trial:    { amount: 88, enabled: true, turnoverX: 3, turnoverDays: 0 },
  firstdep: { enabled: true, turnoverX: 1, turnoverDays: 30, tiers: DEFAULT_FIRSTDEP_TIERS },
  // App/PWA 下载礼金：默认关闭，后台开启后客户端宣传位才展示
  appdl:    { amount: 66, enabled: false, turnoverX: 5, turnoverDays: 30 },
  // 复充限时优惠：默认关闭，后台开启后按人群触发
  redep:    { enabled: false, minDeposit: 500, bonusAmount: 75, windowHours: 4, cooldownDays: 2, turnoverX: 1, turnoverDays: 30 },
  // 负盈利返水：默认关闭，后台开启后每日结算。白名单只含电子类(slots/fishing)，排除真人(live)/体育(sports)防对赌套利
  lossRebate: { enabled: false, ratePct: 5, minDeposit: 50, capToDeposit: true, eligibleCats: ['slots', 'fishing'], settleHour: 0 },
  popups:   [
    { id: 'new_player', enabled: true, order: 1, audience: 'all', frequency: 'daily' },
    // firstdep=首页首充悬浮球，trial=活动页进站弹窗；均为常驻/进站入口，frequency 不生效于常驻，仅用开关/人群
    { id: 'firstdep',   enabled: true, order: 2, audience: 'all', frequency: 'always' },
    { id: 'trial',      enabled: true, order: 3, audience: 'all', frequency: 'always' },
  ],
  // Bonuses 页卡片编排：顺序即渲染顺序；trial/appdl/firstdep 的 enabled 与各自标量开关对账，checkin/agent 独立
  bonusCards: [
    { id: 'checkin',  enabled: true,  order: 1, audience: 'all' },
    { id: 'agent',    enabled: true,  order: 2, audience: 'all' },
    { id: 'trial',    enabled: true,  order: 3, audience: 'all' },
    { id: 'appdl',    enabled: false, order: 4, audience: 'all' },
    { id: 'firstdep', enabled: true,  order: 5, audience: 'all' },
    // 负盈利返水营销卡片：enabled 与活动开关 lossRebate.enabled 对账（活动开才宣传）
    { id: 'lossrebate', enabled: false, order: 6, audience: 'all' },
  ],
}

const BONUS_CARD_IDS: BonusCardId[] = ['checkin', 'agent', 'trial', 'appdl', 'firstdep', 'lossrebate']

function sanitizeBonusCards(raw: unknown): BonusCard[] {
  const byId = new Map<string, Partial<BonusCard>>()
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (p && typeof p === 'object' && typeof (p as BonusCard).id === 'string') {
        byId.set(String((p as BonusCard).id), p as Partial<BonusCard>)
      }
    }
  }
  // 以 5 张固定卡片为准，缺失项补默认，未知 id 丢弃
  const items: BonusCard[] = BONUS_CARD_IDS.map((id) => {
    const def = PROMO_DEFAULTS.bonusCards.find((c) => c.id === id)!
    const it = byId.get(id)
    return {
      id,
      enabled: it && typeof it.enabled === 'boolean' ? it.enabled : def.enabled,
      order: it && Number.isFinite(Number(it.order)) ? Number(it.order) : def.order,
      audience: POPUP_AUDIENCES.includes(it?.audience as never) ? (it!.audience as BonusCard['audience']) : def.audience,
    }
  })
  items.sort((a, b) => a.order - b.order)
  items.forEach((c, i) => { c.order = i + 1 })
  return items
}

/** 卡片开关以标量为准：读取时把 trial/appdl/firstdep 的标量 enabled 回灌到卡片，防两处漂移 */
function reconcileBonusCardEnabled(config: PromoConfig): void {
  for (const card of config.bonusCards) {
    if (card.id === 'trial') card.enabled = config.trial.enabled
    else if (card.id === 'appdl') card.enabled = config.appdl.enabled
    else if (card.id === 'firstdep') card.enabled = config.firstdep.enabled
    else if (card.id === 'lossrebate') card.enabled = config.lossRebate.enabled
  }
}

/** 保存时反向对账：把卡片列表里 trial/appdl/firstdep 的开关写回标量，实现「统一列表即单一开关」 */
function syncScalarEnabledFromCards(config: PromoConfig): void {
  for (const card of config.bonusCards) {
    if (card.id === 'trial') config.trial.enabled = card.enabled
    else if (card.id === 'appdl') config.appdl.enabled = card.enabled
    else if (card.id === 'firstdep') config.firstdep.enabled = card.enabled
    else if (card.id === 'lossrebate') config.lossRebate.enabled = card.enabled
  }
}

const POPUP_AUDIENCES = ['all', 'guest', 'no_deposit', 'new', 'deposited'] as const
const POPUP_FREQUENCIES = ['daily', 'once', 'always'] as const

function sanitizePopups(raw: unknown): PopupConfig[] {
  if (!Array.isArray(raw)) return PROMO_DEFAULTS.popups
  const items: PopupConfig[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object' || typeof (p as PopupConfig).id !== 'string') continue
    const it = p as Partial<PopupConfig>
    items.push({
      id: String(it.id).slice(0, 32),
      enabled: Boolean(it.enabled),
      order: Number.isFinite(Number(it.order)) ? Number(it.order) : 99,
      audience: POPUP_AUDIENCES.includes(it.audience as never) ? it.audience as PopupConfig['audience'] : 'all',
      frequency: POPUP_FREQUENCIES.includes(it.frequency as never) ? it.frequency as PopupConfig['frequency'] : 'daily',
    })
  }
  // 补齐缺失的默认弹窗（历史配置只存了 new_player 时，自动补上 firstdep/trial）
  for (const def of PROMO_DEFAULTS.popups) {
    if (!items.some((p) => p.id === def.id)) items.push({ ...def })
  }
  return items.sort((a, b) => a.order - b.order)
}

function num(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? '')
  return isNaN(n) ? fallback : n
}
function bool(v: string | undefined, fallback: boolean): boolean {
  return v != null ? v === '1' : fallback
}

function parseRedepConfig(r: Record<string, string>): RedepConfig {
  const D = PROMO_DEFAULTS.redep
  return {
    enabled: bool(r.enabled, D.enabled),
    minDeposit: num(r.min_deposit, D.minDeposit),
    bonusAmount: num(r.bonus_amount, D.bonusAmount),
    windowHours: num(r.window_hours, D.windowHours),
    cooldownDays: num(r.cooldown_days, D.cooldownDays),
    turnoverX: num(r.turnover_x, D.turnoverX),
    turnoverDays: num(r.turnover_days, D.turnoverDays),
  }
}

/** turnover sort_category 全集（turnover.service 产出）；白名单仅从中取值，过滤脏数据 */
const TURNOVER_CATEGORIES = ['slots', 'fishing', 'table', 'live', 'sports', 'other'] as const

function parseCats(v: string | undefined, fallback: string[]): string[] {
  if (v == null) return fallback
  const cats = v.split(',').map((s) => s.trim()).filter((s) => (TURNOVER_CATEGORIES as readonly string[]).includes(s))
  return cats.length > 0 ? Array.from(new Set(cats)) : fallback
}

function parseLossRebateConfig(r: Record<string, string>): LossRebateConfig {
  const D = PROMO_DEFAULTS.lossRebate
  return {
    enabled: bool(r.enabled, D.enabled),
    ratePct: num(r.rate_pct, D.ratePct),
    minDeposit: num(r.min_deposit, D.minDeposit),
    capToDeposit: bool(r.cap_to_deposit, D.capToDeposit),
    eligibleCats: parseCats(r.eligible_cats, D.eligibleCats),
    settleHour: Math.min(23, Math.max(0, Math.round(num(r.settle_hour, D.settleHour)))),
  }
}

/** 每日返水结算任务按 Pool 直接读配置 */
export async function getLossRebateConfigByPool(pool: Pool): Promise<LossRebateConfig> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT config_key, config_value FROM bg_promo_config WHERE promo_id = 'loss_rebate'",
    )
    const r: Record<string, string> = {}
    for (const row of rows) r[String(row.config_key)] = String(row.config_value)
    return parseLossRebateConfig(r)
  } catch {
    return PROMO_DEFAULTS.lossRebate
  }
}

/** 充值结算/进站触发时按 Pool 直接读复充配置（同 getFirstDepConfigByPool 的场景） */
export async function getRedepConfigByPool(pool: Pool): Promise<RedepConfig> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT config_key, config_value FROM bg_promo_config WHERE promo_id = 'redep'",
    )
    const r: Record<string, string> = {}
    for (const row of rows) r[String(row.config_key)] = String(row.config_value)
    return parseRedepConfig(r)
  } catch {
    return PROMO_DEFAULTS.redep
  }
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
    const f = map.firstdep ?? {}
    const a = map.appdl ?? {}
    const r = map.redep ?? {}
    const D = PROMO_DEFAULTS
    const tiers = await loadFirstDepTiers(env)
    let popups = D.popups
    if (map.popups?.items) {
      try { popups = sanitizePopups(JSON.parse(map.popups.items)) } catch { /* 配置损坏时回退默认 */ }
    }
    let bonusCards = D.bonusCards
    if (map.bonuscards?.items) {
      try { bonusCards = sanitizeBonusCards(JSON.parse(map.bonuscards.items)) } catch { /* 配置损坏时回退默认 */ }
    }
    const config: PromoConfig = {
      trial:    { amount: num(t.amount, D.trial.amount), enabled: bool(t.enabled, D.trial.enabled), turnoverX: num(t.turnover_x, D.trial.turnoverX), turnoverDays: num(t.turnover_days, D.trial.turnoverDays) },
      firstdep: { enabled: bool(f.enabled, D.firstdep.enabled), turnoverX: num(f.turnover_x, D.firstdep.turnoverX), turnoverDays: num(f.turnover_days, D.firstdep.turnoverDays), tiers },
      appdl:    { amount: num(a.amount, D.appdl.amount), enabled: bool(a.enabled, D.appdl.enabled), turnoverX: num(a.turnover_x, D.appdl.turnoverX), turnoverDays: num(a.turnover_days, D.appdl.turnoverDays) },
      redep:    parseRedepConfig(r),
      lossRebate: parseLossRebateConfig(map.loss_rebate ?? {}),
      popups,
      bonusCards,
    }
    // trial/appdl/firstdep 的卡片开关以各自标量为准，避免两处漂移
    reconcileBonusCardEnabled(config)
    return config
  } catch {
    return PROMO_DEFAULTS
  }
}

export async function savePromoConfig(env: Env, config: PromoConfig): Promise<void> {
  const pool = getMysqlPool(env)
  const D = PROMO_DEFAULTS
  // 统一列表的开关是单一真源：写库前把卡片开关灌回 trial/appdl/firstdep 标量
  if (Array.isArray(config.bonusCards)) syncScalarEnabledFromCards(config)
  const entries: [string, string, string][] = [
    ['trial',    'amount',         String(config.trial.amount            ?? D.trial.amount)],
    ['trial',    'enabled',        config.trial.enabled                  ? '1' : '0'],
    ['trial',    'turnover_x',     String(config.trial.turnoverX         ?? D.trial.turnoverX)],
    ['trial',    'turnover_days',  String(config.trial.turnoverDays      ?? D.trial.turnoverDays)],
    ['firstdep', 'turnover_x',     String(config.firstdep.turnoverX      ?? D.firstdep.turnoverX)],
    ['firstdep', 'turnover_days',  String(config.firstdep.turnoverDays   ?? D.firstdep.turnoverDays)],
    ['firstdep', 'enabled',        config.firstdep.enabled               ? '1' : '0'],
    ['appdl',    'amount',         String(config.appdl.amount            ?? D.appdl.amount)],
    ['appdl',    'enabled',        config.appdl.enabled                  ? '1' : '0'],
    ['appdl',    'turnover_x',     String(config.appdl.turnoverX         ?? D.appdl.turnoverX)],
    ['appdl',    'turnover_days',  String(config.appdl.turnoverDays      ?? D.appdl.turnoverDays)],
    ['redep',    'enabled',        config.redep.enabled                  ? '1' : '0'],
    ['redep',    'min_deposit',    String(config.redep.minDeposit        ?? D.redep.minDeposit)],
    ['redep',    'bonus_amount',   String(config.redep.bonusAmount       ?? D.redep.bonusAmount)],
    ['redep',    'window_hours',   String(config.redep.windowHours       ?? D.redep.windowHours)],
    ['redep',    'cooldown_days',  String(config.redep.cooldownDays      ?? D.redep.cooldownDays)],
    ['redep',    'turnover_x',     String(config.redep.turnoverX         ?? D.redep.turnoverX)],
    ['redep',    'turnover_days',  String(config.redep.turnoverDays      ?? D.redep.turnoverDays)],
    ['loss_rebate', 'enabled',        config.lossRebate.enabled            ? '1' : '0'],
    ['loss_rebate', 'rate_pct',       String(config.lossRebate.ratePct     ?? D.lossRebate.ratePct)],
    ['loss_rebate', 'min_deposit',    String(config.lossRebate.minDeposit  ?? D.lossRebate.minDeposit)],
    ['loss_rebate', 'cap_to_deposit', config.lossRebate.capToDeposit       ? '1' : '0'],
    ['loss_rebate', 'eligible_cats',  parseCats(config.lossRebate.eligibleCats?.join(','), D.lossRebate.eligibleCats).join(',')],
    ['loss_rebate', 'settle_hour',    String(Math.min(23, Math.max(0, Math.round(config.lossRebate.settleHour ?? D.lossRebate.settleHour))))],
    ['popups',   'items',          JSON.stringify(sanitizePopups(config.popups))],
    ['bonuscards', 'items',        JSON.stringify(sanitizeBonusCards(config.bonusCards))],
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
