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
  seamlessGameProviderGames?: unknown
  error: Win568Error
}

async function post(path: string, payload: Record<string, unknown>): Promise<Win568Response> {
  const res = await fetch(`${env.WIN568_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
  return await res.json() as Win568Response
}

function withAuth(payload: Record<string, unknown>, companyKey = env.WIN568_COMPANY_KEY): Record<string, unknown> {
  return {
    ...payload,
    CompanyKey: companyKey,
    ServerId: env.WIN568_SERVER_ID,
  }
}

export class Win568Client {
  constructor(private operationCompanyKey = env.WIN568_COMPANY_KEY) {}

  regenerateCompanyKey(apiType: 'Operation' | 'SeamlessWallet') {
    return post('/web-root/restricted/system/regenerate-key', {
      apiType,
      scope: 'All',
      companyKey: this.operationCompanyKey,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  getCurrentCompanyKeyInfo() {
    return post('/web-root/restricted/system/get-current-key-info', {
      companyKey: this.operationCompanyKey,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  resendOrder(payload: { txnId: string; portfolio: string }) {
    return post('/web-root/restricted/seamless-wallet/resend-order', {
      ...payload,
      companyKey: this.operationCompanyKey,
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
    return post('/web-root/restricted/agent/register-agent.aspx', withAuth(payload, this.operationCompanyKey))
  }

  registerPlayer(payload: { Username: string; Agent: string; UserGroup?: string }) {
    return post('/web-root/restricted/player/register-player.aspx', withAuth(payload, this.operationCompanyKey))
  }

  async login(payload: Record<string, unknown>) {
    const result = await post('/web-root/restricted/player/v2/login.aspx', withAuth(payload, this.operationCompanyKey))
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
      companyKey: this.operationCompanyKey,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  getBetListByRefNos(payload: { portfolio: string; refNos: string; language?: string }) {
    return post('/web-root/restricted/report/get-bet-list-by-refnos.aspx', {
      ...payload,
      companyKey: this.operationCompanyKey,
      serverId: env.WIN568_SERVER_ID,
    })
  }

  getBetPayload(payload: { Portfolio: string; Refno: string; Language?: string }) {
    return post('/web-root/restricted/report/get-bet-payload.aspx', withAuth(payload, this.operationCompanyKey))
  }

  getGameList(payload: { GpId: number; IsGetAll: boolean }) {
    return post('/web-root/restricted/information/get-game-list.aspx', withAuth(payload, this.operationCompanyKey))
  }
}
