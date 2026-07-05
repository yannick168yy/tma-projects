import type { Env } from '../../config/env.js'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { getAdminSetting } from '../admin-store.js'
import { getSseBadgeClientCount } from '../sse-badges.js'

export const CS_DUTY_SETTING_KEY = 'cs_duty_enabled'

// 值班中 = 值班开关未关(默认开) 且 后台有活跃管理员连接(防止忘关开关后用户干等)
export async function isHumanOnDuty(env: Env): Promise<boolean> {
  const setting = await getAdminSetting(env, CS_DUTY_SETTING_KEY)
  if (setting === '0') return false
  return getSseBadgeClientCount() > 0
}

// 人工回复后通过 Telegram bot 触达用户(用户多半已离开页面);无 tgid/游客静默跳过
export async function notifyTicketReplyViaTelegram(env: Env, userId: string): Promise<void> {
  if (userId.startsWith('guest:')) return
  try {
    const pool = getMysqlPool(env)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT telegram_user_id FROM bg_user WHERE id = ?`,
      [userId],
    )
    const tgId = rows[0]?.telegram_user_id
    if (!tgId) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: Number(tgId),
        text: '💬 BetoGo Support: an agent has replied to your support ticket. Open the app → Support Center to view the reply.',
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
  } catch {
    // 触达失败不影响回复主流程
  }
}
