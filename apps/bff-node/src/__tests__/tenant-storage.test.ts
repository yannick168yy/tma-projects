import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'

const calls: Array<{ op: string; key: string }> = []
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { async send() { return {} } },
  PutObjectCommand: class { constructor(public input: { Key: string }) {} },
  GetObjectCommand: class { constructor(public input: { Key: string }) {} },
  HeadObjectCommand: class { constructor(public input: { Key: string }) {} },
}))
vi.mock('node:fs/promises', () => ({
  access: async (p: string) => { calls.push({ op: 'access', key: p }) },
  mkdir: async () => {},
  readFile: async (p: string) => { calls.push({ op: 'read', key: p }); return Buffer.from('x') },
  writeFile: async (p: string) => { calls.push({ op: 'write', key: p }) },
}))

const { getStorageProvider } = await import('../services/storage/index.js')
const { runWithTenant } = await import('../lib/tenant-context.js')

const env = { KYC_STORAGE_DIR: '/data/kyc', S3_BUCKET: '' } as unknown as Env
const self = { id: 1, code: 'betogo', database: 'betogo', status: 'active' as const, selfOperated: true }
const t2 = { id: 2, code: 't002', database: 'betogo_t002', status: 'active' as const, selfOperated: false }

beforeEach(() => { calls.length = 0 })

describe('对象存储租户隔离', () => {
  it('自营站路径不变，存量文件仍能读到', async () => {
    await runWithTenant(self, () => getStorageProvider(env).put('kyc/u1.jpg', Buffer.from('a'), 'image/jpeg'))
    expect(calls[0].key).toBe('/data/kyc/kyc/u1.jpg')
  })

  it('其他租户写入独立目录', async () => {
    await runWithTenant(t2, () => getStorageProvider(env).put('kyc/u1.jpg', Buffer.from('a'), 'image/jpeg'))
    expect(calls[0].key).toBe('/data/kyc/t2/kyc/u1.jpg')
  })

  // put 返回带前缀的 key 会被写进库，下次 get 再加一次前缀就成了 t2/t2/...
  it('put 返回未加前缀的 key，避免二次前缀', async () => {
    const key = await runWithTenant(t2, () => getStorageProvider(env).put('kyc/u1.jpg', Buffer.from('a'), 'image/jpeg'))
    expect(key).toBe('kyc/u1.jpg')
    await runWithTenant(t2, () => getStorageProvider(env).get(key))
    expect(calls[1].key).toBe('/data/kyc/t2/kyc/u1.jpg')
  })

  it('两个租户同名 key 落在不同路径', async () => {
    await runWithTenant(self, () => getStorageProvider(env).exists('banner/a.png'))
    await runWithTenant(t2, () => getStorageProvider(env).exists('banner/a.png'))
    expect(calls.map((c) => c.key)).toEqual(['/data/kyc/banner/a.png', '/data/kyc/t2/banner/a.png'])
  })
})
