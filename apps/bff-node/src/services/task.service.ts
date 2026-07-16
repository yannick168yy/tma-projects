import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { creditWallet, listUserIdentities, getUser } from './store/mysql-store.js'
import { createPromoRequirement } from './turnover.service.js'
import { manilaToday, getCheckinStatus } from './checkin.service.js'
import { getPromoConfig } from './promo-config.service.js'
import { ensureBirthdayFromKyc } from './vip.service.js'

// ───────────────────────── 任务定义（硬编码，一期不做 def 表） ─────────────────────────
//
// 划界原则：任务只奖励成长体系不碰的行为（首次动作/账户完善/每日回访/社交），
// 不奖励“流水/下注”（那是洗码返水+VIP 的活）。
// 进度按需查既有流水表实时算，不落进度库；只有“领取”动作落 bg_task_claim。

export type TaskGroup = 'newbie' | 'daily' | 'achievement' | 'social'
export type RewardType = 'cash' | 'spin' | 'growth'

interface NativeTaskDef {
  id: string
  group: TaskGroup
  period: 'daily' | 'once'
  title: string
  subtitle: string
  /** 需要阈值的任务（如今日存款满 Y），threshold 生效；0=任意即达标 */
  useThreshold?: boolean
  todoTarget?: string
}

const NATIVE_TASKS: NativeTaskDef[] = [
  // 今日存款阶梯：三档各自独立领取，前台只显示当前档（后端收纳）
  { id: 'daily_deposit_t1', group: 'daily',  period: 'daily', title: '今日存款 · 第 1 档', subtitle: '当日累计存款达标领取', useThreshold: true, todoTarget: 'deposit' },
  { id: 'daily_deposit_t2', group: 'daily',  period: 'daily', title: '今日存款 · 第 2 档', subtitle: '当日累计存款达标领取', useThreshold: true, todoTarget: 'deposit' },
  { id: 'daily_deposit_t3', group: 'daily',  period: 'daily', title: '今日存款 · 第 3 档', subtitle: '当日累计存款达标领取', useThreshold: true, todoTarget: 'deposit' },
  // threshold=次数，minStake=单笔有效投注额（防 1 分钱刷单）
  { id: 'daily_bets',       group: 'daily',  period: 'daily', title: '每日投注挑战',      subtitle: '完成有效投注即可领取', useThreshold: true, todoTarget: 'games' },
  // 运营位：threshold=局数，category=指定分类（后台每周可换），默认关
  { id: 'daily_play',       group: 'daily',  period: 'daily', title: '今日试玩指定游戏',  subtitle: '试玩指定分类游戏', useThreshold: true, todoTarget: 'games' },
  { id: 'profile_complete', group: 'newbie', period: 'once',  title: '绑定社交账号', subtitle: '绑定 Google 与 Telegram 账号', todoTarget: 'bind_profile' },
  { id: 'first_game',       group: 'newbie', period: 'once',  title: '首次游戏下注',     subtitle: '体验任意游戏并完成一笔下注', todoTarget: 'games' },
  { id: 'invite_milestone', group: 'newbie', period: 'once', title: '邀请好友', subtitle: '成功邀请好友注册达标领奖', useThreshold: true, todoTarget: 'team_center' },
]

/** 新手区展示顺序（体验金第一、绑定账号在邀请后） */
const NEWBIE_ORDER = ['agg_trial', 'first_game', 'invite_milestone', 'profile_complete', 'agg_appdl', 'agg_firstdep', 'agg_birthday']

const NATIVE_BY_ID = new Map(NATIVE_TASKS.map((t) => [t.id, t]))

// ───────────────────────── 配置（后台可配开关/金额/阈值，缺省用下列常量） ─────────────────────────

export interface TaskRewardCfg {
  enabled: boolean
  rewardType: RewardType
  /** cash：现金额；growth：成长值 */
  amount: number
  /** spin：转盘次数 */
  spin: number
  /** 现金奖励打码倍数（0=直接可提） */
  turnoverX: number
  currency: string
  /** useThreshold 任务的达标阈值（金额/次数/局数） */
  threshold: number
  /** daily_bets：单笔投注 ≥ 此额（PHP）才计数 */
  minStake: number
  /** daily_play：指定 site_category（slot/live/fishing/perya…） */
  category: string
}

export type TaskConfig = Record<string, TaskRewardCfg>

const TASK_CONFIG_KEY = 'task_config'

