import { OAuth2Client } from 'google-auth-library'
import type { Env } from '../config/env.js'

export interface GoogleProfile {
  sub: string
  email?: string
  name: string
  picture?: string
}

export async function exchangeGoogleCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<GoogleProfile> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth is not configured on the server')
  }

  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri)
  const { tokens } = await client.getToken(code)
  if (!tokens.id_token) {
    throw new Error('Google did not return an ID token')
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  if (!payload?.sub) {
    throw new Error('Invalid Google ID token')
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email ?? 'Google User',
    picture: payload.picture,
  }
}
