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
  { id: 'daily_login',      group: 'daily',  period: 'daily', title: '每日登录',        subtitle: '每天登录即可领取' },
  { id: 'daily_deposit',    group: 'daily',  period: 'daily', title: '今日完成一笔存款', subtitle: '当日成功充值达标即可领取', useThreshold: true, todoTarget: 'deposit' },
  { id: 'profile_complete', group: 'newbie', period: 'once',  title: '完善资料 / 绑定邮箱', subtitle: '绑定邮箱、完善账户资料', todoTarget: 'bind_profile' },
  { id: 'first_game',       group: 'newbie', period: 'once',  title: '首次游戏下注',     subtitle: '体验任意游戏并完成一笔下注', todoTarget: 'games' },
  { id: 'invite_milestone', group: 'newbie', period: 'once', title: '邀请好友', subtitle: '成功邀请好友注册达标领奖', useThreshold: true, todoTarget: 'team_center' },
]

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
  /** useThreshold 任务的达标阈值（PHP） */
  threshold: number
}

export type TaskConfig = Record<string, TaskRewardCfg>

const TASK_CONFIG_KEY = 'task_config'

export const DEFAULT_TASK_CONFIG: TaskConfig = {
  daily_login:      { enabled: true, rewardType: 'spin', amount: 0,  spin: 1, turnoverX: 0, currency: 'PHP', threshold: 0 },
  daily_deposit:    { enabled: true, rewardType: 'cash', amount: 5,  spin: 0, turnoverX: 3, currency: 'PHP', threshold: 100 },
  profile_complete: { enabled: true, rewardType: 'cash', amount: 5,  spin: 0, turnoverX: 3, currency: 'PHP', threshold: 0 },
  first_game:       { enabled: true, rewardType: 'cash', amount: 5,  spin: 0, turnoverX: 3, currency: 'PHP', threshold: 0 },
  invite_milestone: { enabled: true, rewardType: 'cash', amount: 20, spin: 0, turnoverX: 3, currency: 'PHP', threshold: 1 },
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

export async function getTaskConfig(env: Env): Promise<TaskConfig> {
  if (!isMysqlEnabled(env)) return { ...DEFAULT_TASK_CONFIG }
  try {
    const raw = await readSetting(env, TASK_CONFIG_KEY)
    return raw ? sanitizeTaskConfig(JSON.parse(raw)) : { ...DEFAULT_TASK_CONFIG }
  } catch { return { ...DEFAULT_TASK_CONFIG } }
}

export async function saveTaskConfig(env: Env, config: unknown): Promise<TaskConfig> {
  const clean = sanitizeTaskConfig(config)
  await getMysqlPool(env).execute(
    'INSERT INTO bg_admin_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [TASK_CONFIG_KEY, JSON.stringify(clean)],
  )
  return clean
}

// ───────────────────────── 达标判定（查询式，不落进度库） ─────────────────────────

function periodKey(def: NativeTaskDef, today: string): string {
  return def.period === 'daily' ? today : 'once'
}

/** 当日是否有 ≥threshold 的成功充值（马尼拉日） */
async function depositMetToday(pool: Pool, userId: string, date: string, threshold: number): Promise<boolean> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM bg_deposit_order
     WHERE user_id = ? AND status = 'paid' AND DATE(created_at + INTERVAL 8 HOUR) = ?`,
    [userId, date],
  )
  return Number(row?.total ?? 0) >= Math.max(0, threshold)
}

async function hasBet(pool: Pool, userId: string): Promise<boolean> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM bg_bet_order WHERE user_id = ? AND bet_type = 'bet' LIMIT 1`,
    [userId],
  )
  return Boolean(row)
}