export const DEFAULT_TASK_CONFIG: TaskConfig = {
  daily_deposit_t1: { enabled: true,  rewardType: 'spin', amount: 0,  spin: 1, turnoverX: 0, currency: 'PHP', threshold: 100,  minStake: 0, category: '' },
  daily_deposit_t2: { enabled: true,  rewardType: 'cash', amount: 10, spin: 0, turnoverX: 3, currency: 'PHP', threshold: 500,  minStake: 0, category: '' },
  daily_deposit_t3: { enabled: true,  rewardType: 'cash', amount: 30, spin: 0, turnoverX: 3, currency: 'PHP', threshold: 2000, minStake: 0, category: '' },
  daily_bets:       { enabled: true,  rewardType: 'spin', amount: 0,  spin: 1, turnoverX: 0, currency: 'PHP', threshold: 5,    minStake: 10, category: '' },
  daily_play:       { enabled: true,  rewardType: 'spin', amount: 0,  spin: 1, turnoverX: 0, currency: 'PHP', threshold: 1,    minStake: 0, category: 'slot' },
  profile_complete: { enabled: true,  rewardType: 'cash', amount: 5,  spin: 0, turnoverX: 3, currency: 'PHP', threshold: 0,    minStake: 0, category: '' },
  first_game:       { enabled: true,  rewardType: 'cash', amount: 5,  spin: 0, turnoverX: 3, currency: 'PHP', threshold: 0,    minStake: 0, category: '' },
  invite_milestone: { enabled: true,  rewardType: 'cash', amount: 20, spin: 0, turnoverX: 3, currency: 'PHP', threshold: 1,    minStake: 0, category: '' },
}

const ALL_REWARD_TYPES: RewardType[] = ['cash', 'spin', 'growth']
const clampType = (t: unknown): RewardType => (ALL_REWARD_TYPES.includes(t as RewardType) ? (t as RewardType) : 'cash')
const clampNum = (v: unknown, def = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : def
}

function sanitizeTaskConfig(raw: unknown): TaskConfig {
  const out: TaskConfig = {}
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Partial<TaskRewardCfg>>
  for (const def of NATIVE_TASKS) {
    const d = DEFAULT_TASK_CONFIG[def.id]
    const c = r[def.id] ?? {}
    out[def.id] = {
      enabled: c.enabled !== false && (c.enabled ?? d.enabled),
      rewardType: clampType(c.rewardType ?? d.rewardType),
      amount: clampNum(c.amount, d.amount),
      spin: Math.floor(clampNum(c.spin, d.spin)),
      turnoverX: clampNum(c.turnoverX, d.turnoverX),
      currency: typeof c.currency === 'string' && c.currency ? c.currency.slice(0, 8) : d.currency,
      threshold: clampNum(c.threshold, d.threshold),
      minStake: clampNum(c.minStake, d.minStake),
      category: typeof c.category === 'string' ? c.category.slice(0, 24) : d.category,
    }
  }
  return out
}

async function readSetting(env: Env, key: string): Promise<string | null> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    'SELECT `value` FROM bg_admin_settings WHERE `key` = ?', [key],
  )
  return rows[0] ? String(rows[0].value) : null
}

/** 留存类币种：拉新一次性任务固定 PHP，仅这几个币种有独立留存任务配置 */
export const TASK_CURRENCIES = ['PHP', 'USDT', 'USDC'] as const
/** USDT/USDC 未配置时的默认起点：PHP 金额型字段 ÷ 此值（仿 VIP/首充，后台可再调） */
const TASK_FX_SEED = 58

/**
 * 把存储的原始值归一为「每币种 → 原始任务配置」映射。
 * 兼容两种历史形状：扁平 {taskId:cfg}（旧，视为 PHP）/ 嵌套 {PHP:{...},USDT:{...}}（新）。
 */
function toNestedRaw(raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const looksNested = TASK_CURRENCIES.some((c) => r[c] && typeof r[c] === 'object')
  return looksNested ? r : { PHP: r }
}

/** daily_deposit_t* 的 threshold 是「金额」；其余每日任务 threshold 是「次数/局数」（不随币种缩放） */
const thresholdIsMoney = (taskId: string) => taskId.startsWith('daily_deposit_t')

/** 从 PHP 配置派生某稳定币的默认配置：金额型字段 ÷ TASK_FX_SEED，次数/倍数/开关等保持 */
function scaleCfgToCurrency(php: TaskConfig, currency: string): TaskConfig {
  const div = (v: number) => Math.round((v / TASK_FX_SEED) * 100) / 100
  const out: TaskConfig = {}
  for (const [id, c] of Object.entries(php)) {
    out[id] = {
      ...c,
      currency,
      amount: div(c.amount),
      minStake: div(c.minStake),
      threshold: thresholdIsMoney(id) ? div(c.threshold) : c.threshold,
    }
  }
  return out
}

