import { env } from '../config/env.js'

type Win568Error = { id: number; msg: string }

export interface Win568Response {
  serverId?: string
  companyKey?: string
  apiType?: string
  scope?: string
  expirationDate?: string
  url?: string
  result?: unknown
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

  getCurrentCompanyKeyInfo() {
    return post('/web-root/restricted/system/get-current-key-info', {
      companyKey: env.WIN568_COMPANY_KEY,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  resendOrder(payload: { txnId: string; portfolio: string }) {
    return post('/web-root/restricted/seamless-wallet/resend-order', {
      ...payload,
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

  getBetListByModifyDate(payload: {
    portfolio: string
    startDate: string
    endDate: string
    language?: string
    isGetDownline?: boolean
  }) {
    return post('/web-root/restricted/report/v2/get-bet-list-by-modify-date.aspx', {
      ...payload,
      companyKey: env.WIN568_COMPANY_KEY,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  getBetListByRefNos(payload: { portfolio: string; refNos: string; language?: string }) {
    return post('/web-root/restricted/report/get-bet-list-by-refnos.aspx', {
      ...payload,
      companyKey: env.WIN568_COMPANY_KEY,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  getBetPayload(payload: { Portfolio: string; Refno: string; Language?: string }) {
    return post('/web-root/restricted/report/get-bet-payload.aspx', withAuth(payload))
  }
}