/** 成功邀请人数（下线注册数，inviter_id 指向邀请人 user id） */
async function inviteeCount(pool: Pool, userId: string): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM bg_user WHERE inviter_id = ?`, [userId],
  )
  return Number(row?.n ?? 0)
}

/** 判定某原生任务当前是否达标（未考虑是否已领取） */
async function isEligible(env: Env, userId: string, def: NativeTaskDef, cfg: TaskRewardCfg): Promise<boolean> {
  const pool = getMysqlPool(env)
  switch (def.id) {
    case 'daily_login':      return true // 能调到本接口即已登录
    case 'daily_deposit':    return depositMetToday(pool, userId, manilaToday(), cfg.threshold)
    case 'profile_complete': { const u = await getUser(env, userId); return Boolean(u?.email) }
    case 'first_game':       return hasBet(pool, userId)
    case 'invite_milestone': return (await inviteeCount(pool, userId)) >= Math.max(1, cfg.threshold)
    default: return false
  }
}

/** 查已领取的 (task_id → period_key 集合)，用于判 done */
async function claimedPeriods(pool: Pool, userId: string, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set()
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT task_id, period_key FROM bg_task_claim WHERE user_id = ? AND task_id IN (?)`,
    [userId, taskIds],
  )
  const set = new Set<string>()
  for (const r of rows) set.add(`${r.task_id}:${r.period_key}`)
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