/** 读取指定币种的任务配置（daily 留存任务用；once 拉新任务固定读 PHP） */
export async function getTaskConfig(env: Env, currency = 'PHP'): Promise<TaskConfig> {
  if (!isMysqlEnabled(env)) return sanitizeTaskConfig(scaleIfStable(DEFAULT_TASK_CONFIG, currency))
  try {
    const raw = await readSetting(env, TASK_CONFIG_KEY)
    const nested = toNestedRaw(raw ? JSON.parse(raw) : {})
    if (currency === 'PHP') return sanitizeTaskConfig(nested.PHP ?? {})
    if (nested[currency]) return sanitizeTaskConfig(nested[currency])
    // 该稳定币未单独配置 → 从 PHP 配置 ÷FX 派生默认（后台保存后即持久化独立值）
    return scaleCfgToCurrency(sanitizeTaskConfig(nested.PHP ?? {}), currency)
  } catch { return sanitizeTaskConfig(scaleIfStable(DEFAULT_TASK_CONFIG, currency)) }
}

function scaleIfStable(php: TaskConfig, currency: string): TaskConfig {
  return currency === 'PHP' ? php : scaleCfgToCurrency(php, currency)
}

/** 保存指定币种的任务配置（其余币种保持不变；首次保存自动把旧扁平结构迁为嵌套） */
export async function saveTaskConfig(env: Env, config: unknown, currency = 'PHP'): Promise<TaskConfig> {
  const clean = sanitizeTaskConfig(config)
  const raw = await readSetting(env, TASK_CONFIG_KEY)
  const nested = toNestedRaw(raw ? JSON.parse(raw) : {})
  nested[currency] = clean
  // 稳定币共用一套：保存 USDT 时镜像同步 USDC
  if (currency === 'USDT') nested['USDC'] = clean
  await getMysqlPool(env).execute(
    'INSERT INTO bg_admin_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [TASK_CONFIG_KEY, JSON.stringify(nested)],
  )
  return clean
}

// ───────────────────────── 达标判定（查询式，不落进度库） ─────────────────────────

function periodKey(def: NativeTaskDef, today: string): string {
  return def.period === 'daily' ? today : 'once'
}

/** 当日成功充值累计额（马尼拉日，限定币种） */
async function todayDepositTotal(pool: Pool, userId: string, date: string, currency: string): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM bg_deposit_order
     WHERE user_id = ? AND status = 'paid' AND currency = ? AND DATE(created_at + INTERVAL 8 HOUR) = ?`,
    [userId, currency, date],
  )
  return Number(row?.total ?? 0)
}

async function hasBet(pool: Pool, userId: string): Promise<boolean> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM bg_bet_order WHERE user_id = ? AND bet_type = 'bet' LIMIT 1`,
    [userId],
  )
  return Boolean(row)
}

/** 当日有效投注笔数（单笔 ≥ minStake 才计数，马尼拉日，限定币种） */
async function todayBetCount(pool: Pool, userId: string, date: string, minStake: number, currency: string): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM bg_bet_order
     WHERE user_id = ? AND bet_type = 'bet' AND currency_code = ? AND amount >= ?
       AND DATE(created_at + INTERVAL 8 HOUR) = ?`,
    [userId, currency, Math.max(0, minStake), date],
  )
  return Number(row?.n ?? 0)
}

/** 当日指定 site_category 的投注局数（bet.provider_id = 568win game_id，限定币种） */
async function todayCategoryBetCount(pool: Pool, userId: string, date: string, category: string, currency: string): Promise<number> {
  if (!category) return 0
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT b.id) AS n FROM bg_bet_order b
     JOIN bg_568win_game g ON g.game_id = b.provider_id
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     WHERE b.user_id = ? AND b.bet_type = 'bet' AND b.currency_code = ?
       AND DATE(b.created_at + INTERVAL 8 HOUR) = ?
       AND COALESCE(o.site_category, g.site_category_auto, 'other') = ?`,
    [userId, currency, date, category],
  )
  return Number(row?.n ?? 0)
}

/** 已绑定的社交账号数（google + telegram，0..2） */
async function boundSocialCount(env: Env, userId: string): Promise<number> {
  const ids = await listUserIdentities(env, userId)
  let n = 0
  if (ids.some((i) => i.provider === 'google')) n += 1
  if (ids.some((i) => i.provider === 'telegram')) n += 1
  return n
}

