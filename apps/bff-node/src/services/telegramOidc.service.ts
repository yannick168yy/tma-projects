import type { Env } from '../config/env.js'

const TOKEN_ENDPOINT = 'https://oauth.telegram.org/token'
const ISSUER = 'https://oauth.telegram.org'

export interface TelegramOidcProfile {
  sub: string
  username?: string
  displayName: string
  avatarUrl?: string
  phoneNumber?: string
}

function botClientId(token: string): string {
  return token.split(':')[0]
}

function domainFromRedirectUri(redirectUri: string): string {
  return new URL(redirectUri).hostname.toLowerCase()
}

function clientByRedirectDomain(env: Env, redirectUri: string): { clientId: string; clientSecret: string } | undefined {
  const domain = domainFromRedirectUri(redirectUri)
  for (const item of env.TELEGRAM_OIDC_CLIENTS.split(',')) {
    const [rawDomain, ...credentialParts] = item.split('=')
    const credential = credentialParts.join('=').trim()
    const colon = credential.indexOf(':')
    if (rawDomain.trim().toLowerCase() === domain && colon > 0) {
      return {
        clientId: credential.slice(0, colon),
        clientSecret: credential.slice(colon + 1),
      }
    }
  }
  for (const item of env.TELEGRAM_OIDC_BOT_TOKENS.split(',')) {
    const [rawDomain, ...tokenParts] = item.split('=')
    const token = tokenParts.join('=').trim()
    if (rawDomain.trim().toLowerCase() === domain && token) {
      return { clientId: botClientId(token), clientSecret: token }
    }
  }
  return undefined
}

function oidcCredentials(env: Env, redirectUri: string): { clientId: string; clientSecret: string } {
  const client = clientByRedirectDomain(env, redirectUri)
  if (client) return client
  if (!env.TELEGRAM_OIDC_CLIENT_SECRET) {
    throw new Error('Telegram web login is not configured on the server')
  }
  return { clientId: botClientId(env.TELEGRAM_BOT_TOKEN), clientSecret: env.TELEGRAM_OIDC_CLIENT_SECRET }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1]
  if (!part) throw new Error('Malformed id_token')
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return JSON.parse(json) as Record<string, unknown>
}

/**
 * 用授权码向 Telegram token 端点换取 id_token 并解出用户信息。
 * id_token 经服务端到 token 端点的 TLS 直连获取，按 OIDC 规范可用 TLS 信任替代签名校验，
 * 这里只校验 iss/aud/exp。
 */
export async function exchangeTelegramOidcCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<TelegramOidcProfile> {
  const { clientId, clientSecret } = oidcCredentials(env, redirectUri)

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
    }).toString(),
  })
  if (!res.ok) {
    throw new Error(`Telegram token exchange failed (${res.status})`)
  }
  const tokens = (await res.json()) as { id_token?: string }
  if (!tokens.id_token) throw new Error('Telegram did not return an id_token')

  const claims = decodeJwtPayload(tokens.id_token)
  if (claims.iss !== ISSUER) throw new Error('Invalid id_token issuer')
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.map(String).includes(clientId)) throw new Error('Invalid id_token audience')
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw new Error('id_token expired')
  }

  const sub = typeof claims.sub === 'string' ? claims.sub : String(claims.sub ?? '')
  if (!sub) throw new Error('Invalid sub in id_token')

  const username = typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name : undefined
  return {
    sub,
    username,
    displayName: name ?? username ?? 'Telegram User',
    avatarUrl: typeof claims.picture === 'string' ? claims.picture : undefined,
    phoneNumber: typeof claims.phone_number === 'string' ? claims.phone_number : undefined,
  }
}
