import { beforeEach, describe, expect, it } from 'vitest'
import { hasCredentialKey, maskSecret, openSecret, sealSecret } from '../lib/secret-box.js'

const KEY = 'a'.repeat(64)

describe('通道凭据加密（P2-8）', () => {
  beforeEach(() => { process.env.TENANT_CREDENTIAL_KEY = KEY })

  it('封装后能原样取回', () => {
    const { cipher, iv } = sealSecret('mch=123&key=secret')
    expect(cipher).not.toContain('secret')
    expect(openSecret(cipher, iv)).toBe('mch=123&key=secret')
  })

  it('每次 iv 不同，同一明文密文不重复', () => {
    const a = sealSecret('same')
    const b = sealSecret('same')
    expect(a.iv).not.toBe(b.iv)
    expect(a.cipher).not.toBe(b.cipher)
  })

  it('密文被改过就解不开（GCM 认证）', () => {
    const { cipher, iv } = sealSecret('tamper-me')
    const broken = `${Buffer.from('x').toString('base64')}${cipher.slice(2)}`
    expect(() => openSecret(broken, iv)).toThrow()
  })

  it('没配密钥时拒绝加密，而不是明文落库', () => {
    delete process.env.TENANT_CREDENTIAL_KEY
    expect(hasCredentialKey()).toBe(false)
    expect(() => sealSecret('x')).toThrow(/TENANT_CREDENTIAL_KEY/)
  })

  it('长度不对的密钥直接拒绝', () => {
    process.env.TENANT_CREDENTIAL_KEY = 'too-short'
    expect(() => sealSecret('x')).toThrow(/32 字节/)
  })

  it('掩码保留头尾便于核对，不泄露中段', () => {
    expect(maskSecret('abcd1234efgh')).toBe('abcd****efgh')
    expect(maskSecret('short')).toBe('*****')
  })
})
