import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * 对称加密支付通道凭据（P2-8）。
 *
 * AES-256-GCM，密钥来自 `TENANT_CREDENTIAL_KEY`（32 字节，hex 或 base64）。
 *
 * 🔴 没配密钥时**拒绝加密**而不是明文落库：通道密钥泄露等于客户的钱可以被直接
 * 提走，「暂时先明文，上线前再加」这种妥协一定会留在库里。
 */
function key(): Buffer {
  const raw = process.env.TENANT_CREDENTIAL_KEY ?? ''
  if (!raw) throw new Error('未配置 TENANT_CREDENTIAL_KEY，拒绝存储支付凭据')
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('TENANT_CREDENTIAL_KEY 需为 32 字节（64 位 hex 或 base64）')
  return buf
}

export function hasCredentialKey(): boolean {
  try { key(); return true } catch { return false }
}

/** 返回 cipher 与 iv 两段分开存，与 pf_tenant_channel 的列结构对应 */
export function sealSecret(plain: string): { cipher: string; iv: string } {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  // authTag 附在密文尾部：分三列存没有额外好处，少一列少一处忘记同步
  return { cipher: Buffer.concat([enc, c.getAuthTag()]).toString('base64'), iv: iv.toString('base64') }
}

export function openSecret(cipher: string, iv: string): string {
  const raw = Buffer.from(cipher, 'base64')
  const tag = raw.subarray(raw.length - 16)
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(tag)
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8')
}

/** 后台只显掩码：`abcd1234efgh` → `abcd****efgh` */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return '*'.repeat(plain.length)
  return `${plain.slice(0, 4)}${'*'.repeat(Math.min(8, plain.length - 8))}${plain.slice(-4)}`
}
