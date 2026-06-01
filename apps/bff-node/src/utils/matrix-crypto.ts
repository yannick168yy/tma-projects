import {
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  createSign,
  createVerify,
  randomBytes,
  constants,
} from 'node:crypto'

const AES_KEY_LEN = 32
const AES_IV_LEN = 16
const AUTH_TAG_LEN = 16

const OAEP_OPTIONS = {
  padding: constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: 'sha256',
} as const

// ── AES-256-GCM ──────────────────────────────────────────────────────────────

function aesEncrypt(
  plaintext: string,
  key: Buffer,
  iv: Buffer,
): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([body, tag])
}

function aesDecrypt(ciphertextWithTag: Buffer, key: Buffer, iv: Buffer): string {
  const body = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AUTH_TAG_LEN)
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - AUTH_TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

// ── RSA-OAEP ─────────────────────────────────────────────────────────────────

function rsaEncrypt(data: Buffer, publicKeyPem: string): Buffer {
  return publicEncrypt({ key: publicKeyPem, ...OAEP_OPTIONS }, data)
}

function rsaDecrypt(data: Buffer, privateKeyPem: string): Buffer {
  return privateDecrypt({ key: privateKeyPem, ...OAEP_OPTIONS }, data)
}

// ── SHA256WithRSA 签名 ────────────────────────────────────────────────────────

function sign(message: string, privateKeyPem: string): string {
  const signer = createSign('SHA256')
  signer.update(message, 'utf8')
  return signer.sign(privateKeyPem).toString('base64')
}

function verify(message: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('SHA256')
    verifier.update(message, 'utf8')
    return verifier.verify(publicKeyPem, signatureB64, 'base64')
  } catch {
    return false
  }
}

// ── 外层报文类型 ──────────────────────────────────────────────────────────────

export interface MatrixEnvelope {
  apiKey?: string
  timestamp: string
  data: string
  key: string
  sig: string
  rsaType: 'ECB_OAEP'
  aesType: 'GCM_NOPADDING'
}

// ── 商户请求平台：加密 + 签名 ─────────────────────────────────────────────────

export function buildRequest(
  bizData: unknown,
  apiKey: string,
  merchantPrivKeyPem: string,
  platformPubKeyPem: string,
): MatrixEnvelope {
  const aesKey = randomBytes(AES_KEY_LEN)
  const iv = randomBytes(AES_IV_LEN)
  const plaintext = JSON.stringify(bizData)

  const encrypted = aesEncrypt(plaintext, aesKey, iv)
  const dataB64 = encrypted.toString('base64')

  const keyMaterial = Buffer.concat([aesKey, iv])
  const encKey = rsaEncrypt(keyMaterial, platformPubKeyPem)
  const keyB64 = encKey.toString('base64')

  const timestamp = String(Date.now())
  const signStr = `apiKey=${apiKey}&data=${dataB64}&key=${keyB64}&timestamp=${timestamp}`
  const sig = sign(signStr, merchantPrivKeyPem)

  return {
    apiKey,
    timestamp,
    data: dataB64,
    key: keyB64,
    sig,
    rsaType: 'ECB_OAEP',
    aesType: 'GCM_NOPADDING',
  }
}

// ── 平台成功响应：验签 + 解密 ─────────────────────────────────────────────────

export function parseResponse<T>(
  envelope: MatrixEnvelope,
  platformPubKeyPem: string,
  merchantPrivKeyPem: string,
): T {
  const signStr = `data=${envelope.data}&key=${envelope.key}&timestamp=${envelope.timestamp}`
  if (!verify(signStr, envelope.sig, platformPubKeyPem)) {
    throw new Error('Matrix response signature verification failed')
  }

  const keyMaterial = rsaDecrypt(Buffer.from(envelope.key, 'base64'), merchantPrivKeyPem)
  const aesKey = keyMaterial.subarray(0, AES_KEY_LEN)
  const iv = keyMaterial.subarray(AES_KEY_LEN, AES_KEY_LEN + AES_IV_LEN)

  const plaintext = aesDecrypt(Buffer.from(envelope.data, 'base64'), aesKey, iv)
  return JSON.parse(plaintext) as T
}

// ── 平台通知 / 提现反查请求：验签 + 解密 ─────────────────────────────────────

export function parseNotify<T>(
  envelope: MatrixEnvelope,
  platformNotifyPubKeyPem: string,
  merchantNotifyPrivKeyPem: string,
): T {
  const signStr = `data=${envelope.data}&key=${envelope.key}&timestamp=${envelope.timestamp}`
  if (!verify(signStr, envelope.sig, platformNotifyPubKeyPem)) {
    throw new Error('Matrix notification signature verification failed')
  }

  const keyMaterial = rsaDecrypt(Buffer.from(envelope.key, 'base64'), merchantNotifyPrivKeyPem)
  const aesKey = keyMaterial.subarray(0, AES_KEY_LEN)
  const iv = keyMaterial.subarray(AES_KEY_LEN, AES_KEY_LEN + AES_IV_LEN)

  const plaintext = aesDecrypt(Buffer.from(envelope.data, 'base64'), aesKey, iv)
  return JSON.parse(plaintext) as T
}

// ── 提现反查响应：加密 + 签名（使用通知密钥对）────────────────────────────────

export function buildWithdrawCheckResponse(
  bizData: unknown,
  merchantNotifyPrivKeyPem: string,
  platformNotifyPubKeyPem: string,
): MatrixEnvelope {
  const aesKey = randomBytes(AES_KEY_LEN)
  const iv = randomBytes(AES_IV_LEN)
  const plaintext = JSON.stringify(bizData)

  const encrypted = aesEncrypt(plaintext, aesKey, iv)
  const dataB64 = encrypted.toString('base64')

  const keyMaterial = Buffer.concat([aesKey, iv])
  const encKey = rsaEncrypt(keyMaterial, platformNotifyPubKeyPem)
  const keyB64 = encKey.toString('base64')

  const timestamp = String(Date.now())
  const signStr = `data=${dataB64}&key=${keyB64}&timestamp=${timestamp}`
  const sig = sign(signStr, merchantNotifyPrivKeyPem)

  return {
    timestamp,
    data: dataB64,
    key: keyB64,
    sig,
    rsaType: 'ECB_OAEP',
    aesType: 'GCM_NOPADDING',
  }
}
