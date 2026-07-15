import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { getPromoConfig } from '../promo-config.service.js'
import { getTurnoverProgress } from '../turnover.service.js'
import { isHumanOnDuty } from './cs-duty.js'
import { queryRecentOrders, type CsOrder } from './cs-orders.js'
import {
  escalateConversation,
  getConversationById,
  getOrCreateConversation,
  saveMessage,
} from './cs-store.js'

export interface DeterministicCsResult {
  reply: string
  conversationId: number
  status: string
}

export type CsReplyLocale = 'en' | 'zh-CN' | 'id' | 'vi'

export function normalizeCsReplyLocale(locale?: string): CsReplyLocale {
  if (locale?.startsWith('zh')) return 'zh-CN'
  if (locale?.startsWith('id')) return 'id'
  if (locale?.startsWith('vi')) return 'vi'
  return 'en'
}

export function csSessionEndedMessage(locale: CsReplyLocale): string {
  return ({
    en: 'This support session has ended. Start a new chat next time you open support.',
    'zh-CN': '本次客服会话已结束。下次打开客服会开启新的会话。',
    id: 'Sesi bantuan ini telah berakhir. Buka dukungan lagi untuk memulai chat baru.',
    vi: 'Phiên hỗ trợ này đã kết thúc. Mở lại hỗ trợ để bắt đầu chat mới.',
  })[locale]
}

