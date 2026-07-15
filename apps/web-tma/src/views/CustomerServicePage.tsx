import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Headphones, Loader2, LayoutGrid, CircleX } from 'lucide-react'
import { sendCsIntent, fetchCsHistory, fetchCsWelcome, fetchCsOrders, sendCsMessageStream, markCsLeft, endCsConversation } from '@/api/cs'
import type { CsMessage, CsOrder } from '@/api/cs'
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

const ORDER_STATE_CLASS: Record<string, string> = {
  success: 'bg-green-500/15 text-green-400',
  pending: 'bg-yellow-500/15 text-yellow-500',
  failed: 'bg-red-500/15 text-red-400',
}

export default function CustomerServicePage({ onClose }: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const [messages, setMessages] = useState<LocalMsg[]>([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [conversationStatus, setConversationStatus] = useState('active')
  const [welcome, setWelcome] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [quickPath, setQuickPath] = useState<QuickNode[]>([])
  const [streamingId, setStreamingId] = useState<number | null>(null)
  const msgRef = useRef<HTMLDivElement>(null)
  const leftSentRef = useRef(false)
  const endedRef = useRef(false)
  const conversationEnded = conversationStatus === 'closed' || conversationStatus === 'resolved'
  const currentQuickParent = quickPath[quickPath.length - 1]
  const currentQuickOptions = currentQuickParent?.children ?? QUICK_OPTIONS
  const quickTitle = currentQuickParent?.label ?? t('cs.quickMenuTitle')

  function scrollToBottom() {
    setTimeout(() => { if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight }, 0)
  }

  useEffect(() => {
    fetchCsWelcome().then((res) => setWelcome(res.welcome)).catch(() => {})
    if (!isLoggedIn) { setLoading(false); return }
    fetchCsHistory()
      .then((res) => { setMessages(res.messages); setConversationStatus(res.conversation.status) })
      .catch(() => {})
      .finally(() => { setLoading(false); scrollToBottom() })
  }, [isLoggedIn])

  useEffect(() => {
    endedRef.current = conversationEnded
  }, [conversationEnded])

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
      const res = await endCsConversation()
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
      await sendCsMessageStream(text, {
        onDelta: (d) => {
          if (assistantId === null) ensure(d)
          else {
            const id = assistantId
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + d } : m)))
          }
          scrollToBottom()
        },
        onDone: (r) => setConversationStatus(r.status),
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
    await dispatch(label, () => sendCsIntent(intent))
  }

  function handleQuickNode(node: QuickNode) {
    if (node.children?.length) {
      setQuickPath((prev) => [...prev, node])
      return
    }
    if (!node.intent) return
    setMenuOpen(false)
    void sendQuickOption(node.intent, node.label, node.orderKind)
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

  return (
    <div className="page-scroll hide-scrollbar flex flex-col" style={{ height: '100%' }}>
      <div className="app-safe-header flex items-center gap-3 border-b border-border bg-card px-4 pb-3 pt-3 flex-shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
          <Headphones size={18} className="text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground">{t('cs.title')}</p>
          <p className="text-xs text-muted-foreground">
            {conversationEnded ? t('cs.sessionEndedStatus') : conversationStatus === 'human_taken' ? t('cs.humanService') : conversationStatus === 'escalated' ? t('cs.escalatedService') : t('cs.aiService')}
          </p>
        </div>
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
                    <p className="text-xs text-muted-foreground mb-1">{t('cs.aiLabel')}</p>
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
                      <span className="flex-1 leading-tight">{opt.label}</span>
                      {opt.children?.length && <span className="text-muted-foreground">›</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`${msg.orders ? 'max-w-[92%]' : 'max-w-[85%]'} rounded-2xl px-3.5 py-2.5 ${msg.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-secondary text-foreground'}`}>
                  {msg.role !== 'user' && <p className="text-xs text-muted-foreground mb-1">{msg.role === 'assistant' ? t('cs.aiLabel') : t('cs.agentLabel')}</p>}
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
                  <p className="text-xs text-muted-foreground mb-1">{t('cs.aiLabel')}</p>
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
                      <span className="flex-1 leading-tight">{opt.label}</span>
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
