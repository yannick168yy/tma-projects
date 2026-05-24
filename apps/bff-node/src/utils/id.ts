import { randomBytes } from 'node:crypto'

export function randomToken(): string {
  return randomBytes(32).toString('hex')
}

export function randomOrderId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString('hex')}`
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'BG'
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}