/** 成功邀请人数（下线注册数，inviter_id 指向邀请人 user id） */
async function inviteeCount(pool: Pool, userId: string): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM bg_user WHERE inviter_id = ?`, [userId],
  )
  return Number(row?.n ?? 0)
}

interface TaskEval { eligible: boolean; progress?: { current: number; target: number } }

/**
 * 判定达标 + 计算进度。memo 缓存同请求内的共享查询（如三档存款共用当日累计额）。
 */
async function evalTask(
  env: Env, userId: string, def: NativeTaskDef, cfg: TaskRewardCfg, currency: string,
  memo: { depositTotal?: number } = {},
): Promise<TaskEval> {
  const pool = getMysqlPool(env)
  const today = manilaToday()
  // 每日留存类按币种判定；一次性拉新类（profile/first_game/invite）与币种无关
  if (def.id.startsWith('daily_deposit_t')) {
    memo.depositTotal ??= await todayDepositTotal(pool, userId, today, currency)
    const target = Math.max(1, cfg.threshold)
    return { eligible: memo.depositTotal >= target, progress: { current: Math.min(memo.depositTotal, target), target } }
  }
  switch (def.id) {
    case 'daily_bets': {
      const target = Math.max(1, cfg.threshold)
      const n = await todayBetCount(pool, userId, today, cfg.minStake, currency)
      return { eligible: n >= target, progress: { current: Math.min(n, target), target } }
    }
    case 'daily_play': {
      const target = Math.max(1, cfg.threshold)
      const n = await todayCategoryBetCount(pool, userId, today, cfg.category, currency)
      return { eligible: n >= target, progress: { current: Math.min(n, target), target } }
    }
    case 'profile_complete': {
      const n = await boundSocialCount(env, userId)
      return { eligible: n >= 2, progress: { current: n, target: 2 } }
    }
    case 'first_game':       return { eligible: await hasBet(pool, userId) }
    case 'invite_milestone': {
      const target = Math.max(1, cfg.threshold)
      const n = await inviteeCount(pool, userId)
      return { eligible: n >= target, progress: { current: Math.min(n, target), target } }
    }
    default: return { eligible: false }
  }
}

/** 判定某原生任务当前是否达标（未考虑是否已领取） */
async function isEligible(env: Env, userId: string, def: NativeTaskDef, cfg: TaskRewardCfg, currency: string): Promise<boolean> {
  return (await evalTask(env, userId, def, cfg, currency)).eligible
}

/** 查已领取集合，key = task_id:period_key:currency（每币种独立判 done） */
async function claimedPeriods(pool: Pool, userId: string, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set()
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT task_id, period_key, currency FROM bg_task_claim WHERE user_id = ? AND task_id IN (?)`,
    [userId, taskIds],
  )
  const set = new Set<string>()
  for (const r of rows) set.add(`${r.task_id}:${r.period_key}:${r.currency}`)
  return set
}

// ───────────────────────── 发奖（复用 creditWallet + createPromoRequirement 打码） ─────────────────────────

/** 幂等发放转盘次数：source 唯一。任务发次数复用签到档的最低启用档 */
async function grantSpinChance(env: Env, userId: string, source: string, n: number): Promise<void> {
  if (n <= 0) return
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM bg_spin_deposit_rule WHERE kind = 'checkin' AND enabled = 1 ORDER BY id LIMIT 1`,
  )
  const ruleId = rows[0]?.id
  if (!ruleId) return
  await pool.execute(
    `INSERT IGNORE INTO bg_spin_chance (user_id, source_order_id, rule_id, deposit_amount_php, chances_total)
     VALUES (?, ?, ?, 0, ?)`,
    [userId, source, Number(ruleId), n],
  )
}

/** 累加 VIP 成长值到【对应币种】的等级账（每币种独立账号；等级判定消费本币种 task_growth） */
async function grantGrowth(env: Env, userId: string, amount: number, currency: string): Promise<void> {
  if (amount <= 0) return
  await getMysqlPool(env).execute(
    `INSERT INTO bg_user_vip_state (user_id, currency, task_growth) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE task_growth = task_growth + VALUES(task_growth)`,
    [userId, currency, amount],
  )
}

interface RewardSpec { type: RewardType; amount: number; spin: number; turnoverX: number; currency: string }

/** 统一发奖：cash→入钱包(可带打码)；spin→转盘次数；growth→成长值 */
async function grantReward(env: Env, userId: string, reward: RewardSpec, source: string): Promise<void> {
  if (reward.type === 'cash') {
    if (reward.amount > 0) {
      await creditWallet(env, userId, reward.amount, {
        type: 'task_bonus', currency: reward.currency, description: `任务奖励:${source}`,
        createdAt: new Date().toISOString(),
      })
      if (reward.turnoverX > 0) {
        await createPromoRequirement(getMysqlPool(env), userId, `task:${source}`, reward.amount, reward.turnoverX, null, reward.currency)
      }
    }
  } else if (reward.type === 'spin') {
    await grantSpinChance(env, userId, `task:${source}`, reward.spin)
  } else if (reward.type === 'growth') {
    await grantGrowth(env, userId, reward.amount, reward.currency)
  }
}

function rewardOf(cfg: TaskRewardCfg): RewardSpec {
  return { type: cfg.rewardType, amount: cfg.amount, spin: cfg.spin, turnoverX: cfg.turnoverX, currency: cfg.currency }
}

// ───────────────────────── 统一任务卡模型 + 任务中心 ─────────────────────────

export interface TaskCard {
  id: string
  group: TaskGroup
  title: string
  subtitle: string
  status: 'locked' | 'claimable' | 'done'
  reward: { type: RewardType; amount: number; spin: number; currency: string; turnoverX: number }
  /** 进度（成就/里程碑类展示进度条） */
  progress?: { current: number; target: number }
  /**
   * 动作：claim=原生领取；goto=社群外链;code_redeem/manual_review=社群验证;
   * open_module=跳到既有入口，不由任务引擎领取（如 checkin/deposit/games/team_center）
   */
  action: { kind: 'claim' | 'goto' | 'code_redeem' | 'manual_review' | 'open_module'; url?: string; target?: string; verifyStrategy?: string }
}

interface SocialRow {
  task_key: string
  platform: 'telegram' | 'facebook' | 'viber'
  verify_strategy: 'tg_member' | 'code_redeem' | 'manual_review'
  title: string
  subtitle: string
  action_url: string
  channel_ref: string
  redeem_code: string
  reward_type: RewardType
  currency: string
  reward_amount: number
  reward_spin: number
  turnover_x: number
  enabled: number
  sort: number
}

async function loadSocialConfigs(pool: Pool, onlyEnabled: boolean): Promise<SocialRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM bg_task_social ${onlyEnabled ? 'WHERE enabled = 1' : ''} ORDER BY sort ASC`,
  )
  return rows as unknown as SocialRow[]
}