/** 累加 VIP 成长值（三期由等级判定消费；此处只负责写入） */
async function grantGrowth(env: Env, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  await getMysqlPool(env).execute(
    `INSERT INTO bg_user_vip_state (user_id, task_growth) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE task_growth = task_growth + VALUES(task_growth)`,
    [userId, amount],
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
    await grantGrowth(env, userId, reward.amount)
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
   * 动作：claim=原生领取；goto=社群外链;bind_telegram/code_redeem/manual_review=社群验证;
   * open_module=跳到既有入口，不由任务引擎领取（如 checkin/deposit/games/team_center）
   */
  action: { kind: 'claim' | 'goto' | 'bind_telegram' | 'code_redeem' | 'manual_review' | 'open_module'; url?: string; target?: string; verifyStrategy?: string }
}

interface SocialRow {
  task_key: string
  platform: 'telegram' | 'facebook' | 'viber'
  verify_strategy: 'tg_member' | 'code_redeem' | 'manual_review' | 'bind_only'
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

export async function getTaskCenter(env: Env, userId: string): Promise<TaskCenter> {
  const empty: TaskCenter = { groups: { newbie: [], daily: [], achievement: [], social: [] } }
  if (!isMysqlEnabled(env)) return empty
  const pool = getMysqlPool(env)
  const cfg = await getTaskConfig(env)
  const today = manilaToday()

  const nativeEnabled = NATIVE_TASKS.filter((d) => cfg[d.id]?.enabled)
  const claimed = await claimedPeriods(pool, userId, nativeEnabled.map((d) => d.id))

  const cards: TaskCard[] = []
  for (const def of nativeEnabled) {
    const c = cfg[def.id]
    const pk = periodKey(def, today)
    const isClaimed = claimed.has(`${def.id}:${pk}`)
    let status: TaskCard['status']
    if (isClaimed) status = 'done'
    else status = (await isEligible(env, userId, def, c)) ? 'claimable' : 'locked'
    let progress: TaskCard['progress']
    if (def.id === 'invite_milestone') {
      progress = { current: await inviteeCount(pool, userId), target: Math.max(1, c.threshold) }
    }
    cards.push({
      id: def.id, group: def.group, title: def.title, subtitle: def.subtitle, status, progress,
      reward: { type: c.rewardType, amount: c.amount, spin: c.spin, currency: c.currency, turnoverX: c.turnoverX },
      action: status === 'locked' && def.todoTarget
        ? { kind: 'open_module', target: def.todoTarget }
        : { kind: 'claim' },
    })
  }

  // 社群任务
  const socials = await loadSocialConfigs(pool, true)
  const socialClaimed = await socialClaimedKeys(pool, userId, socials.map((s) => s.task_key))
  const socialCards: TaskCard[] = socials.map((s) => {
    const done = socialClaimed.has(s.task_key)
    const kind: TaskCard['action']['kind'] =
      s.verify_strategy === 'bind_only' ? 'bind_telegram'
      : s.verify_strategy === 'code_redeem' ? 'code_redeem'
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

  // 聚合层：把散落的老模块（签到/trial/appdl/首充/生日）读现状串成任务卡（display-only，跳各自入口）
  const agg = await buildAggregatedCards(env, userId)
  out.groups.newbie.push(...agg.newbie)
  out.groups.daily.unshift(...agg.daily)         // 签到置每日区首位
  out.groups.achievement.push(...agg.achievement)
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

  const user = await getUser(env, userId).catch(() => null)
  const promo = await getPromoConfig(env).catch(() => null)

  if (promo?.trial.enabled) {
    newbie.push(aggCard('agg_trial', '领取新手体验金', '完成手机验证即可领取', Boolean(user?.trialClaimed), 'trial_bonus', zeroReward('cash', promo.trial.amount), 'newbie'))
  }
  if (promo?.appdl.enabled) {
    const [[c]] = await pool.query<RowDataPacket[]>('SELECT 1 AS ok FROM bg_app_download_claim WHERE user_id = ? LIMIT 1', [userId])
    newbie.push(aggCard('agg_appdl', '下载 App 领礼金', '安装 App / PWA 一次性奖励', Boolean(c), 'app_download', zeroReward('cash', promo.appdl.amount), 'newbie'))
  }
  if (promo?.firstdep.enabled) {
    newbie.push(aggCard('agg_firstdep', '完成首充', '首次充值即得彩金', Boolean(user?.firstDepClaimed), 'deposit', zeroReward('cash', 0), 'newbie'))
  }
  // 生日只来自 KYC 证件：未设置时引导去实名认证，KYC 已通过的历史用户在 ensure 内懒回填
  const birthdaySet = await ensureBirthdayFromKyc(env, userId).catch(() => false)
  newbie.push(aggCard('agg_birthday', '解锁生日礼金', '完成实名认证，自动同步证件生日', birthdaySet, 'kyc', zeroReward('cash', 0), 'newbie'))

  const ck = await getCheckinStatus(env, userId).catch(() => null)
  if (ck?.enabled) {
    daily.push(aggCard('agg_checkin', '每日签到', ck.todayClaimed ? '今日已签到' : '签到领取抽奖次数', ck.todayClaimed, 'checkin', zeroReward('spin', 0, 1), 'daily'))
    for (const m of ck.milestones) {
      achievement.push(aggCard(
        `agg_checkin_ms_${m.atDays}`, `本月签到 ${m.atDays} 天`, '达成额外奖励',
        m.reached, 'checkin', zeroReward('spin', 0, m.n), 'achievement',
        { current: Math.min(ck.monthDays, m.atDays), target: m.atDays },
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

export async function claimTask(env: Env, userId: string, taskId: string): Promise<ClaimResult> {
  if (!isMysqlEnabled(env)) throw new Error('storage unavailable')
  const def = NATIVE_BY_ID.get(taskId)
  if (!def) throw new Error('unknown task')
  const cfg = await getTaskConfig(env)
  const c = cfg[taskId]
  if (!c?.enabled) throw new Error('disabled')

  const eligible = await isEligible(env, userId, def, c)
  if (!eligible) throw new Error('not eligible')

  const pool = getMysqlPool(env)
  const pk = periodKey(def, manilaToday())
  // INSERT IGNORE 作为幂等闸门：先落领取记录，再发奖
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO bg_task_claim
       (user_id, task_id, period_key, reward_type, currency, reward_amount, reward_spin, turnover_x)
     VALUES (?,?,?,?,?,?,?,?)`,
    [userId, taskId, pk, c.rewardType, c.currency, c.amount, c.spin, c.turnoverX],
  )
  if (res.affectedRows === 0) throw new Error('already claimed')

  const reward = rewardOf(c)
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
 *  - bind_only     校验已绑定 Telegram
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
    case 'bind_only': {
      const tgId = await getUserTgId(env, userId)
      if (!tgId) throw new Error('need_bind_telegram')
      break
    }
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
