import type { Redis } from 'ioredis'
import type { RowDataPacket } from 'mysql2/promise'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'
import { getRate } from './exchange-rate.service.js'
import { getBiTargetProgress, listBiAlerts } from './bi.service.js'
import { getAdminSetting, setAdminSetting } from './admin-store.js'

const log = childLogger('bi-report')
const DAY_MS = 24 * 60 * 60 * 1000
const PHT_OFFSET_MS = 8 * 3600 * 1000
const REPORT_HOUR_PHT = 10

// AI 运营日报：每天马尼拉 10:00 汇总昨日大盘推送到运营 TG 群。
// 配置了 GEMINI_API_KEY 用 Gemini 生成叙述版（与 KYC 共用 key）；否则发纯数据模板。发送失败静默。

function manilaDate(offsetDays = 0): string {
  return new Date(Date.now() + PHT_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

interface DayNumbers {
  ggr: number; deposit: number; withdraw: number; bonus: number
  dau: number; newUsers: number; firstDep: number
}

async function dayNumbers(env: Env, redis: Redis, date: string): Promise<DayNumbers> {
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT currency, deposit_amount, withdraw_amount, bet_amount, payout_amount, bonus_cost, first_dep_users
     FROM bi_daily_platform WHERE stat_date=?`, [date])
  const out: DayNumbers = { ggr: 0, deposit: 0, withdraw: 0, bonus: 0, dau: 0, newUsers: 0, firstDep: 0 }
  for (const r of rows) {
    let rate = 1
    try { rate = (await getRate(redis, String(r.currency), 'PHP', env)).rate } catch { /* 展示兜底 */ }
    out.ggr += (Number(r.bet_amount) - Number(r.payout_amount)) * rate
    out.deposit += Number(r.deposit_amount) * rate
    out.withdraw += Number(r.withdraw_amount) * rate
    out.bonus += Number(r.bonus_cost) * rate
    out.firstDep += Number(r.first_dep_users)
  }
  const [[act]] = await db.query<RowDataPacket[]>(
    `SELECT new_users, dau FROM bi_daily_active WHERE stat_date=?`, [date])
  out.dau = Number(act?.dau ?? 0)
  out.newUsers = Number(act?.new_users ?? 0)
  return out
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-PH')
const cmp = (cur: number, prev: number) =>
  prev !== 0 ? `${cur >= prev ? '+' : ''}${(((cur - prev) / Math.abs(prev)) * 100).toFixed(0)}%` : '—'

async function composeRawReport(env: Env, redis: Redis, date: string): Promise<string> {
  const db = getMysqlPool(env)
  const [y, p] = await Promise.all([
    dayNumbers(env, redis, date),
    dayNumbers(env, redis, manilaDate(-2)),
  ])
  const [provRows] = await db.query<RowDataPacket[]>(
    `SELECT provider, SUM(bet_amount) stake, SUM(bet_amount)-SUM(payout_amount) ggr
     FROM bi_daily_provider WHERE stat_date=? AND provider<>'Unknown'
     GROUP BY provider ORDER BY stake DESC LIMIT 3`, [date])
  const openAlerts = (await listBiAlerts(env, 'open')).length
  const progress = await getBiTargetProgress(env, redis)

  const lines = [
    `📊 BetoGo 运营日报 ${date}`,
    '',
    `GGR ₱${fmt(y.ggr)} (${cmp(y.ggr, p.ggr)})  NGR ₱${fmt(y.ggr - y.bonus)}`,
    `充值 ₱${fmt(y.deposit)} (${cmp(y.deposit, p.deposit)})  提现 ₱${fmt(y.withdraw)}`,
    `DAU ${y.dau} (${cmp(y.dau, p.dau)})  新增 ${y.newUsers}  首充 ${y.firstDep}  活动成本 ₱${fmt(y.bonus)}`,
  ]
  if (provRows.length > 0) {
    lines.push('', 'Top 厂商: ' + provRows.map((r) => `${r.provider} 流水₱${fmt(Number(r.stake))}/GGR₱${fmt(Number(r.ggr))}`).join('；'))
  }
  for (const t of progress.items) {
    lines.push(`目标 ${t.metric}: 完成 ${(t.completion * 100).toFixed(0)}% / 时间 ${(t.timeProgress * 100).toFixed(0)}%，预计月底 ${(t.projectedCompletion * 100).toFixed(0)}%`)
  }
  if (openAlerts > 0) lines.push('', `⚠️ 有 ${openAlerts} 条未处理数据异常告警，请到后台「数据分析」查看`)
  return lines.join('\n')
}

async function polishWithGemini(env: Env, raw: string): Promise<string> {
  if (!env.GEMINI_API_KEY) return raw
  try {
    const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
    const model = ai.getGenerativeModel(
      {
        model: 'gemini-2.5-flash',
        systemInstruction: [
          '你是菲律宾在线游戏平台 BetoGo 的数据分析师，把每日数据写成给老板看的中文运营日报。',
          '硬性规则：所有数字、百分比、厂商名必须与原文完全一致，不得编造或推算新数字；',
          '结构：一句话大盘结论 → 亮点 → 异常/风险 → 一条可执行建议；全文不超过 200 字；',
          '直接从结论正文开始输出，不要标题、不要日期、不要 Markdown 加粗、不要任何前言。',
        ].join('\n'),
      },
      { timeout: 20_000 },
    )
    const res = await model.generateContent(`根据以下数据写今日运营日报：\n\n${raw}`)
    const text = res.response.text().trim()
    return text ? `📊 BetoGo 运营日报 ${manilaDate(-1)}\n\n${text}\n\n——\n${raw.split('\n').slice(2).join('\n')}` : raw
  } catch (err) {
    log.warn({ err }, 'gemini polish error, use raw')
    return raw
  }
}

// 后台开关：'0'=停发，未设置或其他值=开（默认开）
const REPORT_ENABLED_KEY = 'bi_daily_report_enabled'

export async function isBiReportEnabled(env: Env): Promise<boolean> {
  return (await getAdminSetting(env, REPORT_ENABLED_KEY)) !== '0'
}

export async function setBiReportEnabled(env: Env, enabled: boolean): Promise<void> {
  await setAdminSetting(env, REPORT_ENABLED_KEY, enabled ? '1' : '0')
}

export async function runBiReportTick(env: Env, redis: Redis): Promise<void> {
  const reportChat = env.BI_REPORT_CHAT_ID || env.ADMIN_TG_CHAT_ID
  if (!isMysqlEnabled(env) || !env.ADMIN_TG_BOT_TOKEN || !reportChat) return
  const manilaHour = new Date(Date.now() + PHT_OFFSET_MS).getUTCHours()
  if (manilaHour !== REPORT_HOUR_PHT) return
  if (!(await isBiReportEnabled(env))) return

  const today = manilaDate()
  const locked = await redis.set(`bi:report:${today}`, '1', 'EX', 2 * 24 * 3600, 'NX')
  if (!locked) return

  try {
    const raw = await composeRawReport(env, redis, manilaDate(-1))
    const text = await polishWithGemini(env, raw)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    await fetch(`https://api.telegram.org/bot${env.ADMIN_TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: reportChat, text, disable_web_page_preview: true }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    log.info({ date: manilaDate(-1) }, 'daily report sent')
  } catch (err) {
    // 失败释放锁，下一个 tick 重试
    await redis.del(`bi:report:${today}`).catch(() => {})
    log.error({ err }, 'daily report failed')
  }
}

/** 手动触发（联调用）：忽略时间窗与去重锁，直接生成并发送 */
export async function sendBiReportNow(env: Env, redis: Redis): Promise<{ sent: boolean; text: string }> {
  const raw = await composeRawReport(env, redis, manilaDate(-1))
  const text = await polishWithGemini(env, raw)
  const reportChat = env.BI_REPORT_CHAT_ID || env.ADMIN_TG_CHAT_ID
  if (!env.ADMIN_TG_BOT_TOKEN || !reportChat) return { sent: false, text }
  const resp = await fetch(`https://api.telegram.org/bot${env.ADMIN_TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: reportChat, text, disable_web_page_preview: true }),
  })
  return { sent: resp.ok, text }
}
