import { env } from '../config/env.js'

type Win568Error = { id: number; msg: string }

export interface Win568Response {
  serverId?: string
  companyKey?: string
  apiType?: string
  scope?: string
  expirationDate?: string
  url?: string
  error: Win568Error
}

async function post(path: string, payload: Record<string, unknown>): Promise<Win568Response> {
  const res = await fetch(`${env.WIN568_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return await res.json() as Win568Response
}

function withAuth(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    CompanyKey: env.WIN568_COMPANY_KEY,
    ServerId: env.WIN568_SERVER_ID,
  }
}

export class Win568Client {
  regenerateCompanyKey(apiType: 'Operation' | 'SeamlessWallet') {
    return post('/web-root/restricted/system/regenerate-key', {
      apiType,
      scope: 'All',
      companyKey: env.WIN568_COMPANY_KEY,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  registerAgent(payload: {
    Username: string
    Password: string
    Currency: string
    Min: number
    Max: number
    MaxPerMatch: number
    CasinoTableLimit: number
    IsTwoFAEnabled?: boolean
  }) {
    return post('/web-root/restricted/agent/register-agent.aspx', withAuth(payload))
  }

  registerPlayer(payload: { Username: string; Agent: string; UserGroup?: string }) {
    return post('/web-root/restricted/player/register-player.aspx', withAuth(payload))
  }

  async login(payload: Record<string, unknown>) {
    const result = await post('/web-root/restricted/player/v2/login.aspx', withAuth(payload))
    if (result.error.id === 0 && result.url?.startsWith('//')) {
      result.url = `https:${result.url}`
    }
    return result
  }
}
