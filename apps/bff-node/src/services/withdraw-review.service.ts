import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import type { OrderWithdraw } from '../types/domain.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getWithdraw } from './store/index.js'
import { getWithdrawGate } from './turnover.service.js'
import { approveWithdraw } from './withdraw-approve.service.js'
import { broadcastBadges } from './sse-badges.js'
import { notifyWithdrawManual } from './admin-notify.js'
import { recommendedUserReasonForRule } from './withdraw-reject-reason.service.js'
import { compareKycNames } from './kyc.service.js'
import { getRate } from './exchange-rate.service.js'

// ── 规则结果 / 上下文 ─────────────────────────────────────────────────────────

export type RuleVerdict = 'pass' | 'manual' | 'skipped' | 'error'
export type ReviewVerdict = 'pass' | 'manual'

export interface RuleResult {
  code: string
  verdict: RuleVerdict
  actualValue?: number
  threshold?: number
  detail?: Record<string, unknown>
}

export interface RuleConfig {
  enabled: boolean
  threshold: number | null
  params: Record<string, unknown> | null
}

interface ReviewContext {
  pool: Pool
  order: OrderWithdraw
  /** 统计窗口起点：上次成功取款时间，无则注册时间 */
  since: string
  // 资金面（窗口内，PHP 元。跨币种已折 PHP 等值）
  depositPhp: number
  deposit24hPhp: number
  lifetimeDepositCount: number
  /** 历史累计真实存款（全周期，PHP 元） */
  lifetimeDepositPhp: number
  /** 本次取款金额（折 PHP 元） */
  withdrawPhp: number
  /** 本次取款币种折 PHP 汇率 */
  orderCurrencyToPhpRate: number
  /** 净盈利：投注盈亏 + 游戏内 bonus 通道派彩（PHP 元）。已含 gameBonusPhp。 */
  profitPhp: number
  profit24hPhp: number
  /** 游戏厂商 bonus 通道派彩（老虎机 feature/免费游戏，走 type=bonus ref_type=game），PHP 元 */
  gameBonusPhp: number
  gameBonus24hPhp: number
  bonusPhp: number
  completedWithdrawCount: number
  // 关系/风控面
  uplineBlacklisted: boolean
  kycStatus: string
  kycFullName: string
  kycReviewedAt: Date | null
  targetOwner: string
  targetAccount: string
  withdrawAccountOtherUsers: number
  withdrawOwnerOtherUsers: number
  /** 与本人 KYC 实名模糊同名的其他 approved 账号 userId 列表（same_name_review 用） */
  sameNameOtherUsers: string[]
  minutesSinceKycApproved: number | null
  /** 未完成的优惠流水（required-completed，PHP 分） */
  promoTurnoverRemaining: number
  /** 近30天共用同 IP 的其他账号数 */
  relatedIpAccounts: number
  /** 近30天共用同 device_id 的其他账号数 */
  relatedDeviceIdAccounts: number
  /** 近30天共用同硬件指纹的其他账号数 */
  relatedDeviceFpAccounts: number
  // 设备画像(可解释字段,仅供人工复核参考,不参与判定)
  /** 该用户登录日志中最早出现时间(ISO),空串=无登录记录 */
  firstSeenAt: string
  /** 历史用过的不同 device_id 数(换设备次数 ≈ 该值 - 1) */
  deviceIdCount: number
  /** 历史用过的不同硬件指纹数 */
  fpCount: number
  /** 设备信号可信度:client(有 device_id) | fp(仅硬件指纹) | none(无设备信号) */
  deviceTrustLevel: string
  /** 窗口内"有派彩无下注"的异常 round 数 */
  tamperOrphanRounds: number
  /** 作为收益人累计佣金（PHP 元） */
  commissionEarnedPhp: number
  /** 名下下线累计 GGR（PHP 元，可为负） */
  commissionDownlineGgrPhp: number
  /** 佣金重复入账组数 */
  commissionDupGroups: number
  /** 568Win 数据面统计（上游对账/彩金/取消） */
  win568: Win568ReviewStats
}