export interface TaskCenter {
  groups: { newbie: TaskCard[]; daily: TaskCard[]; achievement: TaskCard[]; social: TaskCard[] }
}

export async function getTaskCenter(env: Env, userId: string, currency = 'PHP'): Promise<TaskCenter> {
  const empty: TaskCenter = { groups: { newbie: [], daily: [], achievement: [], social: [] } }
  if (!isMysqlEnabled(env)) return empty
  const pool = getMysqlPool(env)
  // daily 留存任务用当前币种配置；once 拉新任务固定 PHP 配置
  const cfgCur = await getTaskConfig(env, currency)
  const cfgPhp = currency === 'PHP' ? cfgCur : await getTaskConfig(env, 'PHP')
  const cfgFor = (def: NativeTaskDef) => (def.period === 'once' ? cfgPhp : cfgCur)
  const curFor = (def: NativeTaskDef) => (def.period === 'once' ? 'PHP' : currency)
  const today = manilaToday()

  const nativeEnabled = NATIVE_TASKS.filter((d) => cfgFor(d)[d.id]?.enabled)

  // 压测优化#2：原实现逐任务串行 await（全链 ~18 次 DB 往返，45rps 全场最低破线）。
  // 改为已领取集合 / 全任务判定 / 社群 / 聚合卡片四路并行；depositTotal 预取一次，
  // 避免三档存款任务并行时 memo ??= 竞态导致重复查询。
  const [claimed, evals, socialPack, agg] = await Promise.all([
    claimedPeriods(pool, userId, nativeEnabled.map((d) => d.id)),
    (async () => {
      const memo: { depositTotal?: number } = {}
      if (nativeEnabled.some((d) => d.id.startsWith('daily_deposit_t'))) {
        memo.depositTotal = await todayDepositTotal(pool, userId, today, currency)
      }
      return Promise.all(nativeEnabled.map((def) => evalTask(env, userId, def, cfgFor(def)[def.id], curFor(def), memo)))
    })(),
    (async () => {
      const socials = await loadSocialConfigs(pool, true)
      const socialClaimed = await socialClaimedKeys(pool, userId, socials.map((s) => s.task_key))
      return { socials, socialClaimed }
    })(),
    buildAggregatedCards(env, userId),
  ])

  const cards: TaskCard[] = []
  for (let i = 0; i < nativeEnabled.length; i++) {
    const def = nativeEnabled[i]
    const c = cfgFor(def)[def.id]
    const effCur = curFor(def)
    const pk = periodKey(def, today)
    const isClaimed = claimed.has(`${def.id}:${pk}:${effCur}`)
    const ev = evals[i]
    const status: TaskCard['status'] = isClaimed ? 'done' : ev.eligible ? 'claimable' : 'locked'
    // 运营位跳对应分类大厅
    const todoTarget = def.id === 'daily_play' && c.category ? `games?cat=${c.category}` : def.todoTarget
    cards.push({
      id: def.id, group: def.group, title: def.title, subtitle: def.subtitle, status, progress: ev.progress,
      reward: { type: c.rewardType, amount: c.amount, spin: c.spin, currency: effCur, turnoverX: c.turnoverX },
      action: status === 'locked' && todoTarget
        ? { kind: 'open_module', target: todoTarget }
        : { kind: 'claim' },
    })
  }
  // 存款阶梯收纳：只展示最低未完成档；三档全领完展示末档（done）
  const tierCards = cards.filter((c) => c.id.startsWith('daily_deposit_t'))
  if (tierCards.length > 1) {
    const active = tierCards.find((c) => c.status !== 'done') ?? tierCards[tierCards.length - 1]
    for (const tc of tierCards) {
      if (tc !== active) cards.splice(cards.indexOf(tc), 1)
    }
  }

  // 社群任务（已随上方 Promise.all 并行取回）
  const { socials, socialClaimed } = socialPack
  const socialCards: TaskCard[] = socials.map((s) => {
    const done = socialClaimed.has(s.task_key)
    const kind: TaskCard['action']['kind'] =
      s.verify_strategy === 'code_redeem' ? 'code_redeem'
      : s.verify_strategy === 'manual_review' ? 'manual_review'
      : 'goto'
    return {
      id: s.task_key, group: 'social', title: s.title, subtitle: s.subtitle,
      status: done ? 'done' : 'claimable',
      reward: { type: s.reward_type, amount: Number(s.reward_amount), spin: Number(s.reward_spin), currency: s.currency, turnoverX: Number(s.turnover_x) },
      action: { kind, url: s.action_url || undefined, verifyStrategy: s.verify_strategy },
    }
  })

  const out: TaskCenter = { groups: { newbie: [], daily: [], achievement: [], social: socialCards } }
  for (const card of cards) out.groups[card.group].push(card)

  // 聚合层：把散落的老模块（签到/trial/appdl/首充/生日）读现状串成任务卡（display-only，跳各自入口；已并行取回）
  out.groups.newbie.push(...agg.newbie)
  out.groups.daily.unshift(...agg.daily)         // 签到置每日区首位
  out.groups.achievement.push(...agg.achievement)

  // 新手区固定展示顺序（体验金第一）
  const orderOf = (id: string) => { const i = NEWBIE_ORDER.indexOf(id); return i === -1 ? NEWBIE_ORDER.length : i }
  out.groups.newbie.sort((a, b) => orderOf(a.id) - orderOf(b.id))
  return out
}