function text(locale: CsReplyLocale) {
  return {
    loginRequired: {
      en: 'Please log in first so I can check your account information.',
      'zh-CN': '请先登录，我才能查询你的账号信息。',
      id: 'Silakan login terlebih dahulu agar saya bisa memeriksa informasi akun Anda.',
      vi: 'Vui lòng đăng nhập trước để tôi có thể kiểm tra thông tin tài khoản của bạn.',
    }[locale],
    humanHandling: {
      en: 'A human agent is handling this conversation and will reply here shortly. Please wait a moment.',
      'zh-CN': '人工客服正在处理本次会话，请稍等，客服会在这里回复你。',
      id: 'Agen manusia sedang menangani percakapan ini dan akan segera membalas di sini. Mohon tunggu sebentar.',
      vi: 'Nhân viên hỗ trợ đang xử lý cuộc trò chuyện này và sẽ phản hồi tại đây. Vui lòng chờ một chút.',
    }[locale],
    noDeposit: {
      en: 'No recent deposit order was found. Please make sure the payment was submitted successfully.',
      'zh-CN': '没有查到最近的充值订单。请确认付款是否已成功提交。',
      id: 'Tidak ditemukan order deposit terbaru. Pastikan pembayaran sudah berhasil dikirim.',
      vi: 'Không tìm thấy lệnh nạp gần đây. Vui lòng kiểm tra thanh toán đã gửi thành công chưa.',
    }[locale],
    noWithdrawal: {
      en: 'No recent withdrawal order was found. You can submit a withdrawal from the Wallet page.',
      'zh-CN': '没有查到最近的提现订单。你可以在钱包页面提交提现。',
      id: 'Tidak ditemukan order penarikan terbaru. Anda bisa mengajukan penarikan dari halaman Wallet.',
      vi: 'Không tìm thấy lệnh rút gần đây. Bạn có thể gửi yêu cầu rút tiền từ trang Ví.',
    }[locale],
    depositGuide: {
      en: 'Please open Wallet > Deposit to see live deposit methods and exact limits. Available channels and minimum amounts may change by payment provider.',
      'zh-CN': '请打开钱包 > 充值查看当前可用充值方式和准确限额。可用渠道和最低金额可能会随支付通道变化。',
      id: 'Buka Wallet > Deposit untuk melihat metode deposit dan limit terbaru. Channel dan minimum deposit bisa berubah sesuai penyedia pembayaran.',
      vi: 'Vui lòng mở Ví > Nạp tiền để xem phương thức nạp và hạn mức hiện tại. Kênh và mức tối thiểu có thể thay đổi theo nhà cung cấp.',
    }[locale],
    withdrawOk: {
      en: 'Your KYC is approved and your wagering requirements are complete. If you still cannot withdraw, please check your balance, withdrawal amount, and payment channel.',
      'zh-CN': '你的 KYC 已通过，流水要求也已完成。如果仍不能提现，请检查余额、提现金额和提现渠道。',
      id: 'KYC Anda sudah disetujui dan syarat taruhan sudah selesai. Jika masih tidak bisa menarik, cek saldo, jumlah penarikan, dan channel pembayaran.',
      vi: 'KYC của bạn đã được duyệt và yêu cầu cược đã hoàn thành. Nếu vẫn không thể rút, hãy kiểm tra số dư, số tiền rút và kênh thanh toán.',
    }[locale],
    gameGeneric: {
      en: 'Please send the game name and what happened, for example: cannot load, game crashed, missing settlement, or cannot find the game.',
      'zh-CN': '请发送游戏名称和具体问题，例如打不开、闪退卡住、结算异常或找不到游戏。',
      id: 'Kirim nama game dan masalahnya, misalnya tidak bisa dibuka, crash, settlement hilang, atau game tidak ditemukan.',
      vi: 'Vui lòng gửi tên game và vấn đề gặp phải, ví dụ không tải được, bị treo, lỗi kết toán hoặc không tìm thấy game.',
    }[locale],
    gameSettlement: {
      en: 'Please send the game name, bet time, round/order id, and what result you expected. Keep screenshots if balance or settlement is affected.',
      'zh-CN': '请发送游戏名称、投注时间、局号/订单号，以及你预期的结果。如果影响余额或结算，请保留截图。',
      id: 'Kirim nama game, waktu taruhan, round/order id, dan hasil yang Anda harapkan. Simpan screenshot jika saldo atau settlement terdampak.',
      vi: 'Vui lòng gửi tên game, thời gian cược, mã vòng/lệnh và kết quả bạn mong đợi. Hãy giữ ảnh chụp nếu ảnh hưởng số dư hoặc kết toán.',
    }[locale],
    gameAvailability: {
      en: 'Please send the game name or provider. I can help check whether it is available or under maintenance.',
      'zh-CN': '请发送游戏名称或供应商，我可以帮你确认是否可用或维护中。',
      id: 'Kirim nama game atau provider. Saya bisa bantu cek apakah tersedia atau sedang maintenance.',
      vi: 'Vui lòng gửi tên game hoặc nhà cung cấp. Tôi có thể giúp kiểm tra game có hoạt động hay đang bảo trì.',
    }[locale],
    accountGeneric: {
      en: 'Please describe the account or login issue, for example: cannot log in, account frozen, phone verification, or suspected account theft.',
      'zh-CN': '请描述账号或登录问题，例如无法登录、账号被冻结、手机验证问题或怀疑账号被盗。',
      id: 'Jelaskan masalah akun atau login, misalnya tidak bisa login, akun dibekukan, verifikasi telepon, atau dugaan akun dicuri.',
      vi: 'Vui lòng mô tả vấn đề tài khoản hoặc đăng nhập, ví dụ không thể đăng nhập, tài khoản bị khóa, xác minh điện thoại hoặc nghi bị đánh cắp.',
    }[locale],
    humanOnline: {
      en: 'A human agent is online and will reply here shortly. Please wait in this chat.',
      'zh-CN': '人工客服在线，会尽快在这里回复你，请在当前会话等待。',
      id: 'Agen manusia sedang online dan akan segera membalas di sini. Mohon tunggu di chat ini.',
      vi: 'Nhân viên hỗ trợ đang online và sẽ sớm phản hồi tại đây. Vui lòng chờ trong cuộc trò chuyện này.',
    }[locale],
  }
}

const DEPOSIT_INTENTS = new Set([
  'deposit_not_credited',
  'deposit_amount_wrong',
  'deposit_status',
  'deposit_method_limit',
])

const WITHDRAWAL_INTENTS = new Set([
  'withdrawal_status',
  'withdrawal_rejected',
  'withdrawal_amount_wrong',
  'withdrawal_arrival_time',
])

const CANNOT_WITHDRAW_INTENTS = new Set([
  'cannot_withdraw',
  'cannot_withdraw_kyc',
  'cannot_withdraw_turnover',
  'cannot_withdraw_pending',
])

const KYC_INTENTS = new Set([
  'kyc_help',
  'kyc_phone_issue',
  'kyc_document_issue',
  'kyc_face_issue',
  'kyc_rejected_reason',
])

const PROMO_INTENTS = new Set([
  'promotions',
  'promo_first_deposit',
  'promo_trial',
  'promo_reward_missing',
  'promo_rules',
])

