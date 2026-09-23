import type { Env } from '../config/env.js'

// 后台业务告警统一推送到运营 Telegram 群。
// 只推"有人需要处理/关注"的业务事件(提现待审、KYC 判拒、客服转人工、风控命中),
// 不推前端"保存成功"类操作反馈。发送失败静默,绝不影响主流程。

interface AdminAlert {
  // 去重键:同一事件短时间内重复触发(重跑审核、escalated 重复命中等)只发一次
  dedupKey: string
  text: string
}

const DEDUP_WINDOW_MS = 10 * 60 * 1000 // 同一 dedupKey 10 分钟内只发一次
const RATE_LIMIT = 20 // 全局限流:每分钟最多 20 条,兜底防异常刷屏
const RATE_WINDOW_MS = 60 * 1000

const lastSent = new Map<string, number>()
const recent: number[] = []

function shouldSuppress(key: string): boolean {
  const now = Date.now()
  const prev = lastSent.get(key)
  if (prev && now - prev < DEDUP_WINDOW_MS) return true

  while (recent.length && now - recent[0] > RATE_WINDOW_MS) recent.shift()
  if (recent.length >= RATE_LIMIT) return true

  lastSent.set(key, now)
  recent.push(now)

  // 防 map 无限增长:超量时清理过期键
  if (lastSent.size > 5000) {
    for (const [k, t] of lastSent) if (now - t > DEDUP_WINDOW_MS) lastSent.delete(k)
  }
  return false
}

async function send(env: Env, alert: AdminAlert): Promise<void> {
  if (!env.ADMIN_TG_BOT_TOKEN || !env.ADMIN_TG_CHAT_ID) return
  if (shouldSuppress(alert.dedupKey)) return
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    await fetch(`https://api.telegram.org/bot${env.ADMIN_TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.ADMIN_TG_CHAT_ID,
        text: env.ADMIN_NOTIFY_ENV_LABEL ? `${env.ADMIN_NOTIFY_ENV_LABEL}\n${alert.text}` : alert.text,
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
  } catch {
    // 告警失败不影响主流程
  }
}

// ── 提现/团队提现转人工审核 ────────────────────────────────────────────────────
export function notifyWithdrawManual(
  env: Env,
  p: { scope: 'personal' | 'team'; orderId: string | number; userId: string; amount: number; currency: string },
): Promise<void> {
  const label = p.scope === 'team' ? '团队提现' : '提现'
  const text = [
    `🔔 ${label}待人工审核`,
    `用户: ${p.userId}`,
    `金额: ${p.amount} ${p.currency}`,
    `单号: ${p.orderId}`,
    `${env.ADMIN_WEB_URL}/review/manual`,
  ].join('\n')
  return send(env, { dedupKey: `wd:${p.scope}:${p.orderId}`, text })
}

// ── KYC 自动判拒 ───────────────────────────────────────────────────────────────
export function notifyKycRejected(
  env: Env,
  p: { userId: string; fullName?: string; stage: 'document' | 'face'; reasons: string[] },
): Promise<void> {
  const stageLabel = p.stage === 'face' ? '人脸' : '证件'
  const text = [
    `🔔 KYC 判拒(${stageLabel})`,
    `用户: ${p.userId}${p.fullName ? ` (${p.fullName})` : ''}`,
    `原因: ${p.reasons.join(', ') || '未知'}`,
    `${env.ADMIN_WEB_URL}/kyc/${p.userId}`,
  ].join('\n')
  return send(env, { dedupKey: `kyc:${p.stage}:${p.userId}`, text })
}

// ── 客服转人工 ─────────────────────────────────────────────────────────────────
export function notifyCsHuman(
  env: Env,
  p: { conversationId: number; userId?: string; reason: string; toStatus: 'escalated' | 'human_taken' },
): Promise<void> {
  const label = p.toStatus === 'human_taken' ? '工单待人工(在线)' : '离线工单待处理'
  const text = [
    `🔔 客服${label}`,
    `用户: ${p.userId ?? '未知'}`,
    `原因: ${p.reason || '未知'}`,
    `工单: #${p.conversationId}`,
    `${env.ADMIN_WEB_URL}/cs-tickets`,
  ].join('\n')
  return send(env, { dedupKey: `cs:${p.conversationId}:${p.toStatus}`, text })
}