export const RULE_META: Record<string, { name: string; desc: string }> = {
  turnover:                  { name: '流水检查', desc: '复核「上次成功取款至今」窗口内的有效投注流水是否达到打码要求；未达标则转人工（与请求路径的流水闸门一致，此处兜底）。' },
  large_amount:             { name: '大额取款', desc: '本次取款金额超过设定阈值转人工；按币种分别设阈（php=法币元/比索，usdt=Matrix 链上 USDT）。' },
  large_profit:             { name: '大额盈利', desc: '统计窗口内的净盈利（投注盈亏＋游戏bonus通道派彩）超过对应取款币种阈值转人工；USDC 共用 USDT 阈值。' },
  high_multiple_profit:     { name: '高倍盈利', desc: '窗口内 净盈利 ÷ 累计存款 的倍数 ≥ 阈值倍数转人工；无存款时跳过。' },
  high_multiple_profit_24h: { name: '24小时高倍盈利', desc: '近 24 小时内 盈利 ÷ 存款 的倍数 ≥ 阈值倍数转人工，用于抓短时暴赚；近 24h 无存款时跳过。' },
  withdraw_deposit_ratio:   { name: '取款存款倍数', desc: '本次取款额 ÷ 历史累计真实存款 的倍数 ≥ 阈值转人工。不依赖盈利口径，直接抓「小存大取」（如存110取5000=45x），可拦到赢利经 bonus 通道套现、被盈利规则漏看的情形；无真实存款时跳过（交由存款来源/首次取款规则）。' },
  deposit_source:           { name: '存款来源', desc: '账号历史从未有过真实成功存款（即纯靠彩金/盈利出款）转人工。' },
  total_bonus:              { name: '总优惠金额', desc: '累计已发放优惠超过对应取款币种阈值转人工；统计 bonus、红包、返水、VIP 与任务奖励，排除游戏派彩。' },
  first_withdraw_no_deposit:{ name: '首次取款', desc: '该账号此前无任何成功取款，且历史无真实存款，首次取款即转人工。' },
  upline_blacklist:         { name: '上线黑名单', desc: '该用户的邀请人（上线）处于封禁/冻结或风控黑名单中，则本次取款转人工。' },
  same_ip:                  { name: '同IP', desc: '近30天与其它账号共用同一 IP 的数量 ≥ 阈值时转人工。' },
  same_device_id:           { name: '同设备ID', desc: '近30天同一 device_id 下账号总数（含本人）≥ 阈值时转人工。' },
  same_device_fp:           { name: '同设备指纹', desc: '近30天同一硬件指纹 fp_visitor 下账号总数（含本人）≥ 阈值时转人工。' },
  kyc_name_mismatch:        { name: '实名户名不一致', desc: '提现户名与 KYC 实名姓名不完全一致时转人工；匹配算法会忽略大小写、标点、多余空格，并识别中间名缩写/姓名顺序差异。' },
  withdraw_account_reuse:   { name: '提现账号复用', desc: '同一提现账号被其它用户使用过，达到阈值即转人工。默认 1 个其它用户。' },
  withdraw_owner_reuse:     { name: '提现户名复用', desc: '同一提现户名被多个其它用户使用过，达到阈值即转人工。默认 2 个其它用户。' },
  same_name_review:         { name: '同名账号', desc: '本人 KYC 实名与其它已通过 KYC 的账号做模糊比对（忽略大小写/标点/中间名缩写/姓名顺序/多空格），命中同名的其它账号数 ≥ 阈值即转人工，用于抓一人多开或团伙用同一实名。默认 1 个。' },
  fast_withdraw_after_kyc:  { name: 'KYC后快速提现', desc: 'KYC 通过后短时间内立即提现，达到配置分钟阈值内则转人工。默认 10 分钟。' },
  promo_turnover:           { name: '优惠流水', desc: '存在已领取但尚未打完所需流水的优惠（剩余打码 > 0）则转人工。' },
  tampered_bet:             { name: '篡改注单', desc: '存在无对应投注却凭空派彩的 round，疑似数据被篡改，转人工。' },
  commission_anomaly:       { name: '三级分销佣金', desc: '三级分销佣金出现重复入账，或自身有佣金收益但下线累计 GGR ≤ 0（疑似刷佣），转人工。' },
  upstream_reconcile:       { name: '上游对账', desc: '窗口内本地已结算注单与 568Win 报表按 RefNo 双边核对：本地有上游无（伪造注单）、投注额不符（篡改）、上游已作废但本地已派彩（回滚遗漏）任一命中转人工。报表同步停摆时跳过不拦截。' },
  bonus_bet_abuse:          { name: '上游彩金异常', desc: '玩家领取的平台活动奖金（奖池、锦标赛、抽奖等）总额或笔数超过设定值，疑似专薅活动羊毛，转人工。不含老虎机免费旋转中奖。（目前平台未开此类活动，暂不触发。）' },
  feature_bonus_ratio:      { name: '老虎机彩金倍数', desc: '玩家老虎机免费旋转赢的钱 ÷ 真实充值 ≥ 设定倍数即转人工（如充 500 赢 6000＝12 倍），抓小额充值靠彩金爆量套现；无真实充值则跳过。' },
  cancel_pattern:           { name: '取消注单异常', desc: '窗口内被作废（Void）的注单笔数 ≥ 阈值且占比 ≥ params.ratio，疑似利用取消机制套利，转人工。' },
  risk_hit:                 { name: '风控命中', desc: '风控模块在本次取款请求上命中了 escalate/deny 动作（如用户/IP/设备在风控名单中），转人工。窗口 params.windowMins 分钟。' },
  commission_surge:         { name: '佣金激增', desc: '（佣金提现专用）窗口内佣金超过之前 30 天佣金总和 × params.mult，且不低于对应提现币种起查额，疑似速成刷佣，转人工。' },
  fresh_downline_commission:{ name: '新号佣金占比', desc: '（佣金提现专用）窗口内来自「注册 ≤ params.days 天下线」的佣金占比达到 params.ratio，且总额不低于对应提现币种起查额，转人工。' },
  commission_deposit_ratio: { name: '佣金存款比', desc: '（佣金提现专用）累计佣金超过下线累计真实存款 × params.ratio，且不低于对应提现币种起查额，转人工。' },
  downline_ip_overlap:      { name: '下线同IP', desc: '（佣金提现专用）近 30 天与团队长共用 IP 的下线账号数 ≥ 阈值，疑似自己给自己当下线，转人工。' },
}

// ── 568Win 数据面统计：user 与 team 审核共用 ─────────────────────────────────

export interface Win568ReviewStats {
  /** 报表同步水位（UTC ms），null=从未同步 */
  watermarkMs: number | null
  /** 报表覆盖起点（UTC ms），早于它结算的注单不在报表里，不参与对账 */
  coverageStartMs: number | null
  reconcileChecked: number
  reconcileMissing: number
  reconcileStakeMismatch: number
  reconcileVoidPaid: number
  bonusCount: number
  /** 上游活动彩金入账总额（PHP 元） */
  bonusAmountPhp: number
  /** 游戏内 feature/免费旋转派彩总额（IsGameProviderPromotion=false，PHP 元） */
  featureBonusPhp: number
  betTxnCount: number
  voidTxnCount: number
}

/** 水位超过此时限视为报表同步停摆，对账规则跳过不拦截 */
const RECONCILE_WATERMARK_MAX_AGE_MS = 2 * 60 * 60 * 1000

export function reconcileGraceMinutes(config: Record<string, RuleConfig>): number {
  const n = Number(config.upstream_reconcile?.params?.graceMinutes ?? 30)
  return Number.isFinite(n) && n >= 0 ? n : 30
}

/**
 * 统计窗口内 568Win 无缝钱包交易面指标。
 * 对账只核对「结算时间早于 水位-graceMinutes」的注单，给上游报表管道留时间，避免同步滞后误报。
 */
