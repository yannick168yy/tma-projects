import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Headphones, Loader2, LayoutGrid, CircleX, Ticket, ChevronLeft } from 'lucide-react'
import { sendCsIntent, fetchCsHistory, fetchCsWelcome, fetchCsOrders, sendCsMessageStream, markCsLeft, endCsConversation, fetchCsTickets, fetchCsTicket, markCsTicketRead, sendCsTicketMessage } from '@/api/cs'
import type { CsMessage, CsOrder, CsConversation, CsTicketItem } from '@/api/cs'
import { ApiError } from '@/api/client'
import { translateApiError } from '@/utils/translateApiError'
import { useAuthStore } from '@/stores/auth'

interface Props { onClose: () => void }

interface QuickNode {
  id: string
  label: string
  emoji?: string
  intent?: string
  orderKind?: 'deposit' | 'withdraw'
  children?: QuickNode[]
}

const QUICK_OPTIONS: QuickNode[] = [
  {
    id: 'deposit', label: 'Deposit issues', emoji: '💰', children: [
      { id: 'deposit_not_credited', label: 'Paid but balance not credited', intent: 'deposit_not_credited', orderKind: 'deposit' },
      { id: 'deposit_amount_wrong', label: 'Deposit amount is wrong', intent: 'deposit_amount_wrong' },
      { id: 'deposit_status', label: 'Check latest deposit status', intent: 'deposit_status', orderKind: 'deposit' },
      { id: 'deposit_method_limit', label: 'Deposit methods or minimum amount', intent: 'deposit_method_limit' },
    ],
  },
  {
    id: 'withdraw', label: 'Withdrawal issues', emoji: '💸', children: [
      { id: 'withdrawal_status', label: 'Check withdrawal status', intent: 'withdrawal_status', orderKind: 'withdraw' },
      { id: 'withdrawal_rejected', label: 'Withdrawal failed or rejected', intent: 'withdrawal_rejected' },
      { id: 'withdrawal_amount_wrong', label: 'Withdrawal amount is wrong', intent: 'withdrawal_amount_wrong' },
      { id: 'withdrawal_arrival_time', label: 'Withdrawal arrival time', intent: 'withdrawal_arrival_time' },
    ],
  },
  {
    id: 'cannot_withdraw', label: "Can't withdraw", emoji: '🔒', children: [
      { id: 'cannot_withdraw_unknown', label: "I don't know why", intent: 'cannot_withdraw' },
      { id: 'cannot_withdraw_kyc', label: 'KYC not approved', intent: 'cannot_withdraw_kyc' },
      { id: 'cannot_withdraw_turnover', label: 'Wagering requirement issue', intent: 'cannot_withdraw_turnover' },
      { id: 'cannot_withdraw_pending', label: 'Pending withdrawal issue', intent: 'cannot_withdraw_pending' },
    ],
  },
  {
    id: 'kyc', label: 'KYC verification', emoji: '🪪', children: [
      { id: 'kyc_help', label: 'Check my KYC status', intent: 'kyc_help' },
      { id: 'kyc_phone_issue', label: 'Phone verification issue', intent: 'kyc_phone_issue' },
      { id: 'kyc_document_issue', label: 'ID upload issue', intent: 'kyc_document_issue' },
      { id: 'kyc_face_issue', label: 'Face verification issue', intent: 'kyc_face_issue' },
      { id: 'kyc_rejected_reason', label: 'KYC rejected reason', intent: 'kyc_rejected_reason' },
    ],
  },
  {
    id: 'promotions', label: 'Bonuses & promotions', emoji: '🎁', children: [
      { id: 'promotions', label: 'Current promotions', intent: 'promotions' },
      { id: 'promo_first_deposit', label: 'First deposit bonus', intent: 'promo_first_deposit' },
      { id: 'promo_trial', label: 'Free trial bonus', intent: 'promo_trial' },
      { id: 'promo_reward_missing', label: 'Promotion reward missing', intent: 'promo_reward_missing' },
      { id: 'promo_rules', label: 'Promotion rules', intent: 'promo_rules' },
    ],
  },
  {
    id: 'game', label: 'Game issues', emoji: '🎮', children: [
      { id: 'game_cannot_open', label: "Game won't open", intent: 'game_cannot_open' },
      { id: 'game_crashed', label: 'Game crashed or froze', intent: 'game_crashed' },
      { id: 'game_settlement_issue', label: 'Bet settlement issue', intent: 'game_settlement_issue' },
      { id: 'game_missing', label: "Can't find a game", intent: 'game_missing' },
      { id: 'game_maintenance', label: 'Game maintenance', intent: 'game_maintenance' },
    ],
  },
  {
    id: 'account', label: 'Account & login', emoji: '👤', children: [
      { id: 'account_login_issue', label: "Can't log in", intent: 'account_login_issue' },
      { id: 'account_frozen', label: 'Account frozen', intent: 'account_frozen' },
      { id: 'account_bind_issue', label: 'Binding Telegram / Google / phone', intent: 'account_bind_issue' },
      { id: 'account_security', label: 'Suspected account theft', intent: 'account_security' },
    ],
  },
  {
    id: 'human', label: 'Talk to a human agent', emoji: '🧑‍💻', children: [
      { id: 'human_agent', label: 'I need a human agent', intent: 'human_agent' },
      { id: 'human_complaint', label: 'Complaint or refund', intent: 'human_complaint' },
      { id: 'human_money_dispute', label: 'Money dispute', intent: 'human_money_dispute' },
      { id: 'human_account_security', label: 'Urgent account security', intent: 'human_account_security' },
    ],
  },
  {
    id: 'cashback', label: 'Cashback / Cash rebate', emoji: '💎', children: [
      {
        id: 'cashback_turnover', label: 'Rebate turnover issue', children: [
          { id: 'cashback_turnover_missing', label: 'Bets not counted', intent: 'cashback_turnover_missing' },
          { id: 'cashback_game_category', label: 'Game category not counted', intent: 'cashback_game_category' },
          { id: 'cashback_time_range', label: 'Time range looks wrong', intent: 'cashback_time_range' },
          { id: 'cashback_currency', label: 'Multi-currency amount issue', intent: 'cashback_currency' },
        ],
      },
      { id: 'cashback_amount_wrong', label: 'Cash rebate amount is wrong', intent: 'cashback_amount_wrong' },
      { id: 'cashback_not_received', label: 'Cash rebate not received', intent: 'cashback_not_received' },
      { id: 'cashback_rate_wrong', label: 'Cash rebate rate is wrong', intent: 'cashback_rate_wrong' },
      { id: 'cashback_rules', label: 'Cash rebate rules', intent: 'cashback_rules' },
    ],
  },
  {
    id: 'loss_rebate', label: 'Loss rebate', emoji: '📉', children: [
      {
        id: 'loss_rebate_amount', label: 'Loss rebate amount issue', children: [
          { id: 'loss_rebate_net_loss_wrong', label: 'Net loss amount is wrong', intent: 'loss_rebate_net_loss_wrong' },
          { id: 'loss_rebate_deposit_threshold', label: 'Deposit threshold issue', intent: 'loss_rebate_deposit_threshold' },
          { id: 'loss_rebate_category', label: 'Game category not eligible', intent: 'loss_rebate_category' },
          { id: 'loss_rebate_period', label: 'Settlement period issue', intent: 'loss_rebate_period' },
        ],
      },
      { id: 'loss_rebate_not_received', label: 'Loss rebate not received', intent: 'loss_rebate_not_received' },
      { id: 'loss_rebate_eligibility', label: 'Am I eligible?', intent: 'loss_rebate_eligibility' },
      { id: 'loss_rebate_time', label: 'Settlement time', intent: 'loss_rebate_time' },
      { id: 'loss_rebate_rules', label: 'Loss rebate rules', intent: 'loss_rebate_rules' },
    ],
  },
  {
    id: 'vip', label: 'VIP system', emoji: '👑', children: [
      { id: 'vip_level_status', label: 'Check my VIP level', intent: 'vip_level_status' },
      { id: 'vip_not_upgraded', label: 'Why did I not upgrade?', intent: 'vip_not_upgraded' },
      { id: 'vip_growth_wrong', label: 'VIP growth / turnover issue', intent: 'vip_growth_wrong' },
      { id: 'vip_reward_missing', label: 'VIP reward missing', intent: 'vip_reward_missing' },
      { id: 'vip_benefits', label: 'VIP benefits', intent: 'vip_benefits' },
      { id: 'vip_retention', label: 'VIP retention / downgrade', intent: 'vip_retention' },
    ],
  },
  {
    id: 'tasks', label: 'Task system', emoji: '✅', children: [
      { id: 'task_status', label: 'Check task status', intent: 'task_status' },
      { id: 'task_not_approved', label: 'Task completed but not approved', intent: 'task_not_approved' },
      { id: 'task_reward_missing', label: 'Task reward missing', intent: 'task_reward_missing' },
      { id: 'task_social_verify_failed', label: 'Channel / community verification failed', intent: 'task_social_verify_failed' },
      { id: 'task_code_failed', label: 'Code verification failed', intent: 'task_code_failed' },
      { id: 'task_rules', label: 'Task rules', intent: 'task_rules' },
    ],
  },
]