export function notifyCsTicketMessage(
  env: Env,
  p: { conversationId: number; userId: string },
): Promise<void> {
  const text = [
    '🔔 客服工单新留言',
    `用户: ${p.userId}`,
    `工单: #${p.conversationId}`,
    `${env.ADMIN_WEB_URL}/cs-tickets`,
  ].join('\n')
  return send(env, { dedupKey: `csmsg:${p.conversationId}`, text })
}

// ── 服务商余额不足 ─────────────────────────────────────────────────────────────
export function notifyProviderBalanceLow(
  env: Env,
  p: { provider: string; label: string; balance: number; threshold: number; currency: string },
): Promise<void> {
  const text = [
    `⚠️ 服务商余额不足`,
    `服务商: ${p.label}`,
    `当前余额: ${p.balance.toFixed(2)} ${p.currency}`,
    `告警金额: ${p.threshold.toFixed(2)} ${p.currency}`,
    `${env.ADMIN_WEB_URL}/payment/accounting`,
  ].join('\n')
  return send(env, { dedupKey: `balance:${p.provider}`, text })
}

export function notifyPaymentCallbackIssue(
  env: Env,
  p: { id: number; provider: string; issueType: string; orderId?: string | null },
): Promise<void> {
  const text = [
    '⚠️ 支付回调异常',
    `服务商: ${p.provider}`,
    `类型: ${p.issueType}`,
    p.orderId ? `订单: ${p.orderId}` : '',
    `${env.ADMIN_WEB_URL}/payment/accounting`,
  ].filter(Boolean).join('\n')
  return send(env, { dedupKey: `payment-callback:${p.id}`, text })
}

// ── 风控命中(仅 deny/escalate 高危)────────────────────────────────────────────
export function notifyRiskHit(
  env: Env,
  p: { userId?: string; checkpoint: string; ruleCode: string; action: string; ip?: string },
): Promise<void> {
  const text = [
    `🔔 风控命中 [${p.action}]`,
    `用户: ${p.userId ?? '未知'}`,
    `管控点: ${p.checkpoint}`,
    `规则: ${p.ruleCode}`,
    p.ip ? `IP: ${p.ip}` : '',
    `${env.ADMIN_WEB_URL}/risk/hits`,
  ].filter(Boolean).join('\n')
  return send(env, { dedupKey: `risk:${p.checkpoint}:${p.ruleCode}:${p.userId ?? p.ip ?? ''}`, text })
}

// ── RevoSurge 回传异常 ─────────────────────────────────────────────────────────
// 要防的是沉默故障：广告在烧钱，但转化事件一条都没发出去，而后台看不出任何异常。
// dedupKey 按类型固定，故障未恢复时靠 10 分钟去重窗口持续提醒、又不至于刷屏。
export function notifyRevosurgeStale(env: Env, p: { minutes: number }): Promise<void> {
  const text = [
    `🚨 RevoSurge 回传已停止`,
    `同步心跳已停 ${p.minutes} 分钟（正常每 2 分钟一次）`,
    `core-node 的 revosurge 定时任务可能已挂，期间的转化事件全部未上报`,
    `${env.ADMIN_WEB_URL}/bi/ad-sources`,
  ].join('\n')
  return send(env, { dedupKey: 'revosurge:stale', text })
}

export function notifyRevosurgeFailing(
  env: Env,
  p: { failed: number; total: number; needsAction: boolean; codeSummary: string },
): Promise<void> {
  const rate = p.total > 0 ? Math.round((p.failed / p.total) * 100) : 100
  const text = [
    p.needsAction ? `🚨 RevoSurge 回传失败（需人工处理）` : `⚠️ RevoSurge 回传失败率偏高`,
    `今日失败 ${p.failed} / ${p.total} 条（${rate}%）`,
    `错误分布: ${p.codeSummary}`,
    p.needsAction
      ? `401/403=密钥失效，400/422=字段或事件未开通，均不会自愈，需检查配置`
      : `429=限流，5xx=对方服务波动，通常会自愈，先观察`,
    `${env.ADMIN_WEB_URL}/bi/ad-sources`,
  ].join('\n')
  return send(env, { dedupKey: `revosurge:failing:${p.needsAction ? 'action' : 'watch'}`, text })
}
