import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Env } from '../../config/env.js'

export interface StorageProvider {
  /** 存入二进制，返回可持久化的 key */
  put(key: string, data: Buffer, mimeType: string): Promise<string>
}

class LocalStorage implements StorageProvider {
  constructor(private readonly baseDir: string) {}

  async put(key: string, data: Buffer): Promise<string> {
    const full = join(this.baseDir, key)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, data)
    return key
  }
}

// S3 实现预留：拿到 S3 凭证后在此实现 PutObject，env.S3_BUCKET 非空时启用
// class S3Storage implements StorageProvider { ... }

export function getStorageProvider(env: Env): StorageProvider {
  // env.S3_BUCKET 配置后切换到 S3Storage
  return new LocalStorage(env.KYC_STORAGE_DIR)
}