/** 聚合老模块 → 任务卡（每块独立 try/catch，单块失败不拖垮整个任务中心） */
async function buildAggregatedCards(env: Env, userId: string): Promise<{ newbie: TaskCard[]; daily: TaskCard[]; achievement: TaskCard[] }> {
  const pool = getMysqlPool(env)
  const newbie: TaskCard[] = []
  const daily: TaskCard[] = []
  const achievement: TaskCard[] = []

  const zeroReward = (type: RewardType, amount = 0, spin = 0): TaskCard['reward'] =>
    ({ type, amount, spin, currency: 'PHP', turnoverX: 0 })
  const aggCard = (id: string, title: string, subtitle: string, done: boolean, target: string, reward: TaskCard['reward'], group: TaskGroup, progress?: TaskCard['progress']): TaskCard =>
    ({ id, group, title, subtitle, status: done ? 'done' : 'claimable', reward, progress, action: { kind: 'open_module', target } })

  // 压测优化#2：五路读现状并行（appdl 领取查询无条件预取，是否使用由 promo 开关决定）
  const [user, promo, appdlRow, birthdaySet, ck] = await Promise.all([
    getUser(env, userId).catch(() => null),
    getPromoConfig(env).catch(() => null),
    pool.query<RowDataPacket[]>('SELECT 1 AS ok FROM bg_app_download_claim WHERE user_id = ? LIMIT 1', [userId])
      .then(([rows]) => rows[0] ?? null).catch(() => null),
    // 生日只来自 KYC 证件：未设置时引导去实名认证，KYC 已通过的历史用户在 ensure 内懒回填
    ensureBirthdayFromKyc(env, userId).catch(() => false),
    getCheckinStatus(env, userId).catch(() => null),
  ])

  if (promo?.trial.enabled) {
    newbie.push(aggCard('agg_trial', '领取新手体验金', '完成手机验证即可领取', Boolean(user?.trialClaimed), 'trial_bonus', zeroReward('cash', promo.trial.amount), 'newbie'))
  }
  if (promo?.appdl.enabled) {
    newbie.push(aggCard('agg_appdl', '下载 App 领礼金', '安装 App / PWA 一次性奖励', Boolean(appdlRow), 'app_download', zeroReward('cash', promo.appdl.amount), 'newbie'))
  }
  if (promo?.firstdep.enabled) {
    newbie.push(aggCard('agg_firstdep', '完成首充', '首次充值即得彩金', Boolean(user?.firstDepClaimed), 'deposit', zeroReward('cash', 0), 'newbie'))
  }
  newbie.push(aggCard('agg_birthday', '解锁生日礼金', '完成实名认证，自动同步证件生日', birthdaySet, 'kyc', zeroReward('cash', 0), 'newbie'))

  if (ck?.enabled) {
    daily.push(aggCard('agg_checkin', '每日签到', ck.todayClaimed ? '今日已签到' : '签到领取抽奖次数', ck.todayClaimed, 'checkin', zeroReward('spin', 0, 1), 'daily'))
    // 里程碑收纳：只展示下一个未达成的（全达成则展示末档 done），避免 7/15/30 三张卡常驻撑爆列表
    const next = ck.milestones.find((m) => !m.reached) ?? ck.milestones[ck.milestones.length - 1]
    if (next) {
      achievement.push(aggCard(
        `agg_checkin_ms_${next.atDays}`, `本月签到 ${next.atDays} 天`, '达成额外奖励',
        next.reached, 'checkin', zeroReward('spin', 0, next.n), 'achievement',
        { current: Math.min(ck.monthDays, next.atDays), target: next.atDays },
      ))
    }
  }

  return { newbie, daily, achievement }
}