const GAME_INTENTS = new Set([
  'game_issue',
  'game_cannot_open',
  'game_crashed',
  'game_settlement_issue',
  'game_missing',
  'game_maintenance',
])

const ACCOUNT_GUIDE_INTENTS = new Set([
  'account_issue',
  'account_login_issue',
  'account_bind_issue',
])

const HUMAN_REASON_BY_INTENT: Record<string, 'user_request' | 'money_dispute' | 'account_security' | 'complaint'> = {
  human_agent: 'user_request',
  human_complaint: 'complaint',
  human_money_dispute: 'money_dispute',
  human_account_security: 'account_security',
  account_frozen: 'account_security',
  account_security: 'account_security',
}

const DETERMINISTIC_INTENTS = new Set([
  ...DEPOSIT_INTENTS,
  ...WITHDRAWAL_INTENTS,
  ...CANNOT_WITHDRAW_INTENTS,
  ...KYC_INTENTS,
  ...PROMO_INTENTS,
  ...GAME_INTENTS,
  ...ACCOUNT_GUIDE_INTENTS,
  ...Object.keys(HUMAN_REASON_BY_INTENT),
])

function isGuest(userId: string): boolean {
  return userId.startsWith('guest:')
}

function canGuestUseIntent(intent: string): boolean {
  return intent === 'deposit_method_limit'
    || PROMO_INTENTS.has(intent)
    || GAME_INTENTS.has(intent)
    || ACCOUNT_GUIDE_INTENTS.has(intent)
    || Boolean(HUMAN_REASON_BY_INTENT[intent])
}

function money(amount: number, currency = 'PHP'): string {
  if (currency === 'PHP') return `₱${amount.toFixed(2)}`
  return `${amount.toFixed(2)} ${currency}`
}

function orderLine(order: CsOrder, kind: 'deposit' | 'withdraw', locale: CsReplyLocale): string {
  const action = kind === 'deposit'
    ? ({ en: 'deposit', 'zh-CN': '充值', id: 'deposit', vi: 'nạp tiền' })[locale]
    : ({ en: 'withdrawal', 'zh-CN': '提现', id: 'penarikan', vi: 'rút tiền' })[locale]
  if (order.state === 'success') {
    return ({
      en: `Your latest ${action} ${order.orderId} for ${order.amount} ${order.currency} is completed.`,
      'zh-CN': `你最近的${action}订单 ${order.orderId}（${order.amount} ${order.currency}）已完成。`,
      id: `${action} terbaru Anda ${order.orderId} sebesar ${order.amount} ${order.currency} sudah selesai.`,
      vi: `Lệnh ${action} gần nhất ${order.orderId} với số tiền ${order.amount} ${order.currency} đã hoàn tất.`,
    })[locale]
  }
  if (order.state === 'pending') {
    return ({
      en: `Your latest ${action} ${order.orderId} for ${order.amount} ${order.currency} is still processing.`,
      'zh-CN': `你最近的${action}订单 ${order.orderId}（${order.amount} ${order.currency}）仍在处理中。`,
      id: `${action} terbaru Anda ${order.orderId} sebesar ${order.amount} ${order.currency} masih diproses.`,
      vi: `Lệnh ${action} gần nhất ${order.orderId} với số tiền ${order.amount} ${order.currency} vẫn đang xử lý.`,
    })[locale]
  }
  const reason = order.rejectReason ? ` Reason: ${order.rejectReason}` : ''
  return ({
    en: `Your latest ${action} ${order.orderId} for ${order.amount} ${order.currency} was not successful.${reason}`,
    'zh-CN': `你最近的${action}订单 ${order.orderId}（${order.amount} ${order.currency}）未成功。${order.rejectReason ? `原因：${order.rejectReason}` : ''}`,
    id: `${action} terbaru Anda ${order.orderId} sebesar ${order.amount} ${order.currency} tidak berhasil.${order.rejectReason ? ` Alasan: ${order.rejectReason}` : ''}`,
    vi: `Lệnh ${action} gần nhất ${order.orderId} với số tiền ${order.amount} ${order.currency} không thành công.${order.rejectReason ? ` Lý do: ${order.rejectReason}` : ''}`,
  })[locale]
}

async function getKycRow(env: Env, userId: string): Promise<RowDataPacket | null> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT status, phone_verified, doc_verified, face_verified, reject_reason, reject_step, doc_submitted_at, face_submitted_at
     FROM bg_kyc WHERE user_id = ? LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}

