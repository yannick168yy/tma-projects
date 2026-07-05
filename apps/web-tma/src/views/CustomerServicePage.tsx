import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Headphones, Loader2 } from 'lucide-react'
import { sendCsMessage, sendCsIntent, fetchCsHistory, fetchCsWelcome } from '@/api/cs'
import type { CsMessage } from '@/api/cs'
import { ApiError } from '@/api/client'
import { translateApiError } from '@/utils/translateApiError'
import { useAuthStore } from '@/stores/auth'

interface Props { onClose: () => void }

const QUICK_OPTIONS: { intent: string; emoji: string; labelKey: string }[] = [
  { intent: 'deposit_not_credited', emoji: '💰', labelKey: 'cs.quick.deposit' },
  { intent: 'withdrawal_status', emoji: '💸', labelKey: 'cs.quick.withdrawal' },
  { intent: 'cannot_withdraw', emoji: '🔒', labelKey: 'cs.quick.cannotWithdraw' },
  { intent: 'kyc_help', emoji: '🪪', labelKey: 'cs.quick.kyc' },
  { intent: 'promotions', emoji: '🎁', labelKey: 'cs.quick.promotions' },
  { intent: 'game_issue', emoji: '🎮', labelKey: 'cs.quick.games' },
  { intent: 'account_issue', emoji: '👤', labelKey: 'cs.quick.account' },
  { intent: 'human_agent', emoji: '🧑‍💻', labelKey: 'cs.quick.human' },
]

export default function CustomerServicePage({ onClose }: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const [messages, setMessages] = useState<CsMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [conversationStatus, setConversationStatus] = useState('active')
  const [welcome, setWelcome] = useState('')
  const msgRef = useRef<HTMLDivElement>(null)

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

  async function dispatch(displayText: string, request: () => Promise<{ reply: string; conversationId: number; status: string }>) {
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
    if (!text || sending) return
    setInputText('')
    await dispatch(text, () => sendCsMessage(text))
  }

  async function sendQuickOption(intent: string, label: string) {
    if (sending) return
    await dispatch(label, () => sendCsIntent(intent))
  }

  function onKeydown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="page-scroll hide-scrollbar flex flex-col" style={{ height: '100%' }}>
      <div className="app-safe-header flex items-center gap-3 border-b border-border bg-card px-4 pb-3 pt-3 flex-shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
          <Headphones size={18} className="text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground">{t('cs.title')}</p>
          <p className="text-xs text-muted-foreground">{conversationStatus === 'human_taken' ? t('cs.humanService') : t('cs.aiService')}</p>
        </div>
        <button type="button" className="text-muted-foreground hover:text-foreground p-1" onClick={onClose}>
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
                      disabled={sending}
                      className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-foreground active:bg-secondary disabled:opacity-40"
                      onClick={() => void sendQuickOption(opt.intent, t(opt.labelKey))}
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
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${msg.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-secondary text-foreground'}`}>
                  {msg.role !== 'user' && <p className="text-xs text-muted-foreground mb-1">{msg.role === 'assistant' ? t('cs.aiLabel') : t('cs.agentLabel')}</p>}
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-[10px] mt-1 opacity-60 text-right">{formatTime(msg.createdAt)}</p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-sm bg-secondary px-3.5 py-2.5">
                  <p className="text-xs text-muted-foreground mb-1">{t('cs.aiLabel')}</p>
                  <div className="flex gap-1 items-center h-5">
                    {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-border bg-card px-3 py-2.5 flex gap-2 items-end">
        <textarea
          value={inputText}
          rows={1}
          placeholder={t('cs.inputPlaceholder')}
          className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          style={{ maxHeight: '80px', overflowY: 'auto' }}
          disabled={sending}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={onKeydown}
        />
        <button
          type="button"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
          disabled={!inputText.trim() || sending}
          onClick={() => void send()}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
