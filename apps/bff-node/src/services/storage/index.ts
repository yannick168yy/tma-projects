import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Env } from '../../config/env.js'

export interface StorageProvider {
  /** 存入二进制，返回可持久化的 key */
  put(key: string, data: Buffer, mimeType: string): Promise<string>
  /** 检查文件是否存在，不读取文件内容 */
  exists(key: string): Promise<boolean>
  /** 读取已存储文件 */
  get(key: string): Promise<{ data: Buffer; mimeType: string } | null>
}

class LocalStorage implements StorageProvider {
  constructor(private readonly baseDir: string) {}

  async put(key: string, data: Buffer): Promise<string> {
    const full = join(this.baseDir, key)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, data)
    return key
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(join(this.baseDir, key))
      return true
    } catch {
      return false
    }
  }

  async get(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const full = join(this.baseDir, key)
      const data = await readFile(full)
      const mimeType = key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
      return { data, mimeType }
    } catch {
      return null
    }
  }
}

class S3Storage implements StorageProvider {
  private readonly client: S3Client

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
    })
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<string> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: key,
      Body: data,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    }))
    return key
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }))
      return true
    } catch {
      return false
    }
  }

  async get(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }))
      const bytes = await res.Body?.transformToByteArray()
      if (!bytes) return null
      const mimeType = res.ContentType || (key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
      return { data: Buffer.from(bytes), mimeType }
    } catch {
      return null
    }
  }
}

export function getStorageProvider(env: Env): StorageProvider {
  if (env.S3_BUCKET) {
    if (!env.S3_REGION) throw new Error('S3_REGION is required when S3_BUCKET is set')
    return new S3Storage(env)
  }
  return new LocalStorage(env.KYC_STORAGE_DIR)
}