function kycReply(row: RowDataPacket | null, locale: CsReplyLocale): string {
  if (!row || row.status === 'none') {
    return ({
      en: 'KYC verification has not been started yet. Please open KYC Setting and complete phone verification, then upload your ID and face photo if requested.',
      'zh-CN': '你还没有开始 KYC 认证。请打开 KYC 设置，先完成手机验证，再按要求上传证件和人脸照片。',
      id: 'Verifikasi KYC belum dimulai. Buka KYC Setting, selesaikan verifikasi telepon, lalu unggah ID dan foto wajah jika diminta.',
      vi: 'Bạn chưa bắt đầu xác minh KYC. Vui lòng mở KYC Setting, hoàn tất xác minh điện thoại, sau đó tải giấy tờ và ảnh khuôn mặt nếu được yêu cầu.',
    })[locale]
  }
  if (row.status === 'approved') {
    return ({
      en: 'Your KYC verification is already approved! You have successfully completed the process.',
      'zh-CN': '你的 KYC 认证已通过，流程已经完成。',
      id: 'Verifikasi KYC Anda sudah disetujui. Proses sudah selesai.',
      vi: 'KYC của bạn đã được duyệt. Bạn đã hoàn tất quy trình.',
    })[locale]
  }
  if (row.status === 'rejected') {
    return ({
      en: `Your KYC verification was rejected.${row.reject_reason ? ` Reason: ${row.reject_reason}.` : ''} Please open KYC Setting, fix the issue, and submit it again.`,
      'zh-CN': `你的 KYC 认证被拒绝。${row.reject_reason ? `原因：${row.reject_reason}。` : ''}请打开 KYC 设置，修正后重新提交。`,
      id: `Verifikasi KYC Anda ditolak.${row.reject_reason ? ` Alasan: ${row.reject_reason}.` : ''} Buka KYC Setting, perbaiki masalahnya, lalu kirim ulang.`,
      vi: `KYC của bạn bị từ chối.${row.reject_reason ? ` Lý do: ${row.reject_reason}.` : ''} Vui lòng mở KYC Setting, sửa vấn đề và gửi lại.`,
    })[locale]
  }
  if (!row.phone_verified) {
    return ({
      en: 'Your KYC verification is pending. Please complete phone verification in KYC Setting first.',
      'zh-CN': '你的 KYC 仍在待完成状态。请先在 KYC 设置里完成手机验证。',
      id: 'KYC Anda masih pending. Selesaikan verifikasi telepon di KYC Setting terlebih dahulu.',
      vi: 'KYC của bạn đang chờ hoàn tất. Vui lòng xác minh điện thoại trong KYC Setting trước.',
    })[locale]
  }
  if (row.doc_submitted_at || row.face_submitted_at) {
    return ({
      en: 'Your KYC verification is under review. Please wait for the review result in KYC Setting.',
      'zh-CN': '你的 KYC 正在审核中，请在 KYC 设置里等待审核结果。',
      id: 'KYC Anda sedang ditinjau. Tunggu hasil review di KYC Setting.',
      vi: 'KYC của bạn đang được xem xét. Vui lòng chờ kết quả trong KYC Setting.',
    })[locale]
  }
  return ({
    en: 'Your phone verification is complete. Please continue the remaining KYC steps in KYC Setting.',
    'zh-CN': '你的手机验证已完成。请继续在 KYC 设置里完成剩余认证步骤。',
    id: 'Verifikasi telepon sudah selesai. Lanjutkan langkah KYC berikutnya di KYC Setting.',
    vi: 'Bạn đã xác minh điện thoại. Vui lòng tiếp tục các bước KYC còn lại trong KYC Setting.',
  })[locale]
}

