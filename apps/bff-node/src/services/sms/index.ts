import type { Redis } from 'ioredis'
import type { Env } from '../../config/env.js'
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
}

export async function getSmsProvider(env: Env, redis: Redis): Promise<SmsProvider> {
  if (await getSmsTestMode(redis, env)) return new MockSmsProvider()
  return new TeleSmsProvider(env)
}

export async function isSmsTestModeEnabled(redis: Redis, env: Env): Promise<boolean> {
  return getSmsTestMode(redis, env)
}
