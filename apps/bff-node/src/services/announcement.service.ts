import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

export const ANNOUNCEMENT_PLACEMENTS = ['top_marquee', 'home_banner_top'] as const
export type AnnouncementPlacement = (typeof ANNOUNCEMENT_PLACEMENTS)[number]

interface AnnouncementRow extends RowDataPacket {
  id: number
  placement: AnnouncementPlacement
  enabled: number
  content_en: string
  content_zh: string
  content_id: string
  content_vi: string
  starts_at: Date | null
  ends_at: Date | null
  updated_at: Date
}

function toContents(r: AnnouncementRow) {
  return { en: r.content_en, zh: r.content_zh, id: r.content_id, vi: r.content_vi }
}

// 前台：只返回启用中、且当前处于时间窗内、且四语言至少一条非空的公告
export async function getPublicAnnouncements(env: Env) {
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<AnnouncementRow[]>(
    `SELECT placement, enabled, content_en, content_zh, content_id, content_vi, starts_at, ends_at
       FROM bg_announcement
      WHERE enabled = 1
        AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
        AND (ends_at   IS NULL OR ends_at   >= UTC_TIMESTAMP())`
  )
  const result: Partial<Record<AnnouncementPlacement, { contents: ReturnType<typeof toContents> }>> = {}
  for (const r of rows) {
    const contents = toContents(r)
    if (!contents.en && !contents.zh && !contents.id && !contents.vi) continue
    result[r.placement] = { contents }
  }
  return result
}

// 后台：返回全部展示位（含未启用），供配置页编辑
export async function listAnnouncements(env: Env) {
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<AnnouncementRow[]>(
    `SELECT id, placement, enabled, content_en, content_zh, content_id, content_vi, starts_at, ends_at, updated_at
       FROM bg_announcement ORDER BY placement`
  )
  return rows.map((r) => ({
    placement: r.placement,
    enabled: r.enabled === 1,
    contents: toContents(r),
    startsAt: r.starts_at ? r.starts_at.toISOString() : null,
    endsAt: r.ends_at ? r.ends_at.toISOString() : null,
    updatedAt: r.updated_at.toISOString(),
  }))
}

export interface AnnouncementUpsert {
  placement: AnnouncementPlacement
  enabled: boolean
  contents: { en: string; zh: string; id: string; vi: string }
  startsAt: string | null
  endsAt: string | null
}

// 后台：按展示位 upsert；startsAt/endsAt 传 ISO(UTC) 字符串，转成 MySQL DATETIME(UTC) 存储
function isoToMysqlUtc(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
}

export async function upsertAnnouncement(env: Env, input: AnnouncementUpsert) {
  const pool = getMysqlPool(env)
  await pool.execute<ResultSetHeader>(
    `INSERT INTO bg_announcement (placement, enabled, content_en, content_zh, content_id, content_vi, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled),
       content_en = VALUES(content_en), content_zh = VALUES(content_zh),
       content_id = VALUES(content_id), content_vi = VALUES(content_vi),
       starts_at = VALUES(starts_at), ends_at = VALUES(ends_at)`,
    [
      input.placement,
      input.enabled ? 1 : 0,
      input.contents.en, input.contents.zh, input.contents.id, input.contents.vi,
      isoToMysqlUtc(input.startsAt), isoToMysqlUtc(input.endsAt),
    ]
  )
}
