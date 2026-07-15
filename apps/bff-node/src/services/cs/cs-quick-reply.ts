import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { queryRecentOrders } from './cs-orders.js'
import type { CsReplyLocale } from './cs-deterministic.js'

// 自由文本前置直查:高频"查我的X状态"命中即查库返回权威结论,不进 Gemini。
// 极保守——宁可漏(交给 AI)不可错(拦截开放问题)。异常单(需转人工)返回 null 回落 AI。

export type QuickIntent = 'balance' | 'deposit' | 'withdraw'

const HOWTO = /(how\b|怎么|如何|paano|方式|渠道|method|channel|minimum|maximum|limit|额度|手续费|fee)/i
const PROMO = /(bonus|promo|优惠|活动|红利|rebate|cashback|洗码)/i
const STATUS = /(credit|arrive|arrived|status|pending|not\b|didn'?t|hasn'?t|where|missing|success|fail|已到|到账|到帐|没到|未到|成功|失败|状态|查|多久|进度)/i

const BALANCE = /(^|\W)(balance|bal|wallet)(\W|$)|余额|还有多少钱|还剩多少/i
const DEPOSIT = /(deposit|top\s?up|recharge|充值|存款|入款|deposito)/i
const WITHDRAW = /(withdraw|withdrawal|payout|提现|提款|出款|取款)/i

export function detectQuickIntent(text: string): QuickIntent | null {
  if (HOWTO.test(text) || PROMO.test(text)) return null
  if (BALANCE.test(text)) return 'balance'
  // 存款/提现需同时命中状态/疑问词,避免"can I deposit with GCash"之类被误拦
  if (DEPOSIT.test(text) && STATUS.test(text)) return 'deposit'
  if (WITHDRAW.test(text) && STATUS.test(text)) return 'withdraw'
  return null
}

export function detectLang(text: string): CsReplyLocale {
  return /[一-鿿]/.test(text) ? 'zh-CN' : 'en'
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 返回 null = 无法给出确定结论,回落 AI(如超时单需转人工、无余额记录等)
export async function buildQuickReply(
  env: Env,
  userId: string,
  intent: QuickIntent,
  lang: CsReplyLocale,
): Promise<string | null> {
  if (intent === 'balance') {
    const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
      `SELECT available, frozen FROM bg_wallet WHERE user_id = ?`,
      [userId],
    )
    if (!rows.length) return null
    const a = Number(rows[0].available).toFixed(2)
    const f = Number(rows[0].frozen).toFixed(2)
    return ({
      en: `Your wallet balance:\n- Available: ₱${a}\n- Frozen: ₱${f}`,
      'zh-CN': `你的钱包余额:\n- 可用:₱${a}\n- 冻结:₱${f}`,
      id: `Saldo wallet Anda:\n- Tersedia: ₱${a}\n- Dibekukan: ₱${f}`,
      vi: `Số dư ví của bạn:\n- Khả dụng: ₱${a}\n- Đóng băng: ₱${f}`,
    })[lang]
  }

  const orders = await queryRecentOrders(env, userId, intent === 'deposit' ? 'deposit' : 'withdraw')
  if (!orders.length) {
    if (intent === 'deposit') {
      return ({
        en: 'You have no deposit records yet. You can make one on the Deposit page in your Wallet.',
        'zh-CN': '你还没有充值记录。可在钱包的充值页发起充值。',
        id: 'Anda belum memiliki riwayat deposit. Anda bisa membuat deposit dari halaman Deposit di Wallet.',
        vi: 'Bạn chưa có lịch sử nạp tiền. Bạn có thể nạp từ trang Nạp tiền trong Ví.',
      })[lang]
    }
    return ({
      en: 'You have no withdrawal records yet.',
      'zh-CN': '你还没有提现记录。',
      id: 'Anda belum memiliki riwayat penarikan.',
      vi: 'Bạn chưa có lịch sử rút tiền.',
    })[lang]
  }

  const o = orders[0]
  // 待处理且已卡超过 30 分钟 → 可能要转人工,回落 AI 走升级链路
  if (o.state === 'pending') {
    const mins = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000)
    if (mins > 30) return null
  }
  const amt = o.amount
  const time = fmt(o.settledAt || o.createdAt)

  if (intent === 'deposit') {
    if (o.state === 'success')
      return ({
        en: `Your latest deposit of ₱${amt} has been credited ✅ (${time}).`,
        'zh-CN': `你最近一笔充值 ₱${amt} 已到账 ✅(${time})。`,
        id: `Deposit terbaru Anda sebesar ₱${amt} sudah masuk ✅ (${time}).`,
        vi: `Khoản nạp gần nhất ₱${amt} đã được cộng ✅ (${time}).`,
      })[lang]
    if (o.state === 'pending')
      return ({
        en: `Your latest deposit of ₱${amt} is still processing. It usually credits within a few minutes.`,
        'zh-CN': `你最近一笔充值 ₱${amt} 正在处理中,通常几分钟内到账,请稍候。`,
        id: `Deposit terbaru Anda sebesar ₱${amt} masih diproses. Biasanya masuk dalam beberapa menit.`,
        vi: `Khoản nạp gần nhất ₱${amt} vẫn đang xử lý. Thường sẽ được cộng trong vài phút.`,
      })[lang]
    return ({
      en: `Your latest deposit of ₱${amt} did not succeed. You can try again on the Deposit page.`,
      'zh-CN': `你最近一笔充值 ₱${amt} 未成功,可在充值页重新发起。`,
      id: `Deposit terbaru Anda sebesar ₱${amt} tidak berhasil. Anda bisa mencoba lagi di halaman Deposit.`,
      vi: `Khoản nạp gần nhất ₱${amt} không thành công. Bạn có thể thử lại trên trang Nạp tiền.`,
    })[lang]
  }

  // withdraw
  if (o.state === 'success')
    return ({
      en: `Your latest withdrawal of ₱${amt} has been completed ✅ (${time}).`,
      'zh-CN': `你最近一笔提现 ₱${amt} 已完成 ✅(${time})。`,
      id: `Penarikan terbaru Anda sebesar ₱${amt} sudah selesai ✅ (${time}).`,
      vi: `Lệnh rút gần nhất ₱${amt} đã hoàn tất ✅ (${time}).`,
    })[lang]
  if (o.state === 'pending')
    return ({
      en: `Your latest withdrawal of ₱${amt} is under review and being processed. Please wait a moment.`,
      'zh-CN': `你最近一笔提现 ₱${amt} 正在审核处理中,请耐心等待。`,
      id: `Penarikan terbaru Anda sebesar ₱${amt} sedang direview dan diproses. Mohon tunggu sebentar.`,
      vi: `Lệnh rút gần nhất ₱${amt} đang được xét duyệt và xử lý. Vui lòng chờ một chút.`,
    })[lang]
  return ({
    en: `Your latest withdrawal of ₱${amt} was not successful${o.rejectReason ? `. Reason: ${o.rejectReason}` : ''}.`,
    'zh-CN': `你最近一笔提现 ₱${amt} 未成功${o.rejectReason ? `,原因:${o.rejectReason}` : ''}。`,
    id: `Penarikan terbaru Anda sebesar ₱${amt} tidak berhasil${o.rejectReason ? `. Alasan: ${o.rejectReason}` : ''}.`,
    vi: `Lệnh rút gần nhất ₱${amt} không thành công${o.rejectReason ? `. Lý do: ${o.rejectReason}` : ''}.`,
  })[lang]
}