async function socialClaimedKeys(pool: Pool, userId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT task_key FROM bg_task_social_claim WHERE user_id = ? AND task_key IN (?)`,
    [userId, keys],
  )
  return new Set(rows.map((r) => String(r.task_key)))
}

// ───────────────────────── 领取原生任务 ─────────────────────────

export interface ClaimResult { taskId: string; reward: RewardSpec }

export async function claimTask(env: Env, userId: string, taskId: string, currency = 'PHP'): Promise<ClaimResult> {
  if (!isMysqlEnabled(env)) throw new Error('storage unavailable')
  const def = NATIVE_BY_ID.get(taskId)
  if (!def) throw new Error('unknown task')
  // daily 留存任务按传入币种；once 拉新任务固定 PHP
  const effCur = def.period === 'once' ? 'PHP' : currency
  const cfg = await getTaskConfig(env, effCur)
  const c = cfg[taskId]
  if (!c?.enabled) throw new Error('disabled')

  const eligible = await isEligible(env, userId, def, c, effCur)
  if (!eligible) throw new Error('not eligible')

  const pool = getMysqlPool(env)
  const pk = periodKey(def, manilaToday())
  // INSERT IGNORE 作为幂等闸门（唯一键含 currency，每币种每期各一次）：先落领取记录，再发奖
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO bg_task_claim
       (user_id, task_id, period_key, reward_type, currency, reward_amount, reward_spin, turnover_x)
     VALUES (?,?,?,?,?,?,?,?)`,
    [userId, taskId, pk, c.rewardType, effCur, c.amount, c.spin, c.turnoverX],
  )
  if (res.affectedRows === 0) throw new Error('already claimed')

  const reward: RewardSpec = { ...rewardOf(c), currency: effCur }
  await grantReward(env, userId, reward, `${taskId}:${pk}`)
  return { taskId, reward }
}

// ───────────────────────── 社群任务：验证 + 领取 ─────────────────────────

/** 取用户的 Telegram 数字 id（provider='telegram'）；无绑定返回 null */
async function getUserTgId(env: Env, userId: string): Promise<string | null> {
  const ids = await listUserIdentities(env, userId)
  const tg = ids.find((i) => i.provider === 'telegram')
  return tg ? tg.identifier : null
}

