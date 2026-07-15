import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Headphones, Loader2, LayoutGrid, CircleX } from 'lucide-react'
import { sendCsIntent, fetchCsHistory, fetchCsWelcome, fetchCsOrders, sendCsMessageStream, markCsLeft, endCsConversation } from '@/api/cs'
import type { CsMessage, CsOrder } from '@/api/cs'
import { ApiError } from '@/api/client'
import { translateApiError } from '@/utils/translateApiError'
import { useAuthStore } from '@/stores/auth'

interface Props { onClose: () => void }

const QUICK_OPTIONS: { intent: string; emoji: string; labelKey: string; orderKind?: 'deposit' | 'withdraw' }[] = [
  { intent: 'deposit_not_credited', emoji: '💰', labelKey: 'cs.quick.deposit', orderKind: 'deposit' },
  { intent: 'withdrawal_status', emoji: '💸', labelKey: 'cs.quick.withdrawal', orderKind: 'withdraw' },
  { intent: 'cannot_withdraw', emoji: '🔒', labelKey: 'cs.quick.cannotWithdraw' },
  { intent: 'kyc_help', emoji: '🪪', labelKey: 'cs.quick.kyc' },
  { intent: 'promotions', emoji: '🎁', labelKey: 'cs.quick.promotions' },
  { intent: 'game_issue', emoji: '🎮', labelKey: 'cs.quick.games' },
  { intent: 'account_issue', emoji: '👤', labelKey: 'cs.quick.account' },
  { intent: 'human_agent', emoji: '🧑‍💻', labelKey: 'cs.quick.human' },
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
  const [streamingId, setStreamingId] = useState<number | null>(null)
  const msgRef = useRef<HTMLDivElement>(null)
  const leftSentRef = useRef(false)
  const endedRef = useRef(false)
  const conversationEnded = conversationStatus === 'closed' || conversationStatus === 'resolved'

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
      const notice: LocalMsg = { id: Date.now(), conversationId: res.conversation?.id ?? 0, role: 'assistant', content: t('cs.sessionEndedNotice'), createdAt: new Date().toISOString() }
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
    // 存款/提现是确定性查询:登录用户直接查库秒回,不经 AI
    if (orderKind && isLoggedIn) { await queryOrders(orderKind, label); return }
    await dispatch(label, () => sendCsIntent(intent))
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
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_OPTIONS.map((opt) => (
                    <button
                      key={opt.intent}
                      type="button"
                      disabled={sending || conversationEnded}
                      className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-foreground active:bg-secondary disabled:opacity-40"
                      onClick={() => void sendQuickOption(opt.intent, t(opt.labelKey), opt.orderKind)}
                    >
                      <span>{opt.emoji}</span>
                      <span className="flex-1 leading-tight">{t(opt.labelKey)}</span>
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
                <p className="mb-2 text-xs text-muted-foreground">{t('cs.quickMenuTitle')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_OPTIONS.map((opt) => (
                    <button
                      key={opt.intent}
                      type="button"
                      disabled={sending || conversationEnded}
                      className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-sm text-foreground active:bg-secondary disabled:opacity-40"
                      onClick={() => { setMenuOpen(false); void sendQuickOption(opt.intent, t(opt.labelKey), opt.orderKind) }}
                    >
                      <span>{opt.emoji}</span>
                      <span className="flex-1 leading-tight">{t(opt.labelKey)}</span>
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
