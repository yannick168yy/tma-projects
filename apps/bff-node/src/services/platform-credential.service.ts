import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * 平台库里第三方凭据的加解密（P1-5）。
 *
 * 用在 pf_tenant_provider / pf_tenant_channel 的 credential_cipher：聚合商子代理密钥、
 * 支付通道 API key 这类东西，明文落库等于一次拖库就把所有客户的收款渠道一起交出去。
 *
 * 🔴 没配密钥时**加密直接抛错**，不退化成明文存。"配置缺失就静默降级"在密钥这件事上
 * 是最糟的选择：库里躺着明文，而后台看起来一切正常。
 */
const ALG = 'aes-256-gcm'

function masterKey(): Buffer | null {
  const raw = (process.env.PLATFORM_CREDENTIAL_KEY ?? '').trim()
  if (!raw) return null
  // 32 字节的 base64 或 hex 都收：运维手上生成的形式不一定
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  return buf.length === 32 ? buf : null
}

export function credentialKeyConfigured(): boolean {
  return masterKey() !== null
}

/** 返回 { cipher, iv }；cipher 形如 `<密文b64>.<认证标签b64>` */
export function encryptCredential(plain: string): { cipher: string; iv: string } {
  const key = masterKey()
  if (!key) throw new Error('未配置 PLATFORM_CREDENTIAL_KEY（32 字节 base64 或 hex），拒绝以明文保存凭据')
  const iv = randomBytes(12)
  const c = createCipheriv(ALG, key, iv)
  const out = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return { cipher: `${out.toString('base64')}.${c.getAuthTag().toString('base64')}`, iv: iv.toString('base64') }
}

export function decryptCredential(cipher: string, iv: string): string {
  const key = masterKey()
  if (!key) throw new Error('未配置 PLATFORM_CREDENTIAL_KEY，无法解密凭据')
  const [body, tag] = cipher.split('.')
  if (!body || !tag) throw new Error('凭据密文格式不对')
  const d = createDecipheriv(ALG, key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
}

/** 后台只显掩码。短串整条打码，否则前后各留两位够运营核对是不是同一把 */
export function maskCredential(plain: string): string {
  if (plain.length <= 6) return '*'.repeat(plain.length)
  return `${plain.slice(0, 2)}${'*'.repeat(Math.min(plain.length - 4, 12))}${plain.slice(-2)}`
}
