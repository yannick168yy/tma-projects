import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getStorageProvider } from './storage/index.js'

export type HomeContentKind = 'banner' | 'wallet_banner'
export type HomeContentActionType = 'promo' | 'cashback' | 'spin' | 'lobby' | 'none' | 'path' | 'url'

export interface HomeContentItem {
  kind: HomeContentKind
  slot: number
  imageKey: string
  imageUrl: string
  actionType: HomeContentActionType
  actionValue: string | null
  enabled: boolean
  updatedAt: string | null
}

export interface HomeContent {
  banners: HomeContentItem[]
  walletBanners: HomeContentItem[]
}

interface HomeContentRow extends RowDataPacket {
  kind: HomeContentKind
  slot: number
  image_key: string
  action_type: HomeContentActionType
  action_value: string | null
  enabled: number
  updated_at: Date | string | null
}

const VALID_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

function encodedImageKey(key: string): string {
  // key 形如 home/banner/xxx.webp，斜杠须保留为路径分隔符（nginx 会解码 %2F），
  // 仅对各段做编码，不编码斜杠
  return key.split('/').map(encodeURIComponent).join('/')
}

function imageUrl(env: Env, key: string): string {
  const keyPath = encodedImageKey(key)
  const s3PublicBase = env.S3_PUBLIC_BASE_URL.trim().replace(/\/$/, '')
  if (s3PublicBase) return `${s3PublicBase}/${keyPath}`
  const imageCdnBase = env.IMAGE_CDN_BASE.trim().replace(/\/$/, '')
  if (imageCdnBase) return `${imageCdnBase}/api/v1/home/images/${keyPath}`
  return `/api/v1/home/images/${keyPath}`
}

function mapRow(env: Env, row: HomeContentRow): HomeContentItem {
  return {
    kind: row.kind,
    slot: Number(row.slot),
    imageKey: row.image_key,
    imageUrl: imageUrl(env, row.image_key),
    actionType: row.action_type,
    actionValue: row.action_value ?? null,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ? String(row.updated_at) : null,
  }
}

export async function getHomeContent(env: Env, includeDisabled = false): Promise<HomeContent> {
  if (!isMysqlEnabled(env)) return { banners: [], walletBanners: [] }
  const db = getMysqlPool(env)
  const [rows] = await db.query<HomeContentRow[]>(
    `SELECT kind, slot, image_key, action_type, action_value, enabled, updated_at
     FROM bg_home_content
     ${includeDisabled ? '' : 'WHERE enabled = 1'}
     ORDER BY kind, slot`,
  )
  let items = rows.map((row) => mapRow(env, row))
  if (!includeDisabled) {
    const storage = getStorageProvider(env)
    const existing = await Promise.all(items.map((item) => storage.exists(item.imageKey)))
    items = items.filter((_, index) => existing[index])
  }
  return {
    banners: items.filter((item) => item.kind === 'banner'),
    walletBanners: items.filter((item) => item.kind === 'wallet_banner'),
  }
}

export async function homeContentImageExists(env: Env, imageKey: string): Promise<boolean> {
  return getStorageProvider(env).exists(imageKey)
}

export async function saveHomeContentItem(env: Env, item: {
  kind: HomeContentKind
  slot: number
  imageKey: string
  actionType: HomeContentActionType
  actionValue: string | null
  enabled: boolean
}): Promise<HomeContentItem> {
  const db = getMysqlPool(env)
  await db.query<ResultSetHeader>(
    `INSERT INTO bg_home_content (kind, slot, image_key, action_type, action_value, enabled)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       image_key = VALUES(image_key),
       action_type = VALUES(action_type),
       action_value = VALUES(action_value),
       enabled = VALUES(enabled)`,
    [item.kind, item.slot, item.imageKey, item.actionType, item.actionValue, item.enabled ? 1 : 0],
  )
  return {
    kind: item.kind,
    slot: item.slot,
    imageKey: item.imageKey,
    imageUrl: imageUrl(env, item.imageKey),
    actionType: item.actionType,
    actionValue: item.actionValue,
    enabled: item.enabled,
    updatedAt: null,
  }
}

export async function deleteHomeContentItem(env: Env, kind: HomeContentKind, slot: number): Promise<void> {
  const db = getMysqlPool(env)
  await db.query<ResultSetHeader>(
    'DELETE FROM bg_home_content WHERE kind = ? AND slot = ?',
    [kind, slot],
  )
}

export function parseImageDataUrl(dataUrl: string): { data: Buffer; mimeType: string; ext: string } | null {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null
  const mimeType = match[1]
  if (!VALID_MIME.has(mimeType)) return null
  const data = Buffer.from(match[2], 'base64')
  if (!data.length) return null
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  return { data, mimeType, ext }
}

export async function storeHomeImage(env: Env, kind: HomeContentKind, dataUrl: string): Promise<{ imageKey: string; imageUrl: string }> {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed) throw new Error('只支持 PNG、JPG、WEBP 图片')
  if (parsed.data.length > 5 * 1024 * 1024) throw new Error('图片不能超过 5MB')
  const key = `home/${kind}/${Date.now()}-${randomUUID()}.${parsed.ext}`
  const imageKey = await getStorageProvider(env).put(key, parsed.data, parsed.mimeType)
  return { imageKey, imageUrl: imageUrl(env, imageKey) }
}
