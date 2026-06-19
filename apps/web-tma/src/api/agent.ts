import { apiRequest } from './client'

export interface AgentCenterChannel {
  channel_type: 'domain' | 'bot'
  channel_value: string
  enabled: number
}

export interface AgentCenterCommission {
  period: string
  ggr_cents: number
  commission_cents: number
  status: 'pending' | 'paid' | 'voided'
  paid_at: string | null
}

export interface AgentCenter {
  agent: { name: string; ggrRatePct: number }
  userCount: number
  channels: AgentCenterChannel[]
  commissions: AgentCenterCommission[]
  summary: { lifetime_commission_cents: number; pending_cents: number }
}

export function getAgentCenter(): Promise<AgentCenter> {
  return apiRequest<AgentCenter>('/agent/center')
}