async function cannotWithdrawReply(env: Env, userId: string, locale: CsReplyLocale): Promise<string> {
  const kyc = await getKycRow(env, userId)
  if (!kyc || kyc.status !== 'approved') {
    const prefix = ({
      en: 'You cannot withdraw yet because KYC is not approved.',
      'zh-CN': '你暂时不能提现，因为 KYC 尚未通过。',
      id: 'Anda belum bisa menarik karena KYC belum disetujui.',
      vi: 'Bạn chưa thể rút tiền vì KYC chưa được duyệt.',
    })[locale]
    return `${prefix} ${kycReply(kyc, locale)}`
  }

  const turnover = await getTurnoverProgress(getMysqlPool(env), userId)
  if (!turnover.canWithdraw) {
    const pending = turnover.requirements.filter((r) => r.status === 'pending')
    const first = pending[0]
    const detail = first
      ? ({
          en: ` Latest requirement: ${money(first.requiredAmount - first.completedAmount, first.currency)} remaining from ${first.sourceType}.`,
          'zh-CN': `最近一项要求：${money(first.requiredAmount - first.completedAmount, first.currency)}，来源：${first.sourceType}。`,
          id: ` Syarat terbaru: tersisa ${money(first.requiredAmount - first.completedAmount, first.currency)} dari ${first.sourceType}.`,
          vi: ` Yêu cầu gần nhất: còn ${money(first.requiredAmount - first.completedAmount, first.currency)} từ ${first.sourceType}.`,
        })[locale]
      : ''
    return ({
      en: `You still need to complete wagering requirements before withdrawing. Total remaining: ${money(turnover.totalRemaining)}.${detail}`,
      'zh-CN': `提现前还需要完成流水要求。剩余总流水：${money(turnover.totalRemaining)}。${detail}`,
      id: `Anda masih perlu menyelesaikan syarat taruhan sebelum menarik. Total tersisa: ${money(turnover.totalRemaining)}.${detail}`,
      vi: `Bạn vẫn cần hoàn thành yêu cầu cược trước khi rút. Tổng còn lại: ${money(turnover.totalRemaining)}.${detail}`,
    })[locale]
  }

  const withdrawals = await queryRecentOrders(env, userId, 'withdraw')
  const latest = withdrawals[0]
  if (latest?.state === 'pending') return `${orderLine(latest, 'withdraw', locale)} ${({ en: 'Please wait for the review result.', 'zh-CN': '请等待审核结果。', id: 'Mohon tunggu hasil review.', vi: 'Vui lòng chờ kết quả xét duyệt.' })[locale]}`
  if (latest?.state === 'failed') return orderLine(latest, 'withdraw', locale)
  return text(locale).withdrawOk
}

