import type { Pool, RowDataPacket } from 'mysql2/promise'

// 拉新礼金设备防薅 + 注册连环检测。
// 背景(2026-07-27 生产实测)：单IP 15号/6设备连环注册，每号领 trial+appdl ₱38 打光换号。
// 原则：设备指纹缺失时放行（老客户端无指纹，宁可放过不误伤）；风控写入永不阻断主链路。

/** 同设备/同IP 24h 内注册数达到该值视为连环注册 */
const BURST_THRESHOLD = 3

// 硬件指纹(FingerprintJS)同型号设备可能碰撞，单个撞号不拒；
// 同指纹已有 N 个以上账号领过才拒 —— 碰撞撞出一对是运气，撞出仨是薅子。
// 阈值走审核策略 bg_risk_policy(promo_claim/promo_device_dedup).params.fpClaimThreshold 可配，
// 读不到（策略行缺失/禁用/解析失败）回退默认值，行为与写死 2 时一致。
const DEFAULT_FP_CLAIM_THRESHOLD = 2

async function getFpClaimThreshold(pool: Pool): Promise<number> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT params FROM bg_risk_policy
        WHERE checkpoint = 'promo_claim' AND rule_code = 'promo_device_dedup' AND enabled = 1 LIMIT 1`,
    )
    const raw = rows[0]?.params
    if (!raw) return DEFAULT_FP_CLAIM_THRESHOLD
    const params = typeof raw === 'object' ? (raw as Record<string, unknown>) : JSON.parse(String(raw))
    const n = Number(params.fpClaimThreshold)
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_FP_CLAIM_THRESHOLD
  } catch {
    return DEFAULT_FP_CLAIM_THRESHOLD
  }
}

function dedupeIds(deviceIds: Array<string | undefined>): string[] {
  return [...new Set(deviceIds.filter((d): d is string => Boolean(d && d.trim())))]
}

/**
 * 领奖白名单：命中即完全放行防薅（供己方测试机反复领优惠）。
 * device 类型同时比对 deviceId 与硬件指纹；user 比对用户ID；ip 比对出口IP。任一匹配即算白名单。
 */
export async function isPromoClaimWhitelisted(
  pool: Pool,
  userId: string,
  deviceIds: Array<string | undefined>,
  fp?: string,
  ip?: string,
): Promise<boolean> {
  const pairs: Array<[string, string]> = []
  if (userId?.trim()) pairs.push(['user', userId.trim()])
  for (const d of dedupeIds([...deviceIds, fp])) pairs.push(['device', d])
  if (ip?.trim()) pairs.push(['ip', ip.trim()])
  if (pairs.length === 0) return false
  const where = pairs.map(() => '(type = ? AND value = ?)').join(' OR ')
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM bg_promo_claim_whitelist WHERE ${where} LIMIT 1`,
    pairs.flat(),
  )
  return rows.length > 0
}

// 当前请求 header 的 fp + 该用户历史登录留下的 fp。服务端兜底：伪造客户端不发
// X-Fp-Visitor 也逃不掉——只要注册/登录时留过一次指纹就能关联上。
async function collectFingerprints(pool: Pool, userId: string, headerFp?: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT fp_visitor FROM bg_login_log
      WHERE user_id = ? AND fp_visitor IS NOT NULL AND fp_visitor <> ''
      ORDER BY fp_visitor LIMIT 5`,
    [userId],
  )
  return dedupeIds([headerFp, ...rows.map((r) => String(r.fp_visitor))])
}

/** 命中拒绝时落风控日志，供后台观测命中/误伤；失败静默不阻断 */
async function logFpDenied(pool: Pool, userId: string, ruleCode: string, fp: string, sharedClaimedUsers: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bg_risk_hit_log (user_id, checkpoint, rule_code, action, matched_value, detail)
       VALUES (?, 'promo_claim', ?, 'deny', ?, ?)`,
      [userId, ruleCode, fp.slice(0, 128), JSON.stringify({ sharedClaimedUsers })],
    )
  } catch { /* 观测日志失败不影响拒绝决策 */ }
}

/** 同一设备上是否已有其他账号领过试玩金（按注册设备指纹关联，硬件指纹兜底） */
export async function trialClaimedOnSameDevice(
  pool: Pool,
  userId: string,
  deviceIds: Array<string | undefined>,
  headerFp?: string,
  ip?: string,
): Promise<boolean> {
  if (await isPromoClaimWhitelisted(pool, userId, deviceIds, headerFp, ip)) return false
  const ids = dedupeIds(deviceIds)
  if (ids.length > 0) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM bg_user u
         JOIN bg_user_promo_state ps ON ps.user_id = u.id AND ps.trial_claimed = 1
        WHERE u.id <> ? AND u.register_device_id IN (?) LIMIT 1`,
      [userId, ids],
    )
    if (rows.length > 0) return true
  }
  // deviceId 没命中再看硬件指纹：清缓存/隐身窗口会重置 deviceId，但指纹不变
  const fps = await collectFingerprints(pool, userId, headerFp)
  if (fps.length === 0) return false
  const [fpRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT ps.user_id) AS n FROM bg_login_log l
       JOIN bg_user_promo_state ps ON ps.user_id = l.user_id AND ps.trial_claimed = 1
      WHERE l.fp_visitor IN (?) AND l.user_id <> ?`,
    [fps, userId],
  )
  const n = Number(fpRows[0]?.n ?? 0)
  if (n < await getFpClaimThreshold(pool)) return false
  await logFpDenied(pool, userId, 'promo.trial_fp_dup', fps[0], n)
  return true
}

