import type { ApiResponse } from '@/types/api'
import { attributionHeaders } from '@/utils/attribution'
import { fingerprintHeaders } from '@/utils/fingerprint'
import { getToken } from '@/utils/tokenStore'
import { getSiteMarket } from '@/config/market'

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
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Site-Market': getSiteMarket(),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: number,
    public traceId?: string,
    /** 网络层错误：请求没到达业务后端或响应不可解析（超时/断网/CDN/WAF 拦截页），message 不代表业务语义 */
    public network = false,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 请求超时：弱网/服务重启瞬间 fetch 可能永久挂起，悬死的 promise 会让调用方 loading 态卡死（按钮永久置灰） */
const REQUEST_TIMEOUT_MS = 20000

type ApiRequestInit = RequestInit & { timeoutMs?: number }

export async function apiRequest<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const { timeoutMs, ...fetchInit } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? REQUEST_TIMEOUT_MS)
  const outerSignal = init.signal
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort()
    else outerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let res: Response
  let body: ApiResponse<T>
  try {
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        ...fetchInit,
        signal: controller.signal,
        headers: { ...authHeaders(), ...fingerprintHeaders(), ...attributionHeaders(), ...(init.headers as Record<string, string>) },
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError' && !outerSignal?.aborted) {
        throw new ApiError('errors.requestTimeout', 0, undefined, true)
      }
      const hint =
        BASE_URL.includes('localhost') && typeof window !== 'undefined'
          ? 'Cannot reach API (localhost is invalid on mobile). Use the production site URL.'
          : 'Network request failed. Check connection and try again.'
      throw new ApiError(e instanceof Error ? `${hint} (${e.message})` : hint, 0, undefined, true)
    }
    try {
      body = (await res.json()) as ApiResponse<T>
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError' && !outerSignal?.aborted) {
        throw new ApiError('errors.requestTimeout', 0, undefined, true)
      }
      throw new ApiError(res.ok ? 'Invalid API response' : res.statusText || 'Request failed', res.status, undefined, true)
    }
  } finally {
    clearTimeout(timer)
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
