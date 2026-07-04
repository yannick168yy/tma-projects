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

/**
 * 补测所有缺宽高的游戏封面（icon_probed_at IS NULL）。
 * 探测失败不落 probed_at，下次同步自动重试；单次失败成本仅一个 HTTP 请求。
 */
export async function probePendingGameIcons(app: FastifyInstance): Promise<void> {
  try {
    const [rows] = await app.mysql.query<RowDataPacket[]>(
      `SELECT game_id, game_provider_id, icon_url FROM bg_568win_game
       WHERE icon_url IS NOT NULL AND icon_probed_at IS NULL`,
    )
    if (rows.length === 0) return
    app.log.info({ total: rows.length }, '[icon-probe] start')

    // 并发只用于抓图；DB 写入串行复用池内连接，避免并发新建连接触发 podman DNS 解析失败
    const queue = [...rows]
    const results: { gameProviderId: number; gameId: number; width: number; height: number }[] = []
    let failed = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (;;) {
          const row = queue.shift()
          if (!row) return
          const size = await probeImageSize(String(row.icon_url))
          if (!size || size.width <= 0 || size.height <= 0 || size.width > 65535 || size.height > 65535) {
            failed++
            continue
          }
          results.push({
            gameProviderId: Number(row.game_provider_id),
            gameId: Number(row.game_id),
            width: size.width,
            height: size.height,
          })
        }
      }),
    )

    let ok = 0
    let landscape = 0
    for (const r of results) {
      await app.mysql.execute(
        `UPDATE bg_568win_game SET icon_width = ?, icon_height = ?, icon_probed_at = NOW(3)
         WHERE game_provider_id = ? AND game_id = ?`,
        [r.width, r.height, r.gameProviderId, r.gameId],
      )
      ok++
      if (r.width > r.height * 1.15) landscape++
    }
    app.log.info({ total: rows.length, ok, failed, landscape }, '[icon-probe] done')
  } catch (err) {
    app.log.error({ err }, '[icon-probe] failed')
  }
}
