import { apiRequest, BASE_URL, authHeaders } from '@/api/client'

export interface CsMessage {
  id: number
  conversationId: number
  role: 'user' | 'assistant' | 'admin'
  content: string
  createdAt: string
}

export interface CsConversation {
  id: number
  userId: string
  status: string
  agentName: string
  escalateReason?: string | null
  updatedAt: string
  resolvedAt?: string | null
}

export interface CsReply {
  reply: string
  conversationId: number
  status: string
  agentName: string
}

export async function sendCsMessage(text: string, locale?: string): Promise<CsReply> {
  return apiRequest('/cs/message', { method: 'POST', body: JSON.stringify({ message: text, locale }) })
}

export async function sendCsIntent(intent: string, locale?: string): Promise<CsReply> {
  return apiRequest('/cs/message', { method: 'POST', body: JSON.stringify({ intent, locale }) })
}

export async function fetchCsWelcome(): Promise<{ welcome: string; agentName: string }> {
  return apiRequest('/cs/welcome')
}

export async function fetchCsHistory(): Promise<{ conversation: CsConversation; messages: CsMessage[] }> {
  return apiRequest('/cs/history')
}

export interface CsTicketItem {
  id: number
  status: string
  agentName: string
  escalateReason: string | null
  lastMessage: string
  lastMessageRole: CsMessage['role'] | null
  unreadAdminMessages: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export async function fetchCsTickets(): Promise<{ items: CsTicketItem[]; unreadCount: number }> {
  return apiRequest('/cs/tickets')
}

export async function fetchCsTicket(id: number): Promise<{ conversation: CsConversation; messages: CsMessage[] }> {
  return apiRequest(`/cs/tickets/${id}`)
}

export async function markCsTicketRead(id: number): Promise<{ success: boolean }> {
  return apiRequest(`/cs/tickets/${id}/read`, { method: 'POST', body: JSON.stringify({}) })
}

export async function markCsLeft(): Promise<{ success: boolean }> {
  return apiRequest('/cs/leave', { method: 'POST', body: JSON.stringify({}) })
}

export async function endCsConversation(locale?: string): Promise<{ success: boolean; conversation: CsConversation | null; message: string }> {
  return apiRequest('/cs/end', { method: 'POST', body: JSON.stringify({ locale }) })
}

export type CsOrderState = 'success' | 'pending' | 'failed'

export interface CsOrder {
  orderId: string
  amount: string
  currency: string
  channel: string
  status: string
  state: CsOrderState
  createdAt: string
  settledAt: string | null
  rejectReason: string | null
}

export async function fetchCsOrders(type: 'deposit' | 'withdraw'): Promise<{ type: string; orders: CsOrder[] }> {
  return apiRequest('/cs/orders', { method: 'POST', body: JSON.stringify({ type }) })
}

interface CsStreamHandlers {
  onDelta: (text: string) => void
  onDone: (result: { conversationId: number; status: string; agentName: string }) => void
  onError: (message: string) => void
}

// 自由文本消息走 SSE 流式,逐字回调 onDelta
export async function sendCsMessageStream(text: string, locale: string | undefined, handlers: CsStreamHandlers): Promise<void> {
  const res = await fetch(`${BASE_URL}/cs/message/stream`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message: text, locale }),
  })
  if (!res.ok || !res.body) {
    let msg = 'cs.sendFailed'
    try {
      const j = await res.json()
      msg = j.message || msg
    } catch {
      /* 非 JSON 错误体 */
    }
    handlers.onError(msg)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const ev of events) {
      let event = 'message'
      let data = ''
      for (const line of ev.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      let parsed: { delta?: string; message?: string; conversationId?: number; status?: string; agentName?: string }
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      if (event === 'delta') handlers.onDelta(parsed.delta ?? '')
      else if (event === 'done') handlers.onDone({ conversationId: parsed.conversationId ?? 0, status: parsed.status ?? 'active', agentName: parsed.agentName ?? '' })
      else if (event === 'error') handlers.onError(parsed.message ?? 'cs.sendFailed')
    }
  }
}
