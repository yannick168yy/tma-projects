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

function aesDecrypt(ciphertextWithTag: Buffer, key: Buffer, iv: Buffer): string {
  const body = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AUTH_TAG_LEN)
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - AUTH_TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

function rsaDecrypt(data: Buffer, privateKeyPem: string): Buffer {
  return privateDecrypt({ key: privateKeyPem, ...OAEP_OPTIONS }, data)
}

function rsaEncrypt(data: Buffer, publicKeyPem: string): Buffer {
  return publicEncrypt({ key: publicKeyPem, ...OAEP_OPTIONS }, data)
}

function aesEncrypt(plaintext: string, key: Buffer, iv: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([body, tag])
}

function verifyRsa(message: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('SHA256')
    verifier.update(message, 'utf8')
    return verifier.verify(publicKeyPem, signatureB64, 'base64')
  } catch (err) {
    console.error('[verifyRsa] 异常:', err instanceof Error ? err.message : err)
    return false
  }
}

function signRsa(message: string, privateKeyPem: string): string {
  const signer = createSign('SHA256')
  signer.update(message, 'utf8')
  return signer.sign(privateKeyPem).toString('base64')
}

export interface MatrixEnvelope {
  apiKey?: string
  timestamp: string
  data: string
  key: string
  sig: string
  rsaType: 'ECB_OAEP'
  aesType: 'GCM_NOPADDING'
}

// 仅验签（不解密），用于 verifiers.ts 快速判断
export function verifyNotifySignature(
  envelope: MatrixEnvelope,
  platformNotifyPubKeyPem: string,
): boolean {
  const signStr = `data=${envelope.data}&key=${envelope.key}&timestamp=${envelope.timestamp}`
  const ok = verifyRsa(signStr, envelope.sig, platformNotifyPubKeyPem)
  if (!ok) {
    console.warn('[verifyNotifySignature] 验签失败')
    console.warn('  signStr(前200):', signStr.slice(0, 200))
    console.warn('  pubKey(前60):', platformNotifyPubKeyPem.slice(0, 60))
    console.warn('  sig(前40):', envelope.sig.slice(0, 40))
  }
  return ok
}

// 验签 + 解密通知 / 提现反查请求
export function parseNotify<T>(
  envelope: MatrixEnvelope,
  platformNotifyPubKeyPem: string,
  merchantNotifyPrivKeyPem: string,
): T {
  if (!verifyNotifySignature(envelope, platformNotifyPubKeyPem)) {
    throw new Error('Matrix notification signature verification failed')
  }
  const keyMaterial = rsaDecrypt(Buffer.from(envelope.key, 'base64'), merchantNotifyPrivKeyPem)
  const aesKey = keyMaterial.subarray(0, AES_KEY_LEN)
  const iv = keyMaterial.subarray(AES_KEY_LEN, AES_KEY_LEN + AES_IV_LEN)
  const plaintext = aesDecrypt(Buffer.from(envelope.data, 'base64'), aesKey, iv)
  return JSON.parse(plaintext) as T
}

// 构造提现反查加密响应
export function buildWithdrawCheckResponse(
  bizData: unknown,
  merchantNotifyPrivKeyPem: string,
  platformNotifyPubKeyPem: string,
): MatrixEnvelope {
  const aesKey = randomBytes(AES_KEY_LEN)
  const iv = randomBytes(AES_IV_LEN)
  const encrypted = aesEncrypt(JSON.stringify(bizData), aesKey, iv)
  const dataB64 = encrypted.toString('base64')
  const keyB64 = rsaEncrypt(Buffer.concat([aesKey, iv]), platformNotifyPubKeyPem).toString('base64')
  const timestamp = String(Date.now())
  const sig = signRsa(`data=${dataB64}&key=${keyB64}&timestamp=${timestamp}`, merchantNotifyPrivKeyPem)
  return { timestamp, data: dataB64, key: keyB64, sig, rsaType: 'ECB_OAEP', aesType: 'GCM_NOPADDING' }
}

export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}