export async function buildWin568ReviewStats(
  pool: Pool,
  userId: string,
  since: Date,
  graceMinutes: number,
  usdRate = 1,
): Promise<Win568ReviewStats> {
  const [wmRows] = await pool.query<RowDataPacket[]>(
    `SELECT \`key\`, \`value\` FROM bg_admin_settings
     WHERE \`key\` IN ('win568_report_sync_watermark', 'win568_report_sync_coverage_start')`,
  )
  const parseSetting = (key: string): number | null => {
    const row = wmRows.find((r) => String(r.key) === key)
    const ts = row?.value ? Date.parse(String(row.value)) : NaN
    return Number.isFinite(ts) ? ts : null
  }
  const watermarkMs = parseSetting('win568_report_sync_watermark')
  const coverageStartMs = parseSetting('win568_report_sync_coverage_start')

  const [[txn]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(txn_type = 'bet'), 0) AS bet_cnt,
       COALESCE(SUM(txn_type = 'bet' AND status = 'Void'), 0) AS void_cnt,
       COALESCE(SUM(txn_type = 'bonus' AND status <> 'Void' AND COALESCE(raw_request->>'$.IsGameProviderPromotion', '') <> 'false'), 0) AS bonus_cnt,
       COALESCE(SUM(CASE WHEN txn_type = 'bonus' AND status <> 'Void' AND COALESCE(raw_request->>'$.IsGameProviderPromotion', '') <> 'false' THEN amount * (CASE WHEN currency IN ('USDT','USDC','USD') THEN ? ELSE 1 END) ELSE 0 END), 0) AS bonus_amt,
       COALESCE(SUM(CASE WHEN txn_type = 'bonus' AND status <> 'Void' AND raw_request->>'$.IsGameProviderPromotion' = 'false' THEN amount * (CASE WHEN currency IN ('USDT','USDC','USD') THEN ? ELSE 1 END) ELSE 0 END), 0) AS feature_bonus_amt
     FROM bg_568win_wallet_txn WHERE user_id = ? AND created_at > ?`,
    [usdRate, usdRate, userId, since],
  )

  let checked = 0, missing = 0, stakeMismatch = 0, voidPaid = 0
  if (watermarkMs !== null && coverageStartMs !== null) {
    // 对账范围：[max(窗口起点, 报表覆盖起点), 水位-grace]，两头都收敛避免报表天然缺数据的误报
    const lower = new Date(Math.max(since.getTime(), coverageStartMs))
    const bound = new Date(watermarkMs - graceMinutes * 60_000)
    // PT9 同一 transfer_code 可有多笔 transaction，按 transfer_code 聚合后与报表 refNo 对齐
    const [[rec]] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS checked,
         COALESCE(SUM(has_report = 0), 0) AS missing,
         COALESCE(SUM(has_report = 1 AND report_stake IS NOT NULL
                      AND ABS(report_stake * unit - amount) > 0.01 * unit), 0) AS stake_mismatch,
         COALESCE(SUM(win_loss > 0 AND report_void = 1), 0) AS void_paid
       FROM (
         SELECT t.transfer_code,
                -- 568Win 报表的 IDR 金额是千卢比（与 core-node win568-wallet.service 的
                -- amountFactor 同一约定），而 wallet_txn.amount 是实际卢比。不折算的话
                -- 每笔 IDR 注单都会被判成对账不符，把 IDR 用户的提现全推去人工审核。
                IF(t.currency = 'IDR', 1000, 1) AS unit,
                SUM(t.amount) AS amount,
                COALESCE(SUM(t.win_loss), 0) AS win_loss,
                EXISTS(SELECT 1 FROM bg_568win_report_bet r WHERE r.ref_no = t.transfer_code) AS has_report,
                (SELECT MAX(r.stake) FROM bg_568win_report_bet r WHERE r.ref_no = t.transfer_code) AS report_stake,
                EXISTS(SELECT 1 FROM bg_568win_report_bet r
                       WHERE r.ref_no = t.transfer_code AND LOWER(COALESCE(r.status, '')) LIKE '%void%') AS report_void
         FROM bg_568win_wallet_txn t
         WHERE t.user_id = ? AND t.txn_type = 'bet' AND t.status = 'settled'
           AND t.settled_at > ? AND t.settled_at < ?
         GROUP BY t.transfer_code, t.currency
       ) x`,
      [userId, lower, bound],
    )
    checked = Number(rec?.checked ?? 0)
    missing = Number(rec?.missing ?? 0)
    stakeMismatch = Number(rec?.stake_mismatch ?? 0)
    voidPaid = Number(rec?.void_paid ?? 0)
  }

  return {
    watermarkMs,
    coverageStartMs,
    reconcileChecked: checked,
    reconcileMissing: missing,
    reconcileStakeMismatch: stakeMismatch,
    reconcileVoidPaid: voidPaid,
    bonusCount: Number(txn?.bonus_cnt ?? 0),
    bonusAmountPhp: Number(txn?.bonus_amt ?? 0),
    featureBonusPhp: Number(txn?.feature_bonus_amt ?? 0),
    betTxnCount: Number(txn?.bet_cnt ?? 0),
    voidTxnCount: Number(txn?.void_cnt ?? 0),
  }
}

export function evalUpstreamReconcile(stats: Win568ReviewStats): RuleResult {
  if (stats.watermarkMs === null || stats.coverageStartMs === null) {
    return { code: 'upstream_reconcile', verdict: 'skipped', detail: { reason: 'report sync not ready' } }
  }
  if (Date.now() - stats.watermarkMs > RECONCILE_WATERMARK_MAX_AGE_MS) {
    return {
      code: 'upstream_reconcile',
      verdict: 'skipped',
      detail: { reason: 'report sync stale', watermark: new Date(stats.watermarkMs).toISOString() },
    }
  }
  const diff = stats.reconcileMissing + stats.reconcileStakeMismatch + stats.reconcileVoidPaid
  return {
    code: 'upstream_reconcile',
    verdict: diff > 0 ? 'manual' : 'pass',
    actualValue: diff,
    detail: {
      checked: stats.reconcileChecked,
      missing: stats.reconcileMissing,
      stakeMismatch: stats.reconcileStakeMismatch,
      voidPaid: stats.reconcileVoidPaid,
    },
  }
}

