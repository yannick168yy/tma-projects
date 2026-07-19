import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2'

const CONCURRENCY = 8
// 图片宽高在文件头部（PNG 前 24 字节、JPEG 的 SOF 段通常在前几 KB），取前 64KB 足够
const FETCH_RANGE_BYTES = 65535
const FETCH_TIMEOUT_MS = 10_000

export function parseImageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: 签名 8 字节 + IHDR 块，宽高在偏移 16/20（uint32 BE）
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // GIF: "GIF87a"/"GIF89a"，宽高在偏移 6/8（uint16 LE）
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  // JPEG: 扫描段直到 SOF0-SOF15（跳过 C4/C8/CC），宽高在 SOF 段偏移 5/7（uint16 BE）
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker === 0xff) {
        i++
        continue
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      // 无长度字段的独立标记
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2
        continue
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
    return null
  }
  return null
}

export async function probeImageSize(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${FETCH_RANGE_BYTES}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return parseImageSize(buf)
  } catch {
    return null
  }
}

const MAX_ATTEMPTS = 3

function isValidSize(s: { width: number; height: number } | null): s is { width: number; height: number } {
  return !!s && s.width > 0 && s.height > 0 && s.width <= 65535 && s.height <= 65535
}

// PNG/JPG 偶发抓取失败（CDN 抽风、超时）重试可救回；SVG/占位图重试后仍失败即确定无图
async function probeWithRetry(url: string): Promise<{ width: number; height: number } | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const size = await probeImageSize(url)
    if (isValidSize(size)) return size
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 300 * attempt))
  }
  return null
}

export interface IconProbeResult {
  total: number
  ok: number
  noImage: number
  landscape: number
}

/**
 * 补测所有缺宽高的游戏封面（icon_probed_at IS NULL）。
 * 抓图成功落宽高；重试后仍失败视为确定无图，只落 icon_probed_at 标记，避免每次同步无限重探。
 */
export async function probePendingGameIcons(app: FastifyInstance): Promise<IconProbeResult> {
  const empty: IconProbeResult = { total: 0, ok: 0, noImage: 0, landscape: 0 }
  try {
    const [rows] = await app.mysql.query<RowDataPacket[]>(
      `SELECT game_id, game_provider_id, icon_url FROM bg_568win_game
       WHERE icon_url IS NOT NULL AND icon_probed_at IS NULL`,
    )
    if (rows.length === 0) return empty
    app.log.info({ total: rows.length }, '[icon-probe] start')

    // 并发只用于抓图；DB 写入串行复用池内连接，避免并发新建连接触发 podman DNS 解析失败
    const queue = [...rows]
    const sized: { gameProviderId: number; gameId: number; width: number; height: number }[] = []
    const noImage: { gameProviderId: number; gameId: number }[] = []
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (;;) {
          const row = queue.shift()
          if (!row) return
          const ids = { gameProviderId: Number(row.game_provider_id), gameId: Number(row.game_id) }
          const size = await probeWithRetry(String(row.icon_url))
          if (size) sized.push({ ...ids, width: size.width, height: size.height })
          else noImage.push(ids)
        }
      }),
    )

    let ok = 0
    let landscape = 0
    for (const r of sized) {
      await app.mysql.execute(
        `UPDATE bg_568win_game SET icon_width = ?, icon_height = ?, icon_probed_at = NOW(3)
         WHERE game_provider_id = ? AND game_id = ?`,
        [r.width, r.height, r.gameProviderId, r.gameId],
      )
      ok++
      if (r.width > r.height * 1.15) landscape++
    }
    // 确定无图：只落 icon_probed_at 标记已探测，宽高保持 NULL，前端据此走默认比例不下发
    for (const r of noImage) {
      await app.mysql.execute(
        `UPDATE bg_568win_game SET icon_probed_at = NOW(3)
         WHERE game_provider_id = ? AND game_id = ?`,
        [r.gameProviderId, r.gameId],
      )
    }
    const result: IconProbeResult = { total: rows.length, ok, noImage: noImage.length, landscape }
    app.log.info(result, '[icon-probe] done')
    return result
  } catch (err) {
    app.log.error({ err }, '[icon-probe] failed')
    return empty
  }
}
