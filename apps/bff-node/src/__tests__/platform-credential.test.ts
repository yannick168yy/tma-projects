import { describe, expect, it, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  encryptCredential, decryptCredential, maskCredential, credentialKeyConfigured,
} from '../services/platform-credential.service.js'

describe('平台凭据加解密', () => {
  beforeAll(() => {
    process.env.PLATFORM_CREDENTIAL_KEY = randomBytes(32).toString('base64')
  })

  it('加解密往返一致', () => {
    const { cipher, iv } = encryptCredential('company-key-abc123')
    expect(cipher).not.toContain('company-key')
    expect(decryptCredential(cipher, iv)).toBe('company-key-abc123')
  })

  it('每次加密的 iv 不同，密文不可比对', () => {
    const a = encryptCredential('same')
    const b = encryptCredential('same')
    expect(a.iv).not.toBe(b.iv)
    expect(a.cipher).not.toBe(b.cipher)
  })

  it('密文被改过就解不开（GCM 认证标签）', () => {
    const { cipher, iv } = encryptCredential('company-key-abc123')
    const [body, tag] = cipher.split('.')
    const tampered = `${Buffer.from('evil').toString('base64')}.${tag}`
    expect(() => decryptCredential(tampered, iv)).toThrow()
    expect(() => decryptCredential(`${body}.${Buffer.from('bad').toString('base64')}`, iv)).toThrow()
  })

  it('掩码不泄露中间内容', () => {
    expect(maskCredential('abcdefghij')).toBe('ab******ij')
    expect(maskCredential('abc')).toBe('***')
  })

  it('没配主密钥时加密直接抛错，不退化成明文', () => {
    const saved = process.env.PLATFORM_CREDENTIAL_KEY
    process.env.PLATFORM_CREDENTIAL_KEY = ''
    expect(credentialKeyConfigured()).toBe(false)
    expect(() => encryptCredential('x')).toThrow(/PLATFORM_CREDENTIAL_KEY/)
    process.env.PLATFORM_CREDENTIAL_KEY = saved
  })

  it('长度不对的主密钥当作没配，而不是凑合用', () => {
    const saved = process.env.PLATFORM_CREDENTIAL_KEY
    process.env.PLATFORM_CREDENTIAL_KEY = Buffer.from('too-short').toString('base64')
    expect(credentialKeyConfigured()).toBe(false)
    process.env.PLATFORM_CREDENTIAL_KEY = saved
  })
})