function extraText(order: OrderWithdraw, key: string): string {
  const value = order.extraData?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function minutesBetween(start: Date | null, endIso: string): number | null {
  if (!start) return null
  const end = Date.parse(endIso)
  const startMs = start.getTime()
  if (!Number.isFinite(end) || !Number.isFinite(startMs)) return null
  return Math.max(0, Math.round((end - startMs) / 60000))
}

// ── 规则集：默认 pass，仅命中异常才 manual ─────────────────────────────────────

type Rule = (ctx: ReviewContext, cfg: RuleConfig) => Promise<RuleResult> | RuleResult

const RULES: Record<string, Rule> = {
  async turnover(ctx) {
    // 存款 1 倍流水清零即过；彩金锁定额在下单时已按可提额校验过
    const gate = await getWithdrawGate(ctx.pool, ctx.order.userId, ctx.order.currency)
    return { code: 'turnover', verdict: gate.ok ? 'pass' : 'manual' }
  },

  large_amount(ctx, cfg) {
    const params = cfg.params ?? {}
    const thresholdKey = ctx.order.currency === 'IDR'
      ? 'idr'
      : ctx.order.currency === 'USDT' || ctx.order.currency === 'USDC' || ctx.order.channelId === 'matrix' ? 'usdt' : 'php'
    const threshold = Number(params[thresholdKey])
    if (!Number.isFinite(threshold) || threshold <= 0) return { code: 'large_amount', verdict: 'pass' }
    const hit = ctx.order.amount > threshold
    return { code: 'large_amount', verdict: hit ? 'manual' : 'pass', actualValue: ctx.order.amount, threshold }
  },

  large_profit(ctx, cfg) {
    const threshold = currencyAmountThreshold(ctx, cfg)
    if (threshold <= 0) return { code: 'large_profit', verdict: 'pass' }
    const profit = phpAmountInOrderCurrency(ctx, ctx.profitPhp)
    const hit = profit > threshold
    return { code: 'large_profit', verdict: hit ? 'manual' : 'pass', actualValue: profit, threshold, detail: { currency: ctx.order.currency } }
  },

  high_multiple_profit(ctx, cfg) {
    const mult = Number(cfg.threshold ?? 0)
    if (mult <= 0 || ctx.depositPhp <= 0) return { code: 'high_multiple_profit', verdict: 'pass', detail: { depositPhp: ctx.depositPhp } }
    const ratio = ctx.profitPhp / ctx.depositPhp
    return { code: 'high_multiple_profit', verdict: ratio >= mult ? 'manual' : 'pass', actualValue: round2(ratio), threshold: mult }
  },

  high_multiple_profit_24h(ctx, cfg) {
    const mult = Number(cfg.threshold ?? 0)
    if (mult <= 0 || ctx.deposit24hPhp <= 0) return { code: 'high_multiple_profit_24h', verdict: 'pass', detail: { deposit24hPhp: ctx.deposit24hPhp } }
    const ratio = ctx.profit24hPhp / ctx.deposit24hPhp
    return { code: 'high_multiple_profit_24h', verdict: ratio >= mult ? 'manual' : 'pass', actualValue: round2(ratio), threshold: mult }
  },

  // 本次取款额 ÷ 历史累计真实存款 的倍数超阈值转人工。不依赖 profit 口径，
  // 直接抓「存110取5000」这类小存大取（哪怕赢利来自 bonus 通道、被 profit 规则漏看）。
  withdraw_deposit_ratio(ctx, cfg) {
    const mult = Number(cfg.threshold ?? 0)
    // 无真实存款交由 deposit_source / first_withdraw_no_deposit 处置，这里不重复拦
    if (mult <= 0 || ctx.lifetimeDepositPhp <= 0) {
      return { code: 'withdraw_deposit_ratio', verdict: 'pass', detail: { lifetimeDepositPhp: ctx.lifetimeDepositPhp } }
    }
    const ratio = ctx.withdrawPhp / ctx.lifetimeDepositPhp
    return {
      code: 'withdraw_deposit_ratio',
      verdict: ratio >= mult ? 'manual' : 'pass',
      actualValue: round2(ratio),
      threshold: mult,
      detail: { withdrawPhp: ctx.withdrawPhp, lifetimeDepositPhp: ctx.lifetimeDepositPhp },
    }
  },

  deposit_source(ctx) {
    const hit = ctx.lifetimeDepositCount === 0
    return { code: 'deposit_source', verdict: hit ? 'manual' : 'pass', detail: { lifetimeDepositCount: ctx.lifetimeDepositCount } }
  },

  total_bonus(ctx, cfg) {
    const threshold = currencyAmountThreshold(ctx, cfg)
    if (threshold <= 0) return { code: 'total_bonus', verdict: 'pass' }
    const bonus = phpAmountInOrderCurrency(ctx, ctx.bonusPhp)
    const hit = bonus > threshold
    return { code: 'total_bonus', verdict: hit ? 'manual' : 'pass', actualValue: bonus, threshold, detail: { currency: ctx.order.currency } }
  },

  first_withdraw_no_deposit(ctx) {
    const hit = ctx.completedWithdrawCount === 0 && ctx.lifetimeDepositCount === 0
    return { code: 'first_withdraw_no_deposit', verdict: hit ? 'manual' : 'pass' }
  },

  upline_blacklist(ctx) {
    return { code: 'upline_blacklist', verdict: ctx.uplineBlacklisted ? 'manual' : 'pass' }
  },

  same_ip(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 3)
    const hit = ctx.relatedIpAccounts >= threshold
    return { code: 'same_ip', verdict: hit ? 'manual' : 'pass', actualValue: ctx.relatedIpAccounts, threshold }
  },

  same_device_id(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 2)
    const accountsTotal = ctx.relatedDeviceIdAccounts + 1
    const hit = accountsTotal >= threshold
    return {
      code: 'same_device_id',
      verdict: hit ? 'manual' : 'pass',
      actualValue: accountsTotal,
      threshold,
      detail: { relatedDeviceIdAccounts: ctx.relatedDeviceIdAccounts, accountsTotal },
    }
  },

  same_device_fp(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 2)
    const accountsTotal = ctx.relatedDeviceFpAccounts + 1
    const hit = accountsTotal >= threshold
    return {
      code: 'same_device_fp',
      verdict: hit ? 'manual' : 'pass',
      actualValue: accountsTotal,
      threshold,
      detail: { relatedDeviceFpAccounts: ctx.relatedDeviceFpAccounts, accountsTotal },
    }
  },

  kyc_name_mismatch(ctx) {
    if (!ctx.kycFullName || !ctx.targetOwner) {
      return {
        code: 'kyc_name_mismatch',
        verdict: 'manual',
        detail: { reason: ctx.kycFullName ? 'missing target owner' : 'missing kyc name' },
      }
    }
    const match = compareKycNames(ctx.targetOwner, ctx.kycFullName)
    const exact = match.matched && match.reason === 'exact'
    return {
      code: 'kyc_name_mismatch',
      verdict: exact ? 'pass' : 'manual',
      detail: {
        matched: match.matched,
        reason: match.reason,
        targetOwnerTokenCount: match.inputTokens.length,
        kycNameTokenCount: match.documentTokens.length,
      },
    }
  },

  withdraw_account_reuse(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 1)
    if (!ctx.targetAccount || threshold <= 0) return { code: 'withdraw_account_reuse', verdict: 'pass' }
    return {
      code: 'withdraw_account_reuse',
      verdict: ctx.withdrawAccountOtherUsers >= threshold ? 'manual' : 'pass',
      actualValue: ctx.withdrawAccountOtherUsers,
      threshold,
    }
  },

  withdraw_owner_reuse(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 2)
    if (!ctx.targetOwner || threshold <= 0) return { code: 'withdraw_owner_reuse', verdict: 'pass' }
    return {
      code: 'withdraw_owner_reuse',
      verdict: ctx.withdrawOwnerOtherUsers >= threshold ? 'manual' : 'pass',
      actualValue: ctx.withdrawOwnerOtherUsers,
      threshold,
    }
  },

  same_name_review(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 1)
    if (!ctx.kycFullName || threshold <= 0) return { code: 'same_name_review', verdict: 'pass' }
    const count = ctx.sameNameOtherUsers.length
    return {
      code: 'same_name_review',
      verdict: count >= threshold ? 'manual' : 'pass',
      actualValue: count,
      threshold,
      detail: { matchedUserIds: ctx.sameNameOtherUsers },
    }
  },

  fast_withdraw_after_kyc(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 10)
    if (ctx.minutesSinceKycApproved == null || threshold <= 0) {
      return { code: 'fast_withdraw_after_kyc', verdict: 'pass' }
    }
    return {
      code: 'fast_withdraw_after_kyc',
      verdict: ctx.minutesSinceKycApproved <= threshold ? 'manual' : 'pass',
      actualValue: ctx.minutesSinceKycApproved,
      threshold,
    }
  },

  promo_turnover(ctx) {
    const hit = ctx.promoTurnoverRemaining > 0
    return { code: 'promo_turnover', verdict: hit ? 'manual' : 'pass', actualValue: ctx.promoTurnoverRemaining }
  },

  tampered_bet(ctx) {
    const hit = ctx.tamperOrphanRounds > 0
    return {
      code: 'tampered_bet',
      verdict: hit ? 'manual' : 'pass',
      detail: { orphanRounds: ctx.tamperOrphanRounds },
    }
  },

  commission_anomaly(ctx) {
    const dup = ctx.commissionDupGroups > 0
    const noGgr = ctx.commissionEarnedPhp > 0 && ctx.commissionDownlineGgrPhp <= 0
    return {
      code: 'commission_anomaly',
      verdict: dup || noGgr ? 'manual' : 'pass',
      detail: {
        dupGroups: ctx.commissionDupGroups,
        earnedPhp: ctx.commissionEarnedPhp,
        downlineGgrPhp: ctx.commissionDownlineGgrPhp,
      },
    }
  },

  upstream_reconcile(ctx) {
    return evalUpstreamReconcile(ctx.win568)
  },

  bonus_bet_abuse(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 0)
    const countTh = Number(cfg.params?.count ?? 0)
    const amtHit = threshold > 0 && ctx.win568.bonusAmountPhp > threshold
    const cntHit = countTh > 0 && ctx.win568.bonusCount >= countTh
    return {
      code: 'bonus_bet_abuse',
      verdict: amtHit || cntHit ? 'manual' : 'pass',
      actualValue: round2(ctx.win568.bonusAmountPhp),
      threshold: threshold > 0 ? threshold : undefined,
      detail: { bonusCount: ctx.win568.bonusCount, countThreshold: countTh },
    }
  },

  feature_bonus_ratio(ctx, cfg) {
    const mult = Number(cfg.threshold ?? 0)
    // 无真实存款交由 deposit_source / first_withdraw_no_deposit 处置，这里不重复拦
    if (mult <= 0 || ctx.lifetimeDepositPhp <= 0) {
      return { code: 'feature_bonus_ratio', verdict: 'pass', detail: { featureBonusPhp: round2(ctx.win568.featureBonusPhp), lifetimeDepositPhp: ctx.lifetimeDepositPhp } }
    }
    const ratio = ctx.win568.featureBonusPhp / ctx.lifetimeDepositPhp
    return {
      code: 'feature_bonus_ratio',
      verdict: ratio >= mult ? 'manual' : 'pass',
      actualValue: round2(ratio),
      threshold: mult,
      detail: { featureBonusPhp: round2(ctx.win568.featureBonusPhp), lifetimeDepositPhp: ctx.lifetimeDepositPhp },
    }
  },

  cancel_pattern(ctx, cfg) {
    const minCount = Number(cfg.threshold ?? 0)
    const ratioTh = Number(cfg.params?.ratio ?? 0.3)
    const total = ctx.win568.betTxnCount
    const voided = ctx.win568.voidTxnCount
    const ratio = total > 0 ? voided / total : 0
    const hit = minCount > 0 && voided >= minCount && ratio >= ratioTh
    return {
      code: 'cancel_pattern',
      verdict: hit ? 'manual' : 'pass',
      actualValue: voided,
      threshold: minCount > 0 ? minCount : undefined,
      detail: { totalBets: total, voidRatio: round2(ratio), ratioThreshold: ratioTh },
    }
  },

  // 风控模块通过 bg_risk_hit_log 把「这个人有问题」交给审核模块处置。
  // 风控在创建提现单时已判定并落日志（那时才拿得到 ip/device），此处只读结论。
  async risk_hit(ctx, cfg) {
    const windowMins = Number(cfg.params?.windowMins ?? 10)
    const [rows] = await ctx.pool.query<RowDataPacket[]>(
      `SELECT rule_code FROM bg_risk_hit_log
        WHERE user_id = ? AND checkpoint = 'withdraw' AND action IN ('escalate','deny')
          AND created_at >= DATE_SUB(NOW(3), INTERVAL ? MINUTE)
        ORDER BY id DESC LIMIT 1`,
      [ctx.order.userId, windowMins],
    )
    const hit = rows.length > 0
    return {
      code: 'risk_hit',
      verdict: hit ? 'manual' : 'pass',
      detail: hit ? { riskRule: String(rows[0].rule_code), windowMins } : undefined,
    }
  },
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

