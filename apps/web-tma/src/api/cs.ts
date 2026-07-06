import { apiRequest } from '@/api/client'

export interface CsMessage {
  id: number
  conversationId: number
  role: 'user' | 'assistant' | 'admin'
  content: string
  createdAt: string
}

export interface CsConversation {
  id: number
  userId: number
  status: string
  updatedAt: string
}

export async function sendCsMessage(text: string): Promise<{ reply: string; conversationId: number; status: string }> {
  return apiRequest('/cs/message', { method: 'POST', body: JSON.stringify({ message: text }) })
}

export async function sendCsIntent(intent: string): Promise<{ reply: string; conversationId: number; status: string }> {
  return apiRequest('/cs/message', { method: 'POST', body: JSON.stringify({ intent }) })
}

export async function fetchCsWelcome(): Promise<{ welcome: string }> {
  return apiRequest('/cs/welcome')
}

export async function fetchCsHistory(): Promise<{ conversation: CsConversation; messages: CsMessage[] }> {
  return apiRequest('/cs/history')
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