async function promotionsReply(env: Env, locale: CsReplyLocale): Promise<string> {
  const cfg = await getPromoConfig(env)
  const lines: string[] = []
  if (cfg.trial.enabled) lines.push(({ en: `Free trial bonus: ${money(cfg.trial.amount)}, wagering ${cfg.trial.turnoverX}x.`, 'zh-CN': `免费体验金：${money(cfg.trial.amount)}，流水 ${cfg.trial.turnoverX}x。`, id: `Bonus trial gratis: ${money(cfg.trial.amount)}, syarat taruhan ${cfg.trial.turnoverX}x.`, vi: `Thưởng dùng thử miễn phí: ${money(cfg.trial.amount)}, yêu cầu cược ${cfg.trial.turnoverX}x.` })[locale])
  if (cfg.firstdep.enabled) {
    const tier = cfg.firstdep.tiers.PHP?.[0]
    const tierText = tier ? ({
      en: ` from deposit ${money(tier.depositAmount)} get ${money(tier.bonusAmount)}`,
      'zh-CN': `，充值 ${money(tier.depositAmount)} 可得 ${money(tier.bonusAmount)}`,
      id: ` dari deposit ${money(tier.depositAmount)} dapat ${money(tier.bonusAmount)}`,
      vi: `, nạp ${money(tier.depositAmount)} nhận ${money(tier.bonusAmount)}`,
    })[locale] : ''
    lines.push(({ en: `First deposit bonus is available${tierText}, wagering ${cfg.firstdep.turnoverX}x.`, 'zh-CN': `首充活动可用${tierText}，流水 ${cfg.firstdep.turnoverX}x。`, id: `Bonus deposit pertama tersedia${tierText}, syarat taruhan ${cfg.firstdep.turnoverX}x.`, vi: `Thưởng nạp lần đầu đang có${tierText}, yêu cầu cược ${cfg.firstdep.turnoverX}x.` })[locale])
  }
  if (cfg.appdl.enabled) lines.push(({ en: `App download bonus: ${money(cfg.appdl.amount)}, wagering ${cfg.appdl.turnoverX}x.`, 'zh-CN': `App 下载奖励：${money(cfg.appdl.amount)}，流水 ${cfg.appdl.turnoverX}x。`, id: `Bonus download app: ${money(cfg.appdl.amount)}, syarat taruhan ${cfg.appdl.turnoverX}x.`, vi: `Thưởng tải app: ${money(cfg.appdl.amount)}, yêu cầu cược ${cfg.appdl.turnoverX}x.` })[locale])
  if (cfg.redep.enabled) lines.push(({ en: `Reload offer: deposit from ${money(cfg.redep.minDeposit)} to get ${money(cfg.redep.bonusAmount)}.`, 'zh-CN': `复充活动：充值满 ${money(cfg.redep.minDeposit)} 可得 ${money(cfg.redep.bonusAmount)}。`, id: `Promo reload: deposit mulai ${money(cfg.redep.minDeposit)} dapat ${money(cfg.redep.bonusAmount)}.`, vi: `Ưu đãi nạp lại: nạp từ ${money(cfg.redep.minDeposit)} nhận ${money(cfg.redep.bonusAmount)}.` })[locale])
  if (cfg.lossRebate.enabled) lines.push(({ en: `Cashback: ${cfg.lossRebate.ratePct}% on eligible net loss.`, 'zh-CN': `负盈利返水：符合条件的净输可返 ${cfg.lossRebate.ratePct}%。`, id: `Cashback: ${cfg.lossRebate.ratePct}% untuk net loss yang memenuhi syarat.`, vi: `Hoàn tiền: ${cfg.lossRebate.ratePct}% trên khoản thua ròng đủ điều kiện.` })[locale])

  const [spinRows] = await getMysqlPool(env).query<RowDataPacket[]>(`SELECT enabled FROM bg_spin_config LIMIT 1`)
  if (spinRows[0]?.enabled === 1) lines.push(({ en: 'Rewards Spin is available for eligible deposits.', 'zh-CN': '符合条件的充值可参与 Rewards Spin。', id: 'Rewards Spin tersedia untuk deposit yang memenuhi syarat.', vi: 'Rewards Spin áp dụng cho khoản nạp đủ điều kiện.' })[locale])

  if (lines.length === 0) return ({ en: 'There are no active promotions right now. Please check the Bonuses page later.', 'zh-CN': '当前没有可用活动，请稍后查看优惠活动页面。', id: 'Saat ini tidak ada promosi aktif. Silakan cek halaman Bonuses nanti.', vi: 'Hiện không có khuyến mãi đang hoạt động. Vui lòng kiểm tra trang Khuyến mãi sau.' })[locale]
  return ({
    en: `Current promotions:\n${lines.map((line) => `- ${line}`).join('\n')}\nOpen the Bonuses page for full details and eligibility.`,
    'zh-CN': `当前活动：\n${lines.map((line) => `- ${line}`).join('\n')}\n请打开优惠活动页面查看完整规则和资格。`,
    id: `Promosi saat ini:\n${lines.map((line) => `- ${line}`).join('\n')}\nBuka halaman Bonuses untuk detail dan syarat lengkap.`,
    vi: `Khuyến mãi hiện tại:\n${lines.map((line) => `- ${line}`).join('\n')}\nMở trang Khuyến mãi để xem đầy đủ điều kiện và chi tiết.`,
  })[locale]
}

async function depositReply(env: Env, userId: string, locale: CsReplyLocale): Promise<string> {
  const orders = await queryRecentOrders(env, userId, 'deposit')
  const latest = orders[0]
  if (!latest) return text(locale).noDeposit
  return orderLine(latest, 'deposit', locale)
}

async function withdrawalReply(env: Env, userId: string, locale: CsReplyLocale): Promise<string> {
  const orders = await queryRecentOrders(env, userId, 'withdraw')
  const latest = orders[0]
  if (!latest) return text(locale).noWithdrawal
  return orderLine(latest, 'withdraw', locale)
}

function depositGuideReply(locale: CsReplyLocale): string {
  return text(locale).depositGuide
}

function gameGuideReply(intent: string, locale: CsReplyLocale): string {
  if (intent === 'game_settlement_issue') return text(locale).gameSettlement
  if (intent === 'game_missing' || intent === 'game_maintenance') return text(locale).gameAvailability
  return text(locale).gameGeneric
}