/** Bot getChatMember：Bot 须为频道/群管理员，否则查不到成员 */
async function tgIsMember(env: Env, channelRef: string, tgId: string): Promise<boolean> {
  if (!channelRef) return false
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember`
    + `?chat_id=${encodeURIComponent(channelRef)}&user_id=${encodeURIComponent(tgId)}`
  try {
    const res = await fetch(url)
    const data = (await res.json()) as { ok?: boolean; result?: { status?: string } }
    if (!data.ok) return false
    const st = data.result?.status
    return st === 'member' || st === 'administrator' || st === 'creator'
  } catch { return false }
}

export interface SocialClaimInput { code?: string; screenshotUrl?: string; ip?: string }
export interface SocialClaimResult { status: 'claimed' | 'pending_review'; reward?: RewardSpec }

/**
 * 社群任务领取：
 *  - tg_member     getChatMember 强验证（未绑定抛 need_bind_telegram，退群抛 not_member）
 *  - code_redeem   回填码比对（弱验证）
 *  - manual_review 入人工审核队列，不立即发奖
 */
export async function claimSocialTask(env: Env, userId: string, taskKey: string, input: SocialClaimInput): Promise<SocialClaimResult> {
  if (!isMysqlEnabled(env)) throw new Error('storage unavailable')
  const pool = getMysqlPool(env)
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM bg_task_social WHERE task_key = ? AND enabled = 1 LIMIT 1`, [taskKey],
  )
  if (!row) throw new Error('unknown task')
  const s = row as unknown as SocialRow

  const [[already]] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM bg_task_social_claim WHERE user_id = ? AND task_key = ? LIMIT 1`, [userId, taskKey],
  )
  if (already) throw new Error('already claimed')

  let codeUsed = ''
  switch (s.verify_strategy) {
    case 'tg_member': {
      const tgId = await getUserTgId(env, userId)
      if (!tgId) throw new Error('need_bind_telegram')
      if (!(await tgIsMember(env, s.channel_ref, tgId))) throw new Error('not_member')
      break
    }
    case 'code_redeem': {
      const input_code = (input.code ?? '').trim().toLowerCase()
      const target = (s.redeem_code ?? '').trim().toLowerCase()
      if (!target || input_code !== target) throw new Error('bad_code')
      codeUsed = (input.code ?? '').trim().slice(0, 64)
      break
    }
    case 'manual_review': {
      await pool.execute(
        `INSERT INTO bg_task_manual_review (user_id, task_key, screenshot_url) VALUES (?,?,?)`,
        [userId, taskKey, (input.screenshotUrl ?? '').slice(0, 512)],
      )
      return { status: 'pending_review' }
    }
    default: throw new Error('unknown strategy')
  }

  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO bg_task_social_claim (user_id, task_key, verified_via, code_used, ip)
     VALUES (?,?,?,?,?)`,
    [userId, taskKey, s.verify_strategy, codeUsed, (input.ip ?? '').slice(0, 64)],
  )
  if (res.affectedRows === 0) throw new Error('already claimed')

  const reward: RewardSpec = {
    type: s.reward_type, amount: Number(s.reward_amount), spin: Number(s.reward_spin),
    turnoverX: Number(s.turnover_x), currency: s.currency,
  }
  await grantReward(env, userId, reward, `social:${taskKey}`)
  return { status: 'claimed', reward }
}

// ───────────────────────── 后台：社群配置 + 人工审核 ─────────────────────────

export async function adminListSocialConfigs(env: Env): Promise<SocialRow[]> {
  if (!isMysqlEnabled(env)) return []
  return loadSocialConfigs(getMysqlPool(env), false)
}

export async function adminSaveSocialConfig(env: Env, key: string, patch: Partial<SocialRow>): Promise<void> {
  const pool = getMysqlPool(env)
  const fields: string[] = []
  const vals: (string | number)[] = []
  const allow: (keyof SocialRow)[] = ['title', 'subtitle', 'action_url', 'channel_ref', 'redeem_code', 'reward_type', 'currency', 'reward_amount', 'reward_spin', 'turnover_x', 'enabled', 'sort', 'verify_strategy']
  for (const f of allow) {
    const v = patch[f]
    if (v !== undefined) { fields.push(`\`${f}\` = ?`); vals.push(v as string | number) }
  }
  if (fields.length === 0) return
  vals.push(key)
  await pool.execute(`UPDATE bg_task_social SET ${fields.join(', ')} WHERE task_key = ?`, vals)
}

export async function adminListManualReviews(env: Env, status: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<RowDataPacket[]> {
  if (!isMysqlEnabled(env)) return []
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_task_manual_review WHERE status = ? ORDER BY created_at ASC LIMIT 200`, [status],
  )
  return rows
}

/** 审核截图任务：通过则补发领取记录 + 发奖 */
export async function adminReviewManual(env: Env, id: number, approve: boolean, reviewer: string, note = ''): Promise<void> {
  const pool = getMysqlPool(env)
  const conn: PoolConnection = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[rev]] = await conn.query<RowDataPacket[]>(
      `SELECT user_id, task_key, status FROM bg_task_manual_review WHERE id = ? FOR UPDATE`, [id],
    )
    if (!rev || rev.status !== 'pending') { await conn.rollback(); throw new Error('not pending') }
    await conn.execute(
      `UPDATE bg_task_manual_review SET status = ?, reviewer = ?, note = ?, reviewed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [approve ? 'approved' : 'rejected', reviewer.slice(0, 64), note.slice(0, 255), id],
    )
    if (approve) {
      await conn.execute(
        `INSERT IGNORE INTO bg_task_social_claim (user_id, task_key, verified_via) VALUES (?,?,'manual_review')`,
        [rev.user_id, rev.task_key],
      )
    }
    await conn.commit()
    if (approve) {
      const [[s]] = await pool.query<RowDataPacket[]>(`SELECT * FROM bg_task_social WHERE task_key = ? LIMIT 1`, [rev.task_key])
      if (s) {
        const row = s as unknown as SocialRow
        await grantReward(env, String(rev.user_id), {
          type: row.reward_type, amount: Number(row.reward_amount), spin: Number(row.reward_spin),
          turnoverX: Number(row.turnover_x), currency: row.currency,
        }, `social:${rev.task_key}`)
      }
    }
  } catch (e) {
    try { await conn.rollback() } catch { /* noop */ }
    throw e
  } finally {
    conn.release()
  }
}
