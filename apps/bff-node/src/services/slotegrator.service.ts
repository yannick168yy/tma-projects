import { createHmac } from 'node:crypto'
import type { Env } from '../config/env.js'

// ── Signing ──────────────────────────────────────────────────────────────────

function buildSignPayload(params: Record<string, string | number>): string {
  const sorted = Object.keys(params).sort()
  const usp = new URLSearchParams()
  for (const k of sorted) usp.append(k, String(params[k]))
  return usp.toString()
}

export function sgSign(params: Record<string, string | number>, merchantKey: string): string {
  return createHmac('sha1', merchantKey).update(buildSignPayload(params)).digest('hex')
}

export function sgAuthHeaders(
  bodyParams: Record<string, string | number>,
  env: Env,
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000)
  const nonce = Math.random().toString(36).slice(2, 12)
  const merged: Record<string, string | number> = {
    ...bodyParams,
    'X-Merchant-Id': env.SG_MERCHANT_ID,
    'X-Timestamp': ts,
    'X-Nonce': nonce,
  }
  return {
    'X-Merchant-Id': env.SG_MERCHANT_ID,
    'X-Timestamp': String(ts),
    'X-Nonce': nonce,
    'X-Sign': sgSign(merged, env.SG_MERCHANT_KEY),
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

// SG 回调验签与处理在 core-node（providers/verifiers.ts + sg-callback.routes.ts）

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function sgPost<T>(path: string, params: Record<string, string | number>, env: Env): Promise<T> {
  if (!env.SG_BASE_URL || !env.SG_MERCHANT_ID) {
    throw new Error('Slotegrator not configured (SG_BASE_URL / SG_MERCHANT_ID missing)')
  }
  const headers = sgAuthHeaders(params, env)
  const body = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  )
  const res = await fetch(`${env.SG_BASE_URL}${path}`, { method: 'POST', headers, body })
  if (!res.ok) throw new Error(`SG ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function sgGet<T>(path: string, params: Record<string, string | number>, env: Env): Promise<T> {
  if (!env.SG_BASE_URL || !env.SG_MERCHANT_ID) {
    throw new Error('Slotegrator not configured')
  }
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  )
  const headers = sgAuthHeaders(params, env)
  delete (headers as Record<string, string>)['Content-Type']
  const res = await fetch(`${env.SG_BASE_URL}${path}?${qs}`, { method: 'GET', headers })
  if (!res.ok) throw new Error(`SG GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

// ── Game list ─────────────────────────────────────────────────────────────────

export interface SgGame {
  uuid: string
  name: string
  type?: string
  image: string
  provider: string
  provider_id?: number | string
  technology?: string
  category?: string
  sub_category?: string
  has_demo?: 0 | 1
  has_lobby: 0 | 1
  is_mobile: 0 | 1
  mobile?: 0 | 1
  has_freespins?: 0 | 1
  has_tables?: 0 | 1
  label?: string
  tags?: Array<{ code: string; label: string } | string>
  parameters?: {
    rtp?: number | string | null
    volatility?: string | null
    reels_count?: string | null
    lines_count?: number | string | null
  }
  images?: Array<{ name: string; file: string; url: string; type: string }>
}

export interface SgGamesPage {
  items: SgGame[]
  _meta: {
    totalCount: number
    pageCount: number
    currentPage: number
    perPage: number
  }
}

export function fetchSgGames(env: Env, page = 1): Promise<SgGamesPage> {
  return sgGet<SgGamesPage>('/games', { page, 'per-page': 50, expand: 'tags,parameters,images' }, env)
}

// ── Game init ─────────────────────────────────────────────────────────────────

export interface SgInitParams {
  game_uuid: string
  player_id: string
  player_name: string
  currency: string
  session_id: string
  return_url: string
  language: string
  device: 'mobile' | 'desktop'
}

export interface SgGameUrl {
  url: string
}

export function sgInitGame(params: SgInitParams, env: Env): Promise<SgGameUrl> {
  return sgPost<SgGameUrl>('/games/init', params as unknown as Record<string, string | number>, env)
}

export function sgInitDemo(
  params: {
    game_uuid: string
    currency: string
    language: string
    device: 'mobile' | 'desktop'
    return_url: string
  },
  env: Env,
): Promise<SgGameUrl> {
  return sgPost<SgGameUrl>('/games/init-demo', params as unknown as Record<string, string | number>, env)
}