function accountGuideReply(intent: string, locale: CsReplyLocale): string {
  if (intent === 'account_login_issue') return ({ en: 'Please tell me which login method failed and what error you saw. You can also try reopening the Telegram Mini App and checking your network first.', 'zh-CN': '请告诉我哪种登录方式失败，以及看到的错误提示。也可以先尝试重新打开 Telegram Mini App 并检查网络。', id: 'Beri tahu metode login mana yang gagal dan error yang muncul. Anda juga bisa coba buka ulang Telegram Mini App dan cek jaringan.', vi: 'Vui lòng cho biết phương thức đăng nhập nào thất bại và lỗi hiển thị. Bạn cũng có thể thử mở lại Telegram Mini App và kiểm tra mạng.' })[locale]
  if (intent === 'account_bind_issue') return ({ en: 'Please tell me which binding has an issue: Telegram, Google, or phone. Include the error message if one appears.', 'zh-CN': '请告诉我是 Telegram、Google 还是手机绑定有问题；如果有错误提示，也请一起提供。', id: 'Beri tahu binding mana yang bermasalah: Telegram, Google, atau telepon. Sertakan pesan error jika ada.', vi: 'Vui lòng cho biết liên kết nào gặp vấn đề: Telegram, Google hoặc điện thoại. Hãy gửi kèm lỗi nếu có.' })[locale]
  return text(locale).accountGeneric
}

export async function handleDeterministicCsIntent(
  env: Env,
  userId: string,
  intent: string,
  userText: string,
  locale: CsReplyLocale = 'en',
): Promise<DeterministicCsResult | null> {
  if (!DETERMINISTIC_INTENTS.has(intent)) return null

  const conversation = await getOrCreateConversation(env, userId)
  const conversationId = conversation.id

  if (conversation.status === 'human_taken') {
    await saveMessage(env, conversationId, 'user', userText)
    const reply = text(locale).humanHandling
    return { reply, conversationId, status: 'human_taken' }
  }

  await saveMessage(env, conversationId, 'user', userText)

  let reply: string
  let status: string = conversation.status

  if (isGuest(userId) && !canGuestUseIntent(intent)) {
    reply = text(locale).loginRequired
  } else if (DEPOSIT_INTENTS.has(intent)) {
    reply = intent === 'deposit_method_limit' ? depositGuideReply(locale) : await depositReply(env, userId, locale)
  } else if (WITHDRAWAL_INTENTS.has(intent)) {
    reply = await withdrawalReply(env, userId, locale)
  } else if (CANNOT_WITHDRAW_INTENTS.has(intent)) {
    reply = await cannotWithdrawReply(env, userId, locale)
  } else if (KYC_INTENTS.has(intent)) {
    reply = kycReply(await getKycRow(env, userId), locale)
  } else if (PROMO_INTENTS.has(intent)) {
    reply = await promotionsReply(env, locale)
  } else if (GAME_INTENTS.has(intent)) {
    reply = gameGuideReply(intent, locale)
  } else if (ACCOUNT_GUIDE_INTENTS.has(intent)) {
    reply = accountGuideReply(intent, locale)
  } else if (HUMAN_REASON_BY_INTENT[intent]) {
    const onDuty = await isHumanOnDuty(env)
    const toStatus = onDuty ? 'human_taken' : 'escalated'
    status = toStatus
    await escalateConversation(env, conversationId, HUMAN_REASON_BY_INTENT[intent], toStatus)
    reply = onDuty
      ? text(locale).humanOnline
      : ({
          en: `No human agent is online right now. I have recorded this as ticket #${conversationId}, and an agent will follow up here as soon as one is available.`,
          'zh-CN': `当前没有人工客服在线。我已将问题记录为工单 #${conversationId}，客服上线后会在这里跟进。`,
          id: `Saat ini tidak ada agen manusia online. Saya sudah mencatat ini sebagai tiket #${conversationId}, dan agen akan menindaklanjuti di sini saat tersedia.`,
          vi: `Hiện không có nhân viên hỗ trợ online. Tôi đã ghi nhận thành ticket #${conversationId}, nhân viên sẽ phản hồi tại đây khi có thể.`,
        })[locale]
  } else {
    return null
  }

  await saveMessage(env, conversationId, status === 'human_taken' ? 'admin' : 'assistant', reply)
  const latest = await getConversationById(env, conversationId)
  return { reply, conversationId, status: latest?.status ?? status }
}