function currencyAmountThreshold(ctx: ReviewContext, cfg: RuleConfig): number {
  const params = cfg.params ?? {}
  const key = ctx.order.currency === 'IDR'
    ? 'idr'
    : ctx.order.currency === 'USDT' || ctx.order.currency === 'USDC' || ctx.order.channelId === 'matrix'
      ? 'usdt'
      : 'php'
  const configured = Number(params[key])
  return Number.isFinite(configured) ? configured : Number(cfg.threshold ?? 0)
}

function phpAmountInOrderCurrency(ctx: ReviewContext, phpAmount: number): number {
  return round2(phpAmount / ctx.orderCurrencyToPhpRate)
}

// 弱关联类信号:不再单独转人工,改累加权重评分(权重见 _score_policy 配置)。
// 收款账号复用 withdraw_account_reuse 刻意不在池内 —— 保留硬闸门(两个陌生人几乎不可能填同一收款账号)。
const SCORE_POOL = new Set(['same_ip', 'same_device_id', 'same_device_fp', 'withdraw_owner_reuse'])

// ── 配置加载 ──────────────────────────────────────────────────────────────────

export type ReviewScope = 'user' | 'team'

export async function loadReviewConfig(pool: Pool, scope: ReviewScope = 'user'): Promise<Record<string, RuleConfig>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, enabled, threshold, params FROM bg_withdraw_review_config WHERE scope = ?`,
    [scope],
  )
  const out: Record<string, RuleConfig> = {}
  for (const r of rows) {
    out[String(r.rule_code)] = {
      enabled: Boolean(r.enabled),
      threshold: r.threshold == null ? null : Number(r.threshold),
      params: r.params == null ? null : (typeof r.params === 'string' ? JSON.parse(r.params) : r.params),
    }
  }
  return out
}

// 与本人 KYC 实名模糊同名的其它 approved 账号。模糊比对是 JS 算法(compareKycNames)无法 SQL 化,
// 只能拉全量 approved 实名在内存逐条比。approved 规模变大成为瓶颈时,再加姓名 token 索引表缩候选。
// 审核时(buildContext)与提案详情展示(admin/review.routes)共用,保证判定口径单一来源。
export async function findSameNameUsers(pool: Pool, userId: string, kycFullName: string): Promise<string[]> {
  if (!kycFullName.trim()) return []
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_id, full_name FROM bg_kyc
     WHERE status = 'approved' AND user_id <> ? AND full_name IS NOT NULL AND full_name <> ''`,
    [userId],
  )
  const hits: string[] = []
  for (const r of rows) {
    if (compareKycNames(kycFullName, String(r.full_name)).matched) hits.push(String(r.user_id))
  }
  return hits
}

// ── 上下文构建 ────────────────────────────────────────────────────────────────