/** 同一设备上是否已有其他账号领过下载礼金（优先看领取行的 device_id，历史行退回按注册设备关联，硬件指纹兜底） */
export async function appdlClaimedOnSameDevice(
  pool: Pool,
  userId: string,
  deviceIds: Array<string | undefined>,
  headerFp?: string,
  ip?: string,
): Promise<boolean> {
  if (await isPromoClaimWhitelisted(pool, userId, deviceIds, headerFp, ip)) return false
  const ids = dedupeIds(deviceIds)
  if (ids.length > 0) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM bg_app_download_claim c
         LEFT JOIN bg_user u ON u.id = c.user_id
        WHERE c.user_id <> ? AND (c.device_id IN (?) OR u.register_device_id IN (?)) LIMIT 1`,
      [userId, ids, ids],
    )
    if (rows.length > 0) return true
  }
  const fps = await collectFingerprints(pool, userId, headerFp)
  if (fps.length === 0) return false
  const [fpRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT c.user_id) AS n FROM bg_login_log l
       JOIN bg_app_download_claim c ON c.user_id = l.user_id
      WHERE l.fp_visitor IN (?) AND l.user_id <> ?`,
    [fps, userId],
  )
  const n = Number(fpRows[0]?.n ?? 0)
  if (n < await getFpClaimThreshold(pool)) return false
  await logFpDenied(pool, userId, 'promo.appdl_fp_dup', fps[0], n)
  return true
}

/**
 * 注册连环检测：同设备/同IP 24h 内注册数 >= 阈值时，写风控信号 + 自动标签，
 * 让后台风控页当天可见、既有 multi_account 策略即刻有料可判（每日跑批会用登录日志口径覆盖刷新）。
 * 只标记不拦截；任何异常静默，绝不影响注册。
 */
export async function flagRegistrationBurst(
  pool: Pool,
  userId: string,
  deviceId?: string,
  ip?: string,
  fpVisitor?: string,
): Promise<void> {
  try {
    const dev = deviceId?.trim() || null
    const addr = ip?.trim() || null
    const fp = fpVisitor?.trim() || null
    if (!dev && !addr && !fp) return
    // 白名单测试机连环注册不误打 multi_account 标签
    if (await isPromoClaimWhitelisted(pool, userId, [dev ?? undefined, fp ?? undefined], fp ?? undefined, addr ?? undefined)) return
    const NO_MATCH = '\u0000'
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM bg_user WHERE register_device_id = ? AND registered_at >= NOW() - INTERVAL 24 HOUR) AS dev_cnt,
         (SELECT COUNT(*) FROM bg_user WHERE register_ip = ? AND registered_at >= NOW() - INTERVAL 24 HOUR) AS ip_cnt,
         (SELECT COUNT(DISTINCT user_id) FROM bg_login_log WHERE fp_visitor = ? AND created_at >= NOW() - INTERVAL 24 HOUR) AS fp_cnt`,
      [dev ?? NO_MATCH, addr ?? NO_MATCH, fp ?? NO_MATCH],
    )
    const devCnt = dev ? Number(rows[0]?.dev_cnt ?? 0) : 0
    const ipCnt = addr ? Number(rows[0]?.ip_cnt ?? 0) : 0
    // 硬件指纹抓"清缓存换 deviceId"的连环开号：deviceId 每号全新，指纹不变（本次注册已落 login_log，计数含自己）
    const fpCnt = fp ? Number(rows[0]?.fp_cnt ?? 0) : 0
    if (devCnt < BURST_THRESHOLD && ipCnt < BURST_THRESHOLD && fpCnt < BURST_THRESHOLD) return
    const evidence = JSON.stringify({ registrationBurst: { devCnt, ipCnt, fpCnt, deviceId: dev, ip: addr, fpVisitor: fp } })
    // 同设备连环比同IP(CGNAT下大量正常用户共享出口IP)可信度高得多，分数区别对待
    const score = devCnt >= BURST_THRESHOLD || fpCnt >= BURST_THRESHOLD ? 30 : 20
    await pool.query(
      `INSERT INTO bg_user_risk_signal (user_id, device_shared_users, ip_shared_users, risk_score, signals)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         device_shared_users = GREATEST(device_shared_users, VALUES(device_shared_users)),
         ip_shared_users = GREATEST(ip_shared_users, VALUES(ip_shared_users)),
         risk_score = GREATEST(risk_score, VALUES(risk_score))`,
      [userId, Math.max(devCnt, fpCnt, 1), Math.max(ipCnt, 1), score, evidence],
    )
    if (devCnt >= BURST_THRESHOLD || fpCnt >= BURST_THRESHOLD) {
      await pool.query(
        `INSERT INTO bg_user_tag (user_id, tag_code, source, confidence, evidence)
         VALUES (?, 'risk.multi_account', 'auto', ?, ?)
         ON DUPLICATE KEY UPDATE
           confidence = IF(source = 'manual', confidence, VALUES(confidence)),
           evidence   = IF(source = 'manual', evidence,   VALUES(evidence))`,
        [userId, score, evidence],
      )
    }
  } catch { /* 风控信号写失败不影响注册 */ }
}
