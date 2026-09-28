import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { Env } from '../../config/env.js'
import type { SiteMarket } from '../site-domain.service.js'
import { getSmsTestMode } from '../admin-store.js'

export interface SmsSendResult {
  ok: boolean
  providerMsgId?: string
  errCode?: string
  errMessage?: string
}

export interface SmsProvider {
  sendSms(phoneE164: string, text: string): Promise<SmsSendResult>
  getBalance(): Promise<number | null>
  getDeliveryStatus(providerMsgId: string): Promise<'delivered' | 'sending' | 'failed' | null>
}

/** E.164 (+639xxxxxxxxx) → TeleSMS MSISDN (639xxxxxxxxx，去掉 + 与前导 0) */
function toMsisdn(phoneE164: string): string {
  return phoneE164.replace(/^\+/, '').replace(/\D/g, '')
}

/** 解析 TeleSMS 的 key=value&key=value 响应 */
function parseKv(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of body.trim().split('&')) {
    const idx = pair.indexOf('=')
    if (idx > 0) out[pair.slice(0, idx)] = pair.slice(idx + 1)
  }
  return out
}

class MockSmsProvider implements SmsProvider {
  async sendSms(): Promise<SmsSendResult> {
    return { ok: true, providerMsgId: 'mock' }
  }

  async getBalance(): Promise<number | null> {
    return null
  }

  async getDeliveryStatus(): Promise<null> {
    return null
  }
}

class TeleSmsProvider implements SmsProvider {
  constructor(private readonly env: Env) {}

  async sendSms(phoneE164: string, text: string): Promise<SmsSendResult> {
    const { TELESMS_BASE_URL, TELESMS_CPID, TELESMS_CPPWD, TELESMS_SENDER } = this.env
    if (!TELESMS_CPID || !TELESMS_CPPWD) {
      return { ok: false, errMessage: 'TeleSMS not configured' }
    }
    const params = new URLSearchParams({
      command: 'MT_REQUEST',
      cpid: TELESMS_CPID,
      cppwd: TELESMS_CPPWD,
      da: toMsisdn(phoneE164),
      sm: text,
    })
    if (TELESMS_SENDER) params.set('sa', TELESMS_SENDER)

    try {
      const res = await fetch(`${TELESMS_BASE_URL}/submit?${params.toString()}`, {
        signal: AbortSignal.timeout(15000),
      })
      const kv = parseKv(await res.text())
      if (kv.mterrcode === '000' && kv.mtstat === 'ACCEPTD') {
        return { ok: true, providerMsgId: kv.mtmsgid }
      }
      return { ok: false, errCode: kv.mterrcode, errMessage: `TeleSMS rejected: ${kv.mterrcode ?? 'unknown'}` }
    } catch (e) {
      return { ok: false, errMessage: e instanceof Error ? e.message : 'TeleSMS request failed' }
    }
  }

  async getBalance(): Promise<number | null> {
    const { TELESMS_BASE_URL, TELESMS_CPID, TELESMS_CPPWD } = this.env
    if (!TELESMS_CPID || !TELESMS_CPPWD) return null
    try {
      const res = await fetch(
        `${TELESMS_BASE_URL}/get-balance?cpid=${TELESMS_CPID}&cppwd=${TELESMS_CPPWD}`,
        { signal: AbortSignal.timeout(15000) },
      )
      const json = (await res.json()) as { errcode?: string; balance?: number }
      return json.errcode === '000' ? Number(json.balance ?? 0) : null
    } catch {
      return null
    }
  }

  async getDeliveryStatus(): Promise<null> {
    return null
  }
}

interface LaafficResponse {
  status?: string
  reason?: string
}

export class LaafficSmsProvider implements SmsProvider {
  constructor(private readonly env: Env) {}

  private headers(): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const sign = createHash('md5')
      .update(`${this.env.LAAFFIC_API_KEY}${this.env.LAAFFIC_API_SECRET}${timestamp}`)
      .digest('hex')
    return {
      'Content-Type': 'application/json;charset=UTF-8',
      'Api-Key': this.env.LAAFFIC_API_KEY,
      Timestamp: timestamp,
      Sign: sign,
    }
  }

  private configured(): boolean {
    return Boolean(this.env.LAAFFIC_API_KEY && this.env.LAAFFIC_API_SECRET && this.env.LAAFFIC_APP_ID)
  }

  async sendSms(phoneE164: string, text: string): Promise<SmsSendResult> {
    if (!this.configured()) return { ok: false, errMessage: 'Laaffic not configured' }
    const body: Record<string, string | number> = {
      appId: this.env.LAAFFIC_APP_ID,
      numbers: toMsisdn(phoneE164),
      content: text,
      trackClicks: 0,
    }
    if (this.env.LAAFFIC_SENDER_ID) body.senderId = this.env.LAAFFIC_SENDER_ID

    try {
      const res = await fetch(`${this.env.LAAFFIC_BASE_URL}/sendSms`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      })
      const json = (await res.json()) as LaafficResponse & {
        success?: string
        array?: Array<{ msgId?: string }>
      }
      if (res.ok && json.status === '0' && Number(json.success ?? 0) > 0) {
        return { ok: true, providerMsgId: json.array?.[0]?.msgId }
      }
      return {
        ok: false,
        errCode: json.status,
        errMessage: json.reason || `Laaffic rejected: HTTP ${res.status}`,
      }
    } catch (e) {
      return { ok: false, errMessage: e instanceof Error ? e.message : 'Laaffic request failed' }
    }
  }

  async getBalance(): Promise<number | null> {
    if (!this.configured()) return null
    try {
      const res = await fetch(`${this.env.LAAFFIC_BASE_URL}/getBalance`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15000),
      })
      const json = (await res.json()) as LaafficResponse & {
        balance?: string
        gift?: string
        credit?: string
      }
      if (!res.ok || json.status !== '0') return null
      return Number(json.balance ?? 0) + Number(json.gift ?? 0) + Number(json.credit ?? 0)
    } catch {
      return null
    }
  }

  async getDeliveryStatus(providerMsgId: string): Promise<'delivered' | 'sending' | 'failed' | null> {
    if (!this.configured()) return null
    try {
      const params = new URLSearchParams({ appId: this.env.LAAFFIC_APP_ID, msgIds: providerMsgId })
      const res = await fetch(`${this.env.LAAFFIC_BASE_URL}/getReport?${params.toString()}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15000),
      })
      const json = (await res.json()) as LaafficResponse & { array?: Array<{ status?: string | number }> }
      if (!res.ok || json.status !== '0') return null
      const status = String(json.array?.[0]?.status ?? '')
      return status === '0' ? 'delivered' : status === '-1' ? 'sending' : status === '1' ? 'failed' : null
    } catch {
      return null
    }
  }
}

export async function getSmsProvider(env: Env, redis: Redis, market: SiteMarket = 'PH'): Promise<SmsProvider> {
  if (await getSmsTestMode(redis, env)) return new MockSmsProvider()
  if (market === 'IN') return new LaafficSmsProvider(env)
  return new TeleSmsProvider(env)
}

export async function isSmsTestModeEnabled(redis: Redis, env: Env): Promise<boolean> {
  return getSmsTestMode(redis, env)
}
