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
  const label = p.toStatus === 'human_taken' ? '转人工(在线)' : '转人工(离线工单)'
  const text = [
    `🔔 客服${label}`,
    `用户: ${p.userId ?? '未知'}`,
    `原因: ${p.reason || '未知'}`,
    `会话: #${p.conversationId}`,
    `${env.ADMIN_WEB_URL}/customer-service`,
  ].join('\n')
  return send(env, { dedupKey: `cs:${p.conversationId}:${p.toStatus}`, text })
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
