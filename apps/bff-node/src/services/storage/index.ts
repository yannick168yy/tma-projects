import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Env } from '../../config/env.js'
import { currentTenantOrNull } from '../../lib/tenant-context.js'

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

/**
 * 按租户隔离存储路径。与 Redis 前缀同一套规则：自营站前缀为空，
 * 存量文件的 key 已经写进数据库，不能变；新租户从 `t{id}/` 起步，两边永不冲突。
 */
class TenantScopedStorage implements StorageProvider {
  constructor(private readonly inner: StorageProvider) {}

  private scope(key: string): string {
    const tenant = currentTenantOrNull()
    return !tenant || tenant.selfOperated ? key : `t${tenant.id}/${key}`
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<string> {
    await this.inner.put(this.scope(key), data, mimeType)
    // 必须返回未加前缀的 key：它会被写进租户自己的库，
    // 存了带前缀的 key，下次 get 再加一次前缀就变成 t2/t2/... 永远读不到
    return key
  }

  exists(key: string): Promise<boolean> {
    return this.inner.exists(this.scope(key))
  }

  get(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
    return this.inner.get(this.scope(key))
  }
}

export function getStorageProvider(env: Env): StorageProvider {
  const base = env.S3_BUCKET
    ? (() => {
        if (!env.S3_REGION) throw new Error('S3_REGION is required when S3_BUCKET is set')
        return new S3Storage(env)
      })()
    : new LocalStorage(env.KYC_STORAGE_DIR)
  return new TenantScopedStorage(base)
}
