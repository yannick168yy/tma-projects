import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

const query = vi.fn()
const execute = vi.fn()
vi.mock('../clients/platform-mysql.client.js', () => ({
  getPlatformPool: () => ({ query, execute }),
}))

const { generateTotpSecret } = await import('../utils/totp.js')
const {
  loginPlatformAdmin, verifyPlatformTotpLogin, shouldRequirePlatformTotp,
} = await import('../services/platform-auth.service.js')
const { hashPassword } = await import('../services/admin-auth.service.js')

/** 只实现被测代码用到的几个命令，够用就行 */
function fakeRedis() {
  const store = new Map<string, string>()
  return {
    store,
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK' }),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK' }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    del: vi.fn(async (k: string) => { store.delete(k); return 1 }),
    ttl: vi.fn(async () => 3600),
  } as never
}

const ENV_ON = { PLATFORM_TOTP_REQUIRED: true }
const ENV_OFF = { PLATFORM_TOTP_REQUIRED: false }

async function rowFor(opts: { secret?: string | null; enabled?: number } = {}) {
  return {
    id: 7,
    username: 'platform_admin',
    password_hash: await hashPassword('correct-horse'),
    role: 'platform_super',
    enabled: opts.enabled ?? 1,
    totp_secret: opts.secret ?? null,
  }
}

beforeEach(() => { query.mockReset(); execute.mockReset(); execute.mockResolvedValue([{}]) })

describe('平台后台两步验证', () => {
  it('所有平台角色都强制绑定，不像租户后台放过 ops', () => {
    expect(shouldRequirePlatformTotp(ENV_ON)).toBe(true)
    expect(shouldRequirePlatformTotp(ENV_OFF)).toBe(false)
  })

  it('已绑定时密码只换到 challenge 票，拿不到 session', async () => {
    query.mockResolvedValue([[await rowFor({ secret: generateTotpSecret() })]])
    const res = await loginPlatformAdmin(fakeRedis(), ENV_ON, 'platform_admin', 'correct-horse')
    expect(res).toMatchObject({ requiresTotp: true })
    expect(res).not.toHaveProperty('token')
  })

  it('未绑定且强制开启时发受限 session', async () => {
    query.mockResolvedValue([[await rowFor({ secret: null })]])
    const res = await loginPlatformAdmin(fakeRedis(), ENV_ON, 'platform_admin', 'correct-horse')
    expect(res).toMatchObject({ totpSetupRequired: true })
    expect(res).toHaveProperty('token')
  })

  it('关掉开关且未绑定时是普通 session', async () => {
    query.mockResolvedValue([[await rowFor({ secret: null })]])
    const res = await loginPlatformAdmin(fakeRedis(), ENV_OFF, 'platform_admin', 'correct-horse')
    expect(res).toHaveProperty('token')
    expect(res).not.toHaveProperty('totpSetupRequired')
  })

  it('密码错误一律返回 null，不区分账号是否存在', async () => {
    query.mockResolvedValue([[await rowFor({ secret: null })]])
    expect(await loginPlatformAdmin(fakeRedis(), ENV_ON, 'platform_admin', 'wrong')).toBeNull()
    query.mockResolvedValue([[]])
    expect(await loginPlatformAdmin(fakeRedis(), ENV_ON, 'nobody', 'whatever')).toBeNull()
  })

  it('禁用的账号即使密码正确也进不来', async () => {
    query.mockResolvedValue([[await rowFor({ secret: null, enabled: 0 })]])
    expect(await loginPlatformAdmin(fakeRedis(), ENV_ON, 'platform_admin', 'correct-horse')).toBeNull()
  })

  it('正确验证码换到 session，且 challenge 票用过即焚', async () => {
    const redis = fakeRedis()
    const secret = generateTotpSecret()
    query.mockResolvedValue([[await rowFor({ secret })]])
    const login = await loginPlatformAdmin(redis, ENV_ON, 'platform_admin', 'correct-horse')
    const challengeToken = (login as { challengeToken: string }).challengeToken

    const code = currentCode(secret)
    const ok = await verifyPlatformTotpLogin(redis, challengeToken, code)
    expect(ok).toHaveProperty('token')

    // 同一张票不能重放
    expect(await verifyPlatformTotpLogin(redis, challengeToken, code)).toBeNull()
  })

  it('错误验证码拿不到 session', async () => {
    const redis = fakeRedis()
    const secret = generateTotpSecret()
    query.mockResolvedValue([[await rowFor({ secret })]])
    const login = await loginPlatformAdmin(redis, ENV_ON, 'platform_admin', 'correct-horse')
    const challengeToken = (login as { challengeToken: string }).challengeToken
    expect(await verifyPlatformTotpLogin(redis, challengeToken, '000000')).toBeNull()
  })

  it('伪造的 challenge 票直接失败', async () => {
    expect(await verifyPlatformTotpLogin(fakeRedis(), 'not-a-real-token', '123456')).toBeNull()
  })
})

/** 按 RFC 6238 自己算一遍当前窗口的码，而不是去暴力枚举 —— 顺带独立验证了被测实现 */
function currentCode(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))

  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(msg).digest()
  const off = digest[digest.length - 1] & 0x0f
  const bin = ((digest[off] & 0x7f) << 24) | ((digest[off + 1] & 0xff) << 16)
    | ((digest[off + 2] & 0xff) << 8) | (digest[off + 3] & 0xff)
  return String(bin % 1_000_000).padStart(6, '0')
}