async function buildContext(pool: Pool, order: OrderWithdraw, config: Record<string, RuleConfig>, usdRate: number, idrRate: number): Promise<ReviewContext> {
  const userId = order.userId

  const [[user]] = await pool.query<RowDataPacket[]>(
    `SELECT u.registered_at, inv.status AS inviter_status
     FROM bg_user u LEFT JOIN bg_user inv ON inv.id = u.inviter_id
     WHERE u.id = ? LIMIT 1`,
    [userId],
  )
  const registeredAt = user?.registered_at ? new Date(user.registered_at as Date) : new Date(0)
  const uplineBlacklisted = user?.inviter_status === 'banned' || user?.inviter_status === 'frozen'
  const targetOwner = extraText(order, 'targetOwner')
  const targetAccount = extraText(order, 'targetAccount')

  const [[kyc]] = await pool.query<RowDataPacket[]>(
    `SELECT status, full_name, reviewed_at FROM bg_kyc WHERE user_id = ? LIMIT 1`,
    [userId],
  )
  const kycReviewedAt = kyc?.reviewed_at ? new Date(kyc.reviewed_at as Date) : null

  const [[wd]] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(created_at) AS last_at, COUNT(*) AS cnt
     FROM bg_withdraw_order WHERE user_id = ? AND status = 'completed'`,
    [userId],
  )
  const completedWithdrawCount = Number(wd?.cnt ?? 0)
  const sinceDate = wd?.last_at ? new Date(wd.last_at as Date) : registeredAt
  const since = sinceDate.toISOString()

  // 风控口径：跨币种统一折 PHP 等值（USDT/USDC 按 usdRate），防稳定币大额活动被 ~58x 低估而漏判审核。单位=PHP 元。
  const [[dep]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > ? THEN amount * (CASE WHEN currency IN ('USDT','USDC') THEN ? WHEN currency = 'IDR' THEN ? ELSE 1 END) END), 0) AS window_amt,
       COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL 24 HOUR THEN amount * (CASE WHEN currency IN ('USDT','USDC') THEN ? WHEN currency = 'IDR' THEN ? ELSE 1 END) END), 0) AS d24_amt,
       COALESCE(SUM(amount * (CASE WHEN currency IN ('USDT','USDC') THEN ? WHEN currency = 'IDR' THEN ? ELSE 1 END)), 0) AS lifetime_amt,
       COUNT(*) AS lifetime_cnt
     FROM bg_deposit_order WHERE user_id = ? AND status = 'paid'`,
    [sinceDate, usdRate, idrRate, usdRate, idrRate, usdRate, idrRate, userId],
  )

  // 投注盈亏（PHP 元，与 depositPhp 同口径）。
  // 派彩行按 settled_at（真实派彩时间）归窗口：回填的历史派彩行 created_at 是入库时间,
  // 按 created_at 会把全部历史赢钱塞进当前窗口/24h,导致盈利倍数误报。
  const [[bet]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN COALESCE(settled_at, created_at) > ? AND bet_type IN ('win','refund') THEN amount * (CASE WHEN currency_code IN ('USDT','USDC') THEN ? WHEN currency_code = 'IDR' THEN ? ELSE 1 END)
                         WHEN created_at > ? AND bet_type = 'bet' THEN -amount * (CASE WHEN currency_code IN ('USDT','USDC') THEN ? WHEN currency_code = 'IDR' THEN ? ELSE 1 END) ELSE 0 END), 0) AS window_profit,
       COALESCE(SUM(CASE WHEN COALESCE(settled_at, created_at) > NOW() - INTERVAL 24 HOUR AND bet_type IN ('win','refund') THEN amount * (CASE WHEN currency_code IN ('USDT','USDC') THEN ? WHEN currency_code = 'IDR' THEN ? ELSE 1 END)
                         WHEN created_at > NOW() - INTERVAL 24 HOUR AND bet_type = 'bet' THEN -amount * (CASE WHEN currency_code IN ('USDT','USDC') THEN ? WHEN currency_code = 'IDR' THEN ? ELSE 1 END) ELSE 0 END), 0) AS d24_profit
     FROM bg_bet_order WHERE user_id = ? AND status = 'settled'`,
    [sinceDate, usdRate, idrRate, sinceDate, usdRate, idrRate, usdRate, idrRate, usdRate, idrRate, userId],
  )

  // 游戏厂商 bonus 通道派彩（老虎机 feature/免费游戏，走 ledger type=bonus ref_type=game）。
  // 这类是真实赢钱但不进 bg_bet_order，历史上盈利/高倍规则完全看不见 → 存110赢13k靠 bonus 通道套现无人拦。
  // 折 PHP 元后并入 profit，让 large_profit / high_multiple_profit 能看见。
  // 55e087f 起 bonus 派彩会同时写 bg_bet_order(provider_txn_id='bonus:<ref_id>'),
  // 已入注单的条目在上面的投注盈亏里算过一次,这里必须排除,否则同一笔赢钱双重计入。
  const [[gb]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN l.created_at > ? THEN l.amount * (CASE WHEN l.currency IN ('USDT','USDC') THEN ? WHEN l.currency = 'IDR' THEN ? ELSE 1 END) END), 0) AS window_amt,
       COALESCE(SUM(CASE WHEN l.created_at > NOW() - INTERVAL 24 HOUR THEN l.amount * (CASE WHEN l.currency IN ('USDT','USDC') THEN ? WHEN l.currency = 'IDR' THEN ? ELSE 1 END) END), 0) AS d24_amt
     FROM bg_wallet_ledger l
     WHERE l.user_id = ? AND l.type = 'bonus' AND l.ref_type = 'game'
       AND NOT EXISTS (
         SELECT 1 FROM bg_bet_order o
         WHERE o.aggregator_id = '568win' AND o.provider_txn_id = CONCAT('bonus:', l.ref_id)
       )`,
    [sinceDate, usdRate, idrRate, usdRate, idrRate, userId],
  )

  const [[bonus]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount * (CASE WHEN currency IN ('USDT','USDC') THEN ? WHEN currency = 'IDR' THEN ? ELSE 1 END)), 0) AS total_amt
     FROM bg_wallet_ledger
     WHERE user_id = ? AND amount > 0
       AND type IN ('bonus','red_packet','rebate','vip_bonus','task_bonus')
       AND COALESCE(ref_type, '') <> 'game'`,
    [usdRate, idrRate, userId],
  )

  // 优惠流水未完成（promotion 类型），只检查与本次取款同币种的要求，跨币种不拦截
  const [[pt]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(required_amount - completed_amount), 0) AS remaining
     FROM bg_turnover_requirements
     WHERE user_id = ? AND currency = ? AND source_type = 'promotion' AND status = 'pending'`,
    [userId, order.currency],
  )

  // 同 IP（近30天）的其他账号数
  const [[ip]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.ip = l1.ip AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.ip IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
    [userId],
  )

  const [[devId]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.device_id = l1.device_id AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.device_id IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
    [userId],
  )

  const [[devFp]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.fp_visitor = l1.fp_visitor AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.fp_visitor IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
    [userId],
  )
  // 设备画像(全周期):资历、换设备/换指纹次数,供人工复核可解释
  const [[devProfile]] = await pool.query<RowDataPacket[]>(
    `SELECT MIN(created_at) AS first_seen,
            COUNT(DISTINCT device_id) AS device_id_count,
            COUNT(DISTINCT fp_visitor) AS fp_count
     FROM bg_login_log WHERE user_id = ?`,
    [userId],
  )
  const [[acctReuse]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT user_id) AS cnt
     FROM bg_withdraw_order
     WHERE user_id <> ?
       AND JSON_UNQUOTE(JSON_EXTRACT(extra, '$.targetAccount')) = ?
       AND JSON_UNQUOTE(JSON_EXTRACT(extra, '$.targetAccount')) <> ''`,
    [userId, targetAccount],
  )
  const [[ownerReuse]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT user_id) AS cnt
     FROM bg_withdraw_order
     WHERE user_id <> ?
       AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(extra, '$.targetOwner')))) = LOWER(?)
       AND JSON_UNQUOTE(JSON_EXTRACT(extra, '$.targetOwner')) <> ''`,
    [userId, targetOwner],
  )

  // 同名审核:仅规则启用时才拉全量 approved 实名比对,避免每笔提现无谓全表扫描
  const sameNameUsers = config.same_name_review?.enabled
    ? await findSameNameUsers(pool, userId, String(kyc?.full_name ?? ''))
    : []

  // 篡改注单：凭空派彩 round。
  // 窗口只约束派彩行；投注存在性必须查全历史——下注可能早于窗口起点
  // (上次取款前下注、之后才派彩,或回填的历史派彩行),按窗口内找 bet 会大面积误报。
  const [[orphan]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT round_id
       FROM bg_bet_order
       WHERE user_id = ? AND round_id IS NOT NULL
       GROUP BY round_id
       HAVING SUM(bet_type = 'bet') = 0
          AND SUM(bet_type IN ('win','refund') AND status = 'settled' AND created_at > ?) > 0
     ) t`,
    [userId, sinceDate],
  )
  // 三级分销佣金
  const [[comm]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(commission_cents), 0) AS earned,
       COALESCE(SUM(ggr_cents), 0)        AS downline_ggr
     FROM bg_team_commission WHERE beneficiary_id = ? AND status <> 'voided'`,
    [userId],
  )
  const [[dup]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT 1 FROM bg_team_commission
       WHERE beneficiary_id = ?
       GROUP BY from_user_id, level, period HAVING COUNT(*) > 1
     ) t`,
    [userId],
  )

  const win568 = await buildWin568ReviewStats(pool, userId, sinceDate, reconcileGraceMinutes(config), usdRate)

  const gameBonusPhp = Number(gb?.window_amt ?? 0)
  const gameBonus24hPhp = Number(gb?.d24_amt ?? 0)
  const rateToPhp = order.currency === 'USDT' || order.currency === 'USDC'
    ? usdRate
    : order.currency === 'IDR' ? idrRate : 1
  const withdrawPhp = order.amount * rateToPhp

  return {
    pool, order, since,
    depositPhp: Number(dep?.window_amt ?? 0),
    deposit24hPhp: Number(dep?.d24_amt ?? 0),
    lifetimeDepositCount: Number(dep?.lifetime_cnt ?? 0),
    lifetimeDepositPhp: Number(dep?.lifetime_amt ?? 0),
    withdrawPhp,
    orderCurrencyToPhpRate: rateToPhp,
    profitPhp: Number(bet?.window_profit ?? 0) + gameBonusPhp,
    profit24hPhp: Number(bet?.d24_profit ?? 0) + gameBonus24hPhp,
    gameBonusPhp,
    gameBonus24hPhp,
    bonusPhp: Number(bonus?.total_amt ?? 0),
    completedWithdrawCount,
    uplineBlacklisted,
    kycStatus: String(kyc?.status ?? ''),
    kycFullName: String(kyc?.full_name ?? ''),
    kycReviewedAt,
    targetOwner,
    targetAccount,
    withdrawAccountOtherUsers: targetAccount ? Number(acctReuse?.cnt ?? 0) : 0,
    withdrawOwnerOtherUsers: targetOwner ? Number(ownerReuse?.cnt ?? 0) : 0,
    sameNameOtherUsers: sameNameUsers,
    minutesSinceKycApproved: kyc?.status === 'approved' ? minutesBetween(kycReviewedAt, order.createdAt) : null,
    promoTurnoverRemaining: Number(pt?.remaining ?? 0),
    relatedIpAccounts: Number(ip?.cnt ?? 0),
    relatedDeviceIdAccounts: Number(devId?.cnt ?? 0),
    relatedDeviceFpAccounts: Number(devFp?.cnt ?? 0),
    firstSeenAt: devProfile?.first_seen ? new Date(devProfile.first_seen as Date).toISOString() : '',
    deviceIdCount: Number(devProfile?.device_id_count ?? 0),
    fpCount: Number(devProfile?.fp_count ?? 0),
    deviceTrustLevel: Number(devProfile?.device_id_count ?? 0) > 0 ? 'client'
      : Number(devProfile?.fp_count ?? 0) > 0 ? 'fp' : 'none',
    tamperOrphanRounds: Number(orphan?.cnt ?? 0),
    // commission_cents / ggr_cents 是数据库真·分列，/100 折成元统一口径
    commissionEarnedPhp: Number(comm?.earned ?? 0) / 100,
    commissionDownlineGgrPhp: Number(comm?.downline_ggr ?? 0) / 100,
    commissionDupGroups: Number(dup?.cnt ?? 0),
    win568,
  }
}

function snapshotOf(ctx: ReviewContext): Record<string, number | string | boolean> {
  return {
    since: ctx.since,
    depositPhp: ctx.depositPhp,
    deposit24hPhp: ctx.deposit24hPhp,
    lifetimeDepositCount: ctx.lifetimeDepositCount,
    lifetimeDepositPhp: ctx.lifetimeDepositPhp,
    withdrawPhp: ctx.withdrawPhp,
    profitPhp: ctx.profitPhp,
    profit24hPhp: ctx.profit24hPhp,
    gameBonusPhp: ctx.gameBonusPhp,
    gameBonus24hPhp: ctx.gameBonus24hPhp,
    bonusPhp: ctx.bonusPhp,
    completedWithdrawCount: ctx.completedWithdrawCount,
    uplineBlacklisted: ctx.uplineBlacklisted,
    promoTurnoverRemaining: ctx.promoTurnoverRemaining,
    relatedIpAccounts: ctx.relatedIpAccounts,
    relatedDeviceIdAccounts: ctx.relatedDeviceIdAccounts,
    relatedDeviceFpAccounts: ctx.relatedDeviceFpAccounts,
    firstSeenAt: ctx.firstSeenAt,
    deviceIdCount: ctx.deviceIdCount,
    fpCount: ctx.fpCount,
    deviceChangedCount: Math.max(0, ctx.deviceIdCount - 1),
    deviceTrustLevel: ctx.deviceTrustLevel,
    tamperOrphanRounds: ctx.tamperOrphanRounds,
    commissionEarnedPhp: ctx.commissionEarnedPhp,
    commissionDownlineGgrPhp: ctx.commissionDownlineGgrPhp,
    commissionDupGroups: ctx.commissionDupGroups,
    win568SyncWatermark: ctx.win568.watermarkMs === null ? '' : new Date(ctx.win568.watermarkMs).toISOString(),
    win568CoverageStart: ctx.win568.coverageStartMs === null ? '' : new Date(ctx.win568.coverageStartMs).toISOString(),
    win568ReconcileChecked: ctx.win568.reconcileChecked,
    win568ReconcileMissing: ctx.win568.reconcileMissing,
    win568ReconcileStakeMismatch: ctx.win568.reconcileStakeMismatch,
    win568ReconcileVoidPaid: ctx.win568.reconcileVoidPaid,
    win568BonusCount: ctx.win568.bonusCount,
    win568BonusAmountPhp: ctx.win568.bonusAmountPhp,
    win568BetTxnCount: ctx.win568.betTxnCount,
    win568VoidTxnCount: ctx.win568.voidTxnCount,
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

/**
 * 对一笔 pending 提案跑自动审核。全部通过则自动批准出款，否则置 manual 留人工。
 * 整体异常一律转人工，绝不静默放行。
 * @param round 审核轮次，重跑时由调用方递增
 */
export async function reviewWithdraw(env: Env, redis: Redis, orderId: string, round = 1): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const pool = getMysqlPool(env)

  const order = await getWithdraw(redis, orderId)
  if (!order || order.status !== 'pending') return

  const t0 = Date.now()
  let verdict: ReviewVerdict = 'manual'
  let snapshot: Record<string, unknown> | null = null

  try {
    const [config, usdToPhp, idrToPhp] = await Promise.all([
      loadReviewConfig(pool),
      getRate(redis, 'USDT', 'PHP', env),
      getRate(redis, 'IDR', 'PHP', env),
    ])
    const ctx = await buildContext(pool, order, config, usdToPhp.rate, idrToPhp.rate)
    snapshot = snapshotOf(ctx)

    const results: RuleResult[] = []
    for (const [code, rule] of Object.entries(RULES)) {
      const cfg = config[code]
      if (!cfg || !cfg.enabled) { results.push({ code, verdict: 'skipped' }); continue }
      try {
        results.push(await rule(ctx, cfg))
      } catch (err) {
        results.push({ code, verdict: 'error', detail: { error: err instanceof Error ? err.message : String(err) } })
      }
    }

    for (const r of results) {
      await pool.execute(
        `INSERT INTO bg_withdraw_review_log (order_id, user_id, rule_code, round, verdict, actual_value, threshold, detail)
         VALUES (?,?,?,?,?,?,?,?)`,
        [order.orderId, order.userId, r.code, round, r.verdict,
         r.actualValue ?? null, r.threshold ?? null, r.detail ? JSON.stringify(r.detail) : null],
      )
    }

    // ── 综合评分 ──────────────────────────────────────────────────────────────
    // 硬闸门(资金红线/篡改/KYC/account_reuse 等)任一命中即 manual;
    // 弱关联信号(SCORE_POOL)改累加权重,总分 ≥ 阈值才 manual。
    // shadow=1:只记录新结果不生效,判定仍走旧 OR 逻辑。
    // _score_policy 缺失(老库未迁移)时 weights 为空、shadow 默认 true → 完全等于旧行为。
    const policy = config['_score_policy']
    const policyParams = (policy?.params ?? null) as Record<string, unknown> | null
    const weights = (policyParams?.weights ?? {}) as Record<string, number>
    const scoreThreshold = Number(policy?.threshold ?? 100)
    const shadow = Boolean(policyParams?.shadow ?? true)

    let gateManual = false
    let scoreTotal = 0
    const scoreHits: Array<{ code: string; weight: number }> = []
    for (const r of results) {
      if (r.verdict === 'error') { gateManual = true; continue }
      if (r.verdict !== 'manual') continue
      if (SCORE_POOL.has(r.code)) {
        const w = Number(weights[r.code] ?? 0)
        scoreTotal += w
        scoreHits.push({ code: r.code, weight: w })
      } else {
        gateManual = true
      }
    }
    const scoredVerdict: ReviewVerdict = gateManual || scoreTotal >= scoreThreshold ? 'manual' : 'pass'
    const legacyVerdict: ReviewVerdict =
      results.some((r) => r.verdict === 'manual' || r.verdict === 'error') ? 'manual' : 'pass'

    verdict = shadow ? legacyVerdict : scoredVerdict

    // 评分明细并入 snapshot,供后台详情展示与影子期对比调参
    snapshot = {
      ...snapshot,
      scoreShadow: shadow,
      scoreTotal,
      scoreThreshold,
      scoreHits,
      gateManual,
      scoredVerdict,
      legacyVerdict,
      shadowWouldChange: scoredVerdict !== legacyVerdict,
    }
  } catch (err) {
    // 引擎级异常：保守转人工，记一条审核日志
    await pool.execute(
      `INSERT INTO bg_withdraw_review_log (order_id, user_id, rule_code, round, verdict, detail)
       VALUES (?,?,?,?,?,?)`,
      [order.orderId, order.userId, '_engine', round, 'error',
       JSON.stringify({ error: err instanceof Error ? err.message : String(err) })],
    ).catch(() => {})
    verdict = 'manual'
  }

  await pool.execute(
    `UPDATE bg_withdraw_order
       SET review_verdict = ?, reviewed_at = NOW(3), review_round = ?, review_ms = ?, review_snapshot = ?
     WHERE order_id = ?`,
    [verdict, round, Date.now() - t0, snapshot ? JSON.stringify(snapshot) : null, order.orderId],
  )

  if (verdict === 'pass') {
    try { await approveWithdraw(env, redis, order) }
    catch { /* 出款失败内部已退款并置 failed，留人工跟进 */ }
  } else {
    broadcastBadges(env).catch(() => {})
    if (round === 1) {
      notifyWithdrawManual(env, {
        scope: 'personal',
        orderId: order.orderId,
        userId: order.userId,
        amount: order.amount,
        currency: order.currency,
      }).catch(() => {})
    }
  }
}

/** 人工触发重跑审核：轮次递增，生成新一轮记录而非覆盖 */
export async function rerunReview(env: Env, redis: Redis, orderId: string): Promise<{ round: number }> {
  if (!isMysqlEnabled(env)) return { round: 0 }
  const pool = getMysqlPool(env)
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(round), 0) AS r FROM bg_withdraw_review_log WHERE order_id = ?`,
    [orderId],
  )
  const nextRound = Number(row?.r ?? 0) + 1
  await reviewWithdraw(env, redis, orderId, nextRound)
  return { round: nextRound }
}

