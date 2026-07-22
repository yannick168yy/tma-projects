import type { ApiResponse } from '@/types/api'
import { fingerprintHeaders } from '@/utils/fingerprint'

/** 生产域名走同源 /api/v1（Nginx → BFF）；避免 www/裸域跨域与 .env 写死 www 导致异常 */
function resolveBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${origin}/api/v1`
    }
  }
  const fromEnv = import.meta.env.VITE_BFF_BASE_URL?.trim()
  return (fromEnv || 'http://localhost:3000/api/v1').replace(/\/$/, '')
}

export const BASE_URL = resolveBaseUrl()

export function authHeaders(): HeadersInit {
  const token = localStorage.getItem('betogo_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: number,
    public traceId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...fingerprintHeaders(), ...(init.headers as Record<string, string>) },
    })
  } catch (e) {
    const hint =
      BASE_URL.includes('localhost') && typeof window !== 'undefined'
        ? 'Cannot reach API (localhost is invalid on mobile). Use the production site URL.'
        : 'Network request failed. Check connection and try again.'
    throw new ApiError(e instanceof Error ? `${hint} (${e.message})` : hint, 0)
  }
  let body: ApiResponse<T>
  try {
    body = (await res.json()) as ApiResponse<T>
  } catch {
    throw new ApiError(res.ok ? 'Invalid API response' : res.statusText || 'Request failed', res.status)
  }
  if (!res.ok || body.code !== 0) {
    if (res.status === 503 && body.message === 'maintenance') {
      window.dispatchEvent(new CustomEvent('betogo:maintenance'))
    }
    throw new ApiError(body.message || res.statusText, body.code ?? res.status, body.traceId)
  }
  return body.data
}

export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? ''
}

export function isTelegramWebApp(): boolean {
  return Boolean(window.Telegram?.WebApp?.initData)
}
