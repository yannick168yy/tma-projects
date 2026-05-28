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

export async function fetchCsHistory(): Promise<{ conversation: CsConversation; messages: CsMessage[] }> {
  return apiRequest('/cs/history')
}
