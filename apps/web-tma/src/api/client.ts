import type { ApiResponse } from '@/types/api'

const BASE_URL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:3000/api/v1'

function authHeaders(): HeadersInit {
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
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers as Record<string, string>) },
  })
  const body = (await res.json()) as ApiResponse<T>
  if (!res.ok || body.code !== 0) {
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