type LocalMsg = CsMessage & { orders?: CsOrder[]; orderKind?: 'deposit' | 'withdraw' }
type CsView = 'chat' | 'tickets' | 'ticketDetail'

// 每个客服固定一套配色,Jenny/Jasmine 首字母都是 J,靠颜色区分
const AGENT_COLORS: Record<string, [string, string]> = {
  Mika: ['#FB7185', '#E11D48'],
  Jenny: ['#FBBF24', '#D97706'],
  Kaye: ['#34D399', '#059669'],
  Rina: ['#38BDF8', '#0284C7'],
  Lyca: ['#A78BFA', '#7C3AED'],
  Anne: ['#F472B6', '#DB2777'],
  Chloe: ['#2DD4BF', '#0D9488'],
  Jasmine: ['#FB923C', '#EA580C'],
  Ella: ['#818CF8', '#4F46E5'],
  Nica: ['#A3E635', '#65A30D'],
}

function agentColors(name: string): [string, string] {
  if (AGENT_COLORS[name]) return AGENT_COLORS[name]
  // 名池扩容但前端没跟上时,按名字 hash 稳定取一套,不至于全都撞成同一个颜色
  const palette = Object.values(AGENT_COLORS)
  const hash = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return palette[hash % palette.length]
}

function CsAvatar({ name }: { name: string }) {
  if (!name) {
    return (
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Headphones size={18} />
      </div>
    )
  }
  const [from, to] = agentColors(name)
  return (
    <div
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

type QuickLang = 'en' | 'zh-CN' | 'id' | 'vi'

const QUICK_LABELS: Record<string, Record<QuickLang, string>> = {
  deposit: { en: 'Deposit issues', 'zh-CN': '充值问题', id: 'Masalah deposit', vi: 'Vấn đề nạp tiền' },
  deposit_not_credited: { en: 'Paid but balance not credited', 'zh-CN': '已支付但余额没到账', id: 'Sudah bayar tapi saldo belum masuk', vi: 'Đã thanh toán nhưng chưa cộng tiền' },
  deposit_amount_wrong: { en: 'Deposit amount is wrong', 'zh-CN': '充值金额不对', id: 'Jumlah deposit tidak sesuai', vi: 'Số tiền nạp không đúng' },
  deposit_status: { en: 'Check latest deposit status', 'zh-CN': '查询最近充值状态', id: 'Cek status deposit terbaru', vi: 'Kiểm tra trạng thái nạp gần nhất' },
  deposit_method_limit: { en: 'Deposit methods or minimum amount', 'zh-CN': '充值方式或最低金额', id: 'Metode atau minimum deposit', vi: 'Phương thức hoặc mức nạp tối thiểu' },
  withdraw: { en: 'Withdrawal issues', 'zh-CN': '提现问题', id: 'Masalah penarikan', vi: 'Vấn đề rút tiền' },
  withdrawal_status: { en: 'Check withdrawal status', 'zh-CN': '查询提现进度', id: 'Cek status penarikan', vi: 'Kiểm tra trạng thái rút tiền' },
  withdrawal_rejected: { en: 'Withdrawal failed or rejected', 'zh-CN': '提现失败或被拒', id: 'Penarikan gagal atau ditolak', vi: 'Rút tiền thất bại hoặc bị từ chối' },
  withdrawal_amount_wrong: { en: 'Withdrawal amount is wrong', 'zh-CN': '提现金额不对', id: 'Jumlah penarikan tidak sesuai', vi: 'Số tiền rút không đúng' },
  withdrawal_arrival_time: { en: 'Withdrawal arrival time', 'zh-CN': '提现到账时间', id: 'Waktu penarikan masuk', vi: 'Thời gian tiền rút về' },
  cannot_withdraw: { en: "Can't withdraw", 'zh-CN': '无法提现', id: 'Tidak bisa menarik', vi: 'Không thể rút tiền' },
  cannot_withdraw_unknown: { en: "I don't know why", 'zh-CN': '不知道原因', id: 'Saya tidak tahu alasannya', vi: 'Tôi không biết lý do' },
  cannot_withdraw_kyc: { en: 'KYC not approved', 'zh-CN': 'KYC 未通过', id: 'KYC belum disetujui', vi: 'KYC chưa được duyệt' },
  cannot_withdraw_turnover: { en: 'Wagering requirement issue', 'zh-CN': '流水要求问题', id: 'Masalah syarat taruhan', vi: 'Vấn đề yêu cầu cược' },
  cannot_withdraw_pending: { en: 'Pending withdrawal issue', 'zh-CN': '有处理中提现', id: 'Masalah penarikan tertunda', vi: 'Có lệnh rút đang xử lý' },
  kyc: { en: 'KYC verification', 'zh-CN': 'KYC 认证', id: 'Verifikasi KYC', vi: 'Xác minh KYC' },
  kyc_help: { en: 'Check my KYC status', 'zh-CN': '查询我的 KYC 状态', id: 'Cek status KYC saya', vi: 'Kiểm tra trạng thái KYC' },
  kyc_phone_issue: { en: 'Phone verification issue', 'zh-CN': '手机验证问题', id: 'Masalah verifikasi telepon', vi: 'Vấn đề xác minh điện thoại' },
  kyc_document_issue: { en: 'ID upload issue', 'zh-CN': '证件上传问题', id: 'Masalah unggah ID', vi: 'Vấn đề tải giấy tờ' },
  kyc_face_issue: { en: 'Face verification issue', 'zh-CN': '人脸验证问题', id: 'Masalah verifikasi wajah', vi: 'Vấn đề xác minh khuôn mặt' },
  kyc_rejected_reason: { en: 'KYC rejected reason', 'zh-CN': 'KYC 被拒原因', id: 'Alasan KYC ditolak', vi: 'Lý do KYC bị từ chối' },
  promotions: { en: 'Bonuses & promotions', 'zh-CN': '优惠活动', id: 'Bonus & promosi', vi: 'Khuyến mãi & thưởng' },
  promo_first_deposit: { en: 'First deposit bonus', 'zh-CN': '首充活动', id: 'Bonus deposit pertama', vi: 'Thưởng nạp lần đầu' },
  promo_trial: { en: 'Free trial bonus', 'zh-CN': '免费体验金', id: 'Bonus trial gratis', vi: 'Thưởng dùng thử miễn phí' },
  promo_reward_missing: { en: 'Promotion reward missing', 'zh-CN': '活动奖励未到账', id: 'Hadiah promosi belum masuk', vi: 'Chưa nhận thưởng khuyến mãi' },
  promo_rules: { en: 'Promotion rules', 'zh-CN': '活动规则说明', id: 'Aturan promosi', vi: 'Quy tắc khuyến mãi' },
  game: { en: 'Game issues', 'zh-CN': '游戏问题', id: 'Masalah game', vi: 'Vấn đề trò chơi' },
  game_cannot_open: { en: "Game won't open", 'zh-CN': '游戏打不开', id: 'Game tidak bisa dibuka', vi: 'Không mở được game' },
  game_crashed: { en: 'Game crashed or froze', 'zh-CN': '游戏卡住或闪退', id: 'Game crash atau macet', vi: 'Game bị treo hoặc thoát' },
  game_settlement_issue: { en: 'Bet settlement issue', 'zh-CN': '投注结算异常', id: 'Masalah penyelesaian taruhan', vi: 'Vấn đề kết toán cược' },
  game_missing: { en: "Can't find a game", 'zh-CN': '找不到游戏', id: 'Tidak menemukan game', vi: 'Không tìm thấy game' },
  game_maintenance: { en: 'Game maintenance', 'zh-CN': '游戏维护', id: 'Game maintenance', vi: 'Game đang bảo trì' },
  account: { en: 'Account & login', 'zh-CN': '账号与登录', id: 'Akun & login', vi: 'Tài khoản & đăng nhập' },
  account_login_issue: { en: "Can't log in", 'zh-CN': '无法登录', id: 'Tidak bisa login', vi: 'Không thể đăng nhập' },
  account_frozen: { en: 'Account frozen', 'zh-CN': '账号被冻结', id: 'Akun dibekukan', vi: 'Tài khoản bị khóa' },
  account_bind_issue: { en: 'Binding Telegram / Google / phone', 'zh-CN': '绑定 Telegram / Google / 手机', id: 'Tautkan Telegram / Google / telepon', vi: 'Liên kết Telegram / Google / điện thoại' },
  account_security: { en: 'Suspected account theft', 'zh-CN': '怀疑账号被盗', id: 'Diduga akun dicuri', vi: 'Nghi tài khoản bị đánh cắp' },
  human: { en: 'Talk to a human agent', 'zh-CN': '转人工客服', id: 'Bicara dengan agen', vi: 'Gặp nhân viên hỗ trợ' },
  human_agent: { en: 'I need a human agent', 'zh-CN': '我要人工客服', id: 'Saya perlu agen manusia', vi: 'Tôi cần nhân viên hỗ trợ' },
  human_complaint: { en: 'Complaint or refund', 'zh-CN': '投诉或退款', id: 'Keluhan atau refund', vi: 'Khiếu nại hoặc hoàn tiền' },
  human_money_dispute: { en: 'Money dispute', 'zh-CN': '资金争议', id: 'Sengketa dana', vi: 'Tranh chấp tiền' },
  human_account_security: { en: 'Urgent account security', 'zh-CN': '紧急账号安全', id: 'Keamanan akun mendesak', vi: 'Bảo mật tài khoản khẩn cấp' },
  cashback: { en: 'Cashback / Cash rebate', 'zh-CN': 'Cashback / 洗码', id: 'Cashback / rebate taruhan', vi: 'Cashback / hoàn cược' },
  cashback_turnover: { en: 'Rebate turnover issue', 'zh-CN': '洗码流水异常', id: 'Masalah turnover rebate', vi: 'Vấn đề doanh số hoàn cược' },
  cashback_turnover_missing: { en: 'Bets not counted', 'zh-CN': '投注未计入', id: 'Taruhan tidak dihitung', vi: 'Cược không được tính' },
  cashback_game_category: { en: 'Game category not counted', 'zh-CN': '游戏类型未计入', id: 'Kategori game tidak dihitung', vi: 'Loại game không được tính' },
  cashback_time_range: { en: 'Time range looks wrong', 'zh-CN': '统计时间不对', id: 'Rentang waktu tidak sesuai', vi: 'Khoảng thời gian không đúng' },
  cashback_currency: { en: 'Multi-currency amount issue', 'zh-CN': '多币种金额问题', id: 'Masalah multi-mata uang', vi: 'Vấn đề nhiều loại tiền' },
  cashback_amount_wrong: { en: 'Cash rebate amount is wrong', 'zh-CN': '洗码金额不对', id: 'Jumlah cash rebate salah', vi: 'Số tiền hoàn cược không đúng' },
  cashback_not_received: { en: 'Cash rebate not received', 'zh-CN': '洗码未到账', id: 'Cash rebate belum diterima', vi: 'Chưa nhận hoàn cược' },
  cashback_rate_wrong: { en: 'Cash rebate rate is wrong', 'zh-CN': '洗码比例不对', id: 'Rate cash rebate salah', vi: 'Tỷ lệ hoàn cược không đúng' },
  cashback_rules: { en: 'Cash rebate rules', 'zh-CN': '洗码规则说明', id: 'Aturan cash rebate', vi: 'Quy tắc hoàn cược' },
  loss_rebate: { en: 'Loss rebate', 'zh-CN': '负盈利返水', id: 'Rebate kerugian', vi: 'Hoàn tiền thua lỗ' },
  loss_rebate_amount: { en: 'Loss rebate amount issue', 'zh-CN': '负盈利金额问题', id: 'Masalah jumlah rebate kerugian', vi: 'Vấn đề số tiền hoàn thua lỗ' },
  loss_rebate_net_loss_wrong: { en: 'Net loss amount is wrong', 'zh-CN': '净输金额不对', id: 'Net loss tidak sesuai', vi: 'Số tiền thua ròng không đúng' },
  loss_rebate_deposit_threshold: { en: 'Deposit threshold issue', 'zh-CN': '存款门槛问题', id: 'Masalah syarat deposit', vi: 'Vấn đề ngưỡng nạp tiền' },
  loss_rebate_category: { en: 'Game category not eligible', 'zh-CN': '游戏类型不符合', id: 'Kategori game tidak memenuhi syarat', vi: 'Loại game không đủ điều kiện' },
  loss_rebate_period: { en: 'Settlement period issue', 'zh-CN': '结算周期问题', id: 'Masalah periode settlement', vi: 'Vấn đề kỳ kết toán' },
  loss_rebate_not_received: { en: 'Loss rebate not received', 'zh-CN': '负盈利返水未到账', id: 'Rebate kerugian belum diterima', vi: 'Chưa nhận hoàn thua lỗ' },
  loss_rebate_eligibility: { en: 'Am I eligible?', 'zh-CN': '是否符合条件', id: 'Apakah saya memenuhi syarat?', vi: 'Tôi có đủ điều kiện không?' },
  loss_rebate_time: { en: 'Settlement time', 'zh-CN': '结算时间', id: 'Waktu settlement', vi: 'Thời gian kết toán' },
  loss_rebate_rules: { en: 'Loss rebate rules', 'zh-CN': '负盈利返水规则', id: 'Aturan rebate kerugian', vi: 'Quy tắc hoàn thua lỗ' },
  vip: { en: 'VIP system', 'zh-CN': 'VIP体系', id: 'Sistem VIP', vi: 'Hệ thống VIP' },
  vip_level_status: { en: 'Check my VIP level', 'zh-CN': '查询 VIP 等级', id: 'Cek level VIP saya', vi: 'Kiểm tra cấp VIP' },
  vip_not_upgraded: { en: 'Why did I not upgrade?', 'zh-CN': '为什么没升级', id: 'Kenapa belum naik level?', vi: 'Vì sao chưa lên cấp?' },
  vip_growth_wrong: { en: 'VIP growth / turnover issue', 'zh-CN': 'VIP成长值/流水异常', id: 'Masalah growth / turnover VIP', vi: 'Vấn đề điểm tăng trưởng / doanh số VIP' },
  vip_reward_missing: { en: 'VIP reward missing', 'zh-CN': 'VIP奖励未到账', id: 'Reward VIP belum diterima', vi: 'Chưa nhận thưởng VIP' },
  vip_benefits: { en: 'VIP benefits', 'zh-CN': 'VIP权益说明', id: 'Benefit VIP', vi: 'Quyền lợi VIP' },
  vip_retention: { en: 'VIP retention / downgrade', 'zh-CN': 'VIP保级/降级', id: 'Retensi / turun level VIP', vi: 'Giữ cấp / hạ cấp VIP' },
  tasks: { en: 'Task system', 'zh-CN': '任务体系', id: 'Sistem tugas', vi: 'Hệ thống nhiệm vụ' },
  task_status: { en: 'Check task status', 'zh-CN': '查询任务状态', id: 'Cek status tugas', vi: 'Kiểm tra trạng thái nhiệm vụ' },
  task_not_approved: { en: 'Task completed but not approved', 'zh-CN': '任务完成但未通过', id: 'Tugas selesai tapi belum disetujui', vi: 'Nhiệm vụ hoàn thành nhưng chưa duyệt' },
  task_reward_missing: { en: 'Task reward missing', 'zh-CN': '任务奖励未到账', id: 'Reward tugas belum diterima', vi: 'Chưa nhận thưởng nhiệm vụ' },
  task_social_verify_failed: { en: 'Channel / community verification failed', 'zh-CN': '频道/社区验证失败', id: 'Verifikasi channel / komunitas gagal', vi: 'Xác minh kênh / cộng đồng thất bại' },
  task_code_failed: { en: 'Code verification failed', 'zh-CN': '验证码验证失败', id: 'Verifikasi kode gagal', vi: 'Xác minh mã thất bại' },
  task_rules: { en: 'Task rules', 'zh-CN': '任务规则说明', id: 'Aturan tugas', vi: 'Quy tắc nhiệm vụ' },
}

function normalizeQuickLang(language?: string): QuickLang {
  if (language?.startsWith('zh')) return 'zh-CN'
  if (language?.startsWith('id')) return 'id'
  if (language?.startsWith('vi')) return 'vi'
  return 'en'
}

const ORDER_STATE_CLASS: Record<string, string> = {
  success: 'bg-green-500/15 text-green-400',
  pending: 'bg-yellow-500/15 text-yellow-500',
  failed: 'bg-red-500/15 text-red-400',
}

export default function CustomerServicePage({ onClose }: Props) {
  const { t, i18n } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const [messages, setMessages] = useState<LocalMsg[]>([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [conversationStatus, setConversationStatus] = useState('active')
  const [welcome, setWelcome] = useState('')
  const [agentName, setAgentName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [quickPath, setQuickPath] = useState<QuickNode[]>([])
  const [streamingId, setStreamingId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<CsView>('chat')
  const [tickets, setTickets] = useState<CsTicketItem[]>([])
  const [ticketUnreadCount, setTicketUnreadCount] = useState(0)
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState<CsConversation | null>(null)
  const [selectedTicketMessages, setSelectedTicketMessages] = useState<CsMessage[]>([])
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false)
  const [ticketReplyText, setTicketReplyText] = useState('')
  const [ticketReplying, setTicketReplying] = useState(false)
  const msgRef = useRef<HTMLDivElement>(null)
  const leftSentRef = useRef(false)
  const endedRef = useRef(false)
  const conversationEnded = conversationStatus === 'closed' || conversationStatus === 'resolved'
  const quickLang = normalizeQuickLang(i18n.resolvedLanguage || i18n.language)
  const currentQuickParent = quickPath[quickPath.length - 1]
  const currentQuickOptions = currentQuickParent?.children ?? QUICK_OPTIONS
  const quickTitle = currentQuickParent ? quickLabel(currentQuickParent) : t('cs.quickMenuTitle')
  const agentLabel = agentName || t('cs.title')

  function quickLabel(node: QuickNode) {
    return QUICK_LABELS[node.id]?.[quickLang] ?? node.label
  }

  function scrollToBottom() {
    setTimeout(() => { if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight }, 0)
  }

  async function loadTickets() {
    if (!isLoggedIn) {
      setTickets([])
      setTicketUnreadCount(0)
      return
    }
    setTicketsLoading(true)
    try {
      const res = await fetchCsTickets()
      setTickets(res.items)
      setTicketUnreadCount(res.unreadCount)
    } catch {
      /* 工单入口不影响当前聊天 */
    } finally {
      setTicketsLoading(false)
    }
  }

  async function openTicketList() {
    setMenuOpen(false)
    setViewMode('tickets')
    await loadTickets()
  }

  async function openTicketDetail(ticketId: number) {
    setViewMode('ticketDetail')
    setTicketDetailLoading(true)
    try {
      const res = await fetchCsTicket(ticketId)
      setSelectedTicket(res.conversation)
      setSelectedTicketMessages(res.messages)
      await markCsTicketRead(ticketId).catch(() => {})
      await loadTickets()
    } catch {
      setViewMode('tickets')
    } finally {
      setTicketDetailLoading(false)
    }
  }

  async function sendTicketReply() {
    const text = ticketReplyText.trim()
    if (!selectedTicket || !text || ticketReplying) return
    setTicketReplying(true)
    try {
      const res = await sendCsTicketMessage(selectedTicket.id, text)
      setSelectedTicketMessages((prev) => [...prev, res.message])
      if (res.conversation) setSelectedTicket(res.conversation)
      setTicketReplyText('')
      await loadTickets()
    } catch {
      /* 保持输入内容，用户可重试 */
    } finally {
      setTicketReplying(false)
    }
  }

  useEffect(() => {
    // 开场白要等客服名到位再渲染,否则首页图片抢带宽时会先闪一版没名字的兜底文案
    const welcomeReady = fetchCsWelcome()
      .then((res) => { setWelcome(res.welcome); setAgentName(res.agentName) })
      .catch(() => {})
    if (!isLoggedIn) { void welcomeReady.finally(() => setLoading(false)); return }
    const historyReady = fetchCsHistory()
      .then((res) => { setMessages(res.messages); setConversationStatus(res.conversation.status); setAgentName(res.conversation.agentName) })
      .catch(() => {})
    void Promise.all([welcomeReady, historyReady, loadTickets()]).finally(() => { setLoading(false); scrollToBottom() })
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return
    const timer = window.setInterval(() => { void loadTickets() }, 15000)
    return () => window.clearInterval(timer)
  }, [isLoggedIn])

  useEffect(() => {
    endedRef.current = conversationEnded
  }, [conversationEnded])

  useEffect(() => {
    const shouldSyncHumanChat = isLoggedIn
      && !sending
      && !conversationEnded
      && (conversationStatus === 'human_taken' || conversationStatus === 'escalated')
    if (!shouldSyncHumanChat) return

    const sync = async () => {
      try {
        const res = await fetchCsHistory()
        setMessages((prev) => {
          if (prev.at(-1)?.id !== res.messages.at(-1)?.id) scrollToBottom()
          return res.messages
        })
        setConversationStatus(res.conversation.status)
        setAgentName(res.conversation.agentName)
        void loadTickets()
      } catch {
        /* 下次轮询再同步 */
      }
    }

    const timer = window.setInterval(() => { void sync() }, 5000)
    return () => window.clearInterval(timer)
  }, [conversationEnded, conversationStatus, isLoggedIn, sending])

  useEffect(() => () => {
    if (!leftSentRef.current && !endedRef.current) {
      leftSentRef.current = true
      markCsLeft().catch(() => {})
    }
  }, [])

  function closePage() {
    if (!leftSentRef.current && !conversationEnded) {
      leftSentRef.current = true
      markCsLeft().catch(() => {})
    }
    onClose()
  }

  async function endConversation() {
    if (sending || conversationEnded) return
    setSending(true)
    try {
      const res = await endCsConversation(quickLang)
      endedRef.current = true
      leftSentRef.current = true
      setConversationStatus(res.conversation?.status ?? 'closed')
      setMenuOpen(false)
      const notice: LocalMsg = { id: Date.now(), conversationId: res.conversation?.id ?? 0, role: 'assistant', content: res.message || t('cs.sessionEndedNotice'), createdAt: new Date().toISOString() }
      setMessages((prev) => [...prev, notice])
      scrollToBottom()
    } catch (e) {
      const content = e instanceof ApiError ? translateApiError(e.message, t) : t('cs.sendFailed')
      setMessages((prev) => [...prev, { id: Date.now(), conversationId: 0, role: 'assistant', content, createdAt: new Date().toISOString() }])
    } finally {
      setSending(false)
    }
  }

  async function dispatch(displayText: string, request: () => Promise<{ reply: string; conversationId: number; status: string }>) {
    if (conversationEnded) return
    const userMsg: CsMessage = { id: Date.now(), conversationId: 0, role: 'user', content: displayText, createdAt: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    scrollToBottom()
    setSending(true)
    try {
      const res = await request()
      setConversationStatus(res.status)
      void loadTickets()
      const reply: CsMessage = { id: Date.now() + 1, conversationId: res.conversationId, role: res.status === 'human_taken' ? 'admin' : 'assistant', content: res.reply, createdAt: new Date().toISOString() }
      setMessages((prev) => [...prev, reply])
      scrollToBottom()
    } catch (e) {
      const content = e instanceof ApiError ? translateApiError(e.message, t) : t('cs.sendFailed')
      const errMsg: CsMessage = { id: Date.now() + 1, conversationId: 0, role: 'assistant', content, createdAt: new Date().toISOString() }
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setSending(false)
    }
  }

  async function send() {
    const text = inputText.trim()
    if (!text || sending || conversationEnded) return
    setInputText('')
    const userMsg: LocalMsg = { id: Date.now(), conversationId: 0, role: 'user', content: text, createdAt: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    scrollToBottom()
    setSending(true)
    let assistantId: number | null = null
    const ensure = (init: string): number => {
      if (assistantId === null) {
        assistantId = Date.now() + 1
        const id = assistantId
        setMessages((prev) => [...prev, { id, conversationId: 0, role: 'assistant', content: init, createdAt: new Date().toISOString() }])
        setStreamingId(id)
      }
      return assistantId
    }
    try {
      await sendCsMessageStream(text, quickLang, {
        onDelta: (d) => {
          if (assistantId === null) ensure(d)
          else {
            const id = assistantId
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + d } : m)))
          }
          scrollToBottom()
        },
        onDone: (r) => { setConversationStatus(r.status); void loadTickets() },
        onError: (msg) => {
          const content = translateApiError(msg, t)
          const id = ensure(content)
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content || content } : m)))
        },
      })
    } catch {
      const content = t('cs.sendFailed')
      const id = ensure(content)
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content || content } : m)))
    } finally {
      setSending(false)
      setStreamingId(null)
    }
  }

  async function queryOrders(kind: 'deposit' | 'withdraw', label: string) {
    if (conversationEnded) return
    const userMsg: LocalMsg = { id: Date.now(), conversationId: 0, role: 'user', content: label, createdAt: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    scrollToBottom()
    setSending(true)
    try {
      const { orders } = await fetchCsOrders(kind)
      const card: LocalMsg = { id: Date.now() + 1, conversationId: 0, role: 'assistant', content: '', orders, orderKind: kind, createdAt: new Date().toISOString() }
      setMessages((prev) => [...prev, card])
      scrollToBottom()
    } catch (e) {
      const content = e instanceof ApiError ? translateApiError(e.message, t) : t('cs.sendFailed')
      setMessages((prev) => [...prev, { id: Date.now() + 1, conversationId: 0, role: 'assistant', content, createdAt: new Date().toISOString() }])
    } finally {
      setSending(false)
    }
  }

  async function sendQuickOption(intent: string, label: string, orderKind?: 'deposit' | 'withdraw') {
    if (sending || conversationEnded) return
    setQuickPath([])
    // 存款/提现是确定性查询:登录用户直接查库秒回,不经 AI
    if (orderKind && isLoggedIn) { await queryOrders(orderKind, label); return }
    await dispatch(label, () => sendCsIntent(intent, quickLang))
  }

  function handleQuickNode(node: QuickNode) {
    if (node.children?.length) {
      setQuickPath((prev) => [...prev, node])
      return
    }
    if (!node.intent) return
    setMenuOpen(false)
    void sendQuickOption(node.intent, quickLabel(node), node.orderKind)
  }

  function backQuickMenu() {
    setQuickPath((prev) => prev.slice(0, -1))
  }

  function onKeydown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  function statusText(status?: string) {
    return ({
      active: t('cs.status.active'),
      escalated: t('cs.status.escalated'),
      human_taken: t('cs.status.humanTaken'),
      resolved: t('cs.status.resolved'),
      closed: t('cs.status.closed'),
    } as Record<string, string>)[status ?? ''] ?? status
  }

  function statusClass(status?: string) {
    return ({
      active: 'bg-blue-500/15 text-blue-500',
      escalated: 'bg-yellow-500/15 text-yellow-500',
      human_taken: 'bg-orange-500/15 text-orange-500',
      resolved: 'bg-emerald-500/15 text-emerald-500',
      closed: 'bg-muted text-muted-foreground',
    } as Record<string, string>)[status ?? ''] ?? 'bg-muted text-muted-foreground'
  }

  function ticketMessageAuthor(role: CsMessage['role'] | null) {
    if (role === 'user') return t('cs.ticket.you')
    if (role === 'admin') return t('cs.ticket.agent')
    if (role === 'assistant') return t('cs.ticket.ai')
    return ''
  }

  function ticketAuthorClass(role: CsMessage['role']) {
    if (role === 'user') return 'border-primary/30 bg-primary/5 text-primary'
    if (role === 'admin') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
    return 'border-blue-500/30 bg-blue-500/10 text-blue-500'
  }

  if (viewMode === 'tickets') {
    return (
      <div className="page-scroll hide-scrollbar flex flex-col" style={{ height: '100%' }}>
        <div className="app-safe-header flex items-center gap-3 border-b border-border bg-card px-4 pb-3 pt-3 flex-shrink-0">
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground" onClick={() => setViewMode('chat')}>
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1">
            <p className="text-sm font-bold text-foreground">{t('cs.ticket.title')}</p>
            <p className="text-xs text-muted-foreground">{t('cs.ticket.subtitle')}</p>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground p-1" onClick={closePage}>
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!isLoggedIn ? (
            <div className="rounded-xl border border-border bg-card px-3 py-3 text-sm text-muted-foreground">{t('cs.ticket.loginRequired')}</div>
          ) : ticketsLoading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          ) : tickets.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">{t('cs.ticket.empty')}</div>
          ) : (
            <div className="space-y-2">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-left active:bg-secondary"
                  onClick={() => void openTicketDetail(ticket.id)}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-foreground">Ticket #{ticket.id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(ticket.status)}`}>{statusText(ticket.status)}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {ticketMessageAuthor(ticket.lastMessageRole)}{ticket.lastMessageRole ? ': ' : ''}{ticket.lastMessage || t('cs.ticket.noMessage')}
                    </p>
                    {ticket.unreadAdminMessages > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                        {ticket.unreadAdminMessages > 99 ? '99+' : ticket.unreadAdminMessages}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(ticket.updatedAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (viewMode === 'ticketDetail') {
    return (
      <div className="hide-scrollbar flex flex-col overflow-hidden" style={{ height: '100%', minHeight: 0 }}>
        <div className="app-safe-header flex items-center gap-3 border-b border-border bg-card px-4 pb-3 pt-3 flex-shrink-0">
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground" onClick={() => setViewMode('tickets')}>
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1">
            <p className="text-sm font-bold text-foreground">Ticket #{selectedTicket?.id ?? ''}</p>
            <p className="text-xs text-muted-foreground">{statusText(selectedTicket?.status)}</p>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground p-1" onClick={closePage}>
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {ticketDetailLoading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {selectedTicketMessages.map((msg) => (
                <div key={msg.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${ticketAuthorClass(msg.role)}`}>
                      {ticketMessageAuthor(msg.role)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{formatDateTime(msg.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{msg.content}</p>
                </div>
              ))}
              {selectedTicketMessages.length === 0 && (
                <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">{t('cs.ticket.noMessage')}</div>
              )}
            </>
          )}
        </div>
        <div className="flex-shrink-0 border-t border-border bg-card px-3 pt-2.5" style={{ paddingBottom: 'max(10px, var(--app-safe-bottom))' }}>
          <div className="flex gap-2 items-end">
            <textarea
              value={ticketReplyText}
              rows={2}
              placeholder={t('cs.ticket.replyPlaceholder')}
              className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              style={{ maxHeight: '96px', overflowY: 'auto' }}
              disabled={ticketReplying}
              onChange={(e) => setTicketReplyText(e.target.value)}
            />
            <button
              type="button"
              className="flex h-10 min-w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary px-3 text-primary-foreground disabled:opacity-40"
              disabled={!ticketReplyText.trim() || ticketReplying || !selectedTicket}
              onClick={() => void sendTicketReply()}
            >
              {ticketReplying ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-scroll hide-scrollbar flex flex-col" style={{ height: '100%' }}>
      <div className="app-safe-header flex items-center gap-3 border-b border-border bg-card px-4 pb-3 pt-3 flex-shrink-0">
        <CsAvatar name={agentName} />
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground">{agentName || t('cs.title')}</p>
          <p className="text-xs text-muted-foreground">
            {conversationEnded ? t('cs.sessionEndedStatus') : conversationStatus === 'human_taken' ? t('cs.humanService') : conversationStatus === 'escalated' ? t('cs.escalatedService') : t('cs.onlineStatus')}
          </p>
        </div>
        <button
          type="button"
          className="relative flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          onClick={() => void openTicketList()}
        >
          <Ticket size={14} />
          <span>{t('cs.ticket.entry')}</span>
          {ticketUnreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {ticketUnreadCount > 99 ? '99+' : ticketUnreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40"
          disabled={sending || conversationEnded}
          onClick={() => void endConversation()}
        >
          <CircleX size={14} />
          <span>{t('cs.endSession')}</span>
        </button>
        <button type="button" className="text-muted-foreground hover:text-foreground p-1" onClick={closePage}>
          <span className="text-lg leading-none">×</span>
        </button>
      </div>

      <div ref={msgRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {messages.length === 0 && (
              <>
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-secondary px-3.5 py-2.5">
                    <p className="text-xs text-muted-foreground mb-1">{agentLabel}</p>
                    <p className="text-sm text-foreground">{welcome || t('cs.welcome')}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-muted-foreground">{quickTitle}</p>
                  {quickPath.length > 0 && (
                    <button type="button" className="text-xs font-semibold text-primary" onClick={backQuickMenu}>
                      Back
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {currentQuickOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={sending || conversationEnded}
                      className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-foreground active:bg-secondary disabled:opacity-40"
                      onClick={() => handleQuickNode(opt)}
                    >
                      {opt.emoji && <span>{opt.emoji}</span>}
                      <span className="flex-1 leading-tight">{quickLabel(opt)}</span>
                      {opt.children?.length && <span className="text-muted-foreground">›</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`${msg.orders ? 'max-w-[92%]' : 'max-w-[85%]'} rounded-2xl px-3.5 py-2.5 ${msg.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-secondary text-foreground'}`}>
                  {msg.role !== 'user' && <p className="text-xs text-muted-foreground mb-1">{msg.role === 'assistant' ? agentLabel : t('cs.agentLabel')}</p>}
                  {msg.orders ? (
                    <div>
                      <p className="mb-2 text-sm text-foreground">{t(msg.orderKind === 'deposit' ? 'cs.orders.depositIntro' : 'cs.orders.withdrawIntro')}</p>
                      {msg.orders.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t('cs.orders.empty')}</p>
                      ) : (
                        <div className="space-y-2">
                          {msg.orders.map((o) => (
                            <div key={o.orderId} className="rounded-xl border border-border bg-card px-3 py-2.5">
                              <div className="mb-1.5 flex items-center justify-between gap-2">
                                <span className="text-sm font-bold text-foreground">{o.amount} {o.currency}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATE_CLASS[o.state]}`}>
                                  {t(`cs.orders.${msg.orderKind}_${o.state}`)}
                                </span>
                              </div>
                              <div className="space-y-0.5 text-xs text-muted-foreground">
                                <div className="flex justify-between gap-3"><span>{t('cs.orders.orderId')}</span><span className="font-mono text-foreground/70">{o.orderId}</span></div>
                                <div className="flex justify-between gap-3"><span>{t('cs.orders.channel')}</span><span>{o.channel}</span></div>
                                <div className="flex justify-between gap-3"><span>{t('cs.orders.createdAt')}</span><span>{formatDateTime(o.createdAt)}</span></div>
                                {o.settledAt && (
                                  <div className="flex justify-between gap-3">
                                    <span>{t(msg.orderKind === 'deposit' ? 'cs.orders.creditedAt' : 'cs.orders.completedAt')}</span>
                                    <span>{formatDateTime(o.settledAt)}</span>
                                  </div>
                                )}
                                {o.rejectReason && (
                                  <div className="flex justify-between gap-3"><span>{t('cs.orders.rejectReason')}</span><span className="text-red-400">{o.rejectReason}</span></div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">{t('cs.orders.footerHelp')}</p>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                  <p className="text-[10px] mt-1 opacity-60 text-right">{formatTime(msg.createdAt)}</p>
                </div>
              </div>
            ))}
            {sending && streamingId === null && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-sm bg-secondary px-3.5 py-2.5">
                  <p className="text-xs text-muted-foreground mb-1">{agentLabel}</p>
                  <div className="flex gap-1 items-center h-5">
                    {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                  </div>
                </div>
              </div>
            )}
            {conversationEnded && (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-center text-xs text-muted-foreground">
                {t('cs.sessionEndedHint')}
              </div>
            )}
          </>
        )}
      </div>

      <div className="relative flex-shrink-0 border-t border-border bg-card px-3 py-2.5">
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute bottom-full left-0 right-0 z-20 mb-2 px-3">
              <div className="rounded-2xl border border-border bg-card p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{quickTitle}</p>
                  {quickPath.length > 0 && (
                    <button type="button" className="text-xs font-semibold text-primary" onClick={backQuickMenu}>
                      Back
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {currentQuickOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={sending || conversationEnded}
                      className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-sm text-foreground active:bg-secondary disabled:opacity-40"
                      onClick={() => handleQuickNode(opt)}
                    >
                      {opt.emoji && <span>{opt.emoji}</span>}
                      <span className="flex-1 leading-tight">{quickLabel(opt)}</span>
                      {opt.children?.length && <span className="text-muted-foreground">›</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
        <div className="flex gap-2 items-end">
          <button
            type="button"
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border disabled:opacity-40 ${menuOpen ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}
            disabled={sending || conversationEnded}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <LayoutGrid size={16} />
          </button>
          <textarea
            value={inputText}
            rows={1}
            placeholder={t('cs.inputPlaceholder')}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ maxHeight: '80px', overflowY: 'auto' }}
            disabled={sending || conversationEnded}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={onKeydown}
            onFocus={() => setMenuOpen(false)}
          />
          <button
            type="button"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
            disabled={!inputText.trim() || sending || conversationEnded}
            onClick={() => void send()}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