// ── 后台查询 ──────────────────────────────────────────────────────────────────

/** 单笔最新一轮的逐规则结果 */
export async function getReviewLog(env: Env, orderId: string) {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [[r]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(round), 1) AS r FROM bg_withdraw_review_log WHERE order_id = ?`, [orderId],
  )
  const round = Number(r?.r ?? 1)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, verdict, actual_value, threshold, detail, created_at
     FROM bg_withdraw_review_log WHERE order_id = ? AND round = ? ORDER BY id ASC`,
    [orderId, round],
  )
  return rows.map((x) => ({
    ruleCode: String(x.rule_code),
    ruleName: RULE_META[String(x.rule_code)]?.name ?? String(x.rule_code),
    verdict: String(x.verdict),
    actualValue: x.actual_value == null ? null : Number(x.actual_value),
    threshold: x.threshold == null ? null : Number(x.threshold),
    detail: x.detail ?? null,
    // 命中该规则时推荐的用户可见驳回话术（前端据此自动预选）
    recommendedUserReason: recommendedUserReasonForRule(String(x.rule_code)),
    createdAt: new Date(x.created_at as Date).toISOString(),
  }))
}

/** 与某用户共用同 IP / 同设备的关联账号（人工核查辅助，实时查询） */
export async function getRelatedAccounts(env: Env, userId: string) {
  if (!isMysqlEnabled(env)) return { ip: [], device: [] }
  const pool = getMysqlPool(env)
  const [ipRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT l2.user_id, l1.ip
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.ip = l1.ip AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.ip IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY
     LIMIT 50`,
    [userId],
  )
  // 同设备：device_id 或硬件指纹 fp_visitor 命中；展示值优先 device_id，缺失回落 fp_visitor
  const [deviceRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT l2.user_id, COALESCE(l1.device_id, l1.fp_visitor) AS device_id
     FROM bg_login_log l1
     JOIN bg_login_log l2
       ON l2.user_id <> l1.user_id
      AND ( (l1.device_id IS NOT NULL AND l2.device_id = l1.device_id)
         OR (l1.fp_visitor IS NOT NULL AND l2.fp_visitor = l1.fp_visitor) )
     WHERE l1.user_id = ? AND l1.created_at > NOW() - INTERVAL 30 DAY
     LIMIT 50`,
    [userId],
  )
  return {
    ip: ipRows.map((r) => ({ userId: String(r.user_id), ip: String(r.ip) })),
    device: deviceRows.map((r) => ({ userId: String(r.user_id), deviceId: String(r.device_id ?? '') })),
  }
}
