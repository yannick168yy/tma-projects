/**
 * 把竞品策略分析结果写入 bg_568win_game_override 人工层
 *
 * 步骤:
 *   1. 清除 AI 富化写入的 weight/ph_bonus/is_featured（weight_breakdown 带 "scale":100 指纹的行）
 *   2. 按 output/matched.csv 写入竞品权重与 featured，weight_breakdown 标 source=competitor
 *
 * 写入规则:
 *   - score >= 40 的行写 weight（min(score,100)×100）
 *   - suggest_featured=1 且 provider_match=1 的行写 is_featured=1（通用名撞厂商的不 feature）
 *   - 人工在后台设置过的 is_featured 不清除、不覆盖为空
 *
 * 用法: MYSQL_HOST=127.0.0.1 MYSQL_PORT=13399 MYSQL_USER=betogo MYSQL_PASSWORD=xxx npx tsx apply.ts
 *   DRY_RUN=1 只统计不写
 */

import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

const DRY_RUN = process.env.DRY_RUN === '1'
const MIN_WEIGHT_SCORE = 40

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuote = false
      else field += c
    } else if (c === '"') inQuote = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out
}

async function main() {
  const csv = fs.readFileSync(path.join(import.meta.dirname, 'output/matched.csv'), 'utf8').split('\n').filter(Boolean)
  const header = parseCsvLine(csv[0])
  const idx = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`列不存在: ${name}`)
    return i
  }
  const col = {
    score: idx('score'), sites: idx('sites'), uuid: idx('our_uuid'),
    providerMatch: idx('provider_match'), weight: idx('suggest_weight'), featured: idx('suggest_featured'),
  }

  const db = await mysql.createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 13399),
    user: process.env.MYSQL_USER ?? 'betogo',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'betogo',
  })

  // 1. 清 AI 写入（scale:100 指纹）
  if (!DRY_RUN) {
    const [res] = await db.execute<mysql.ResultSetHeader>(
      `UPDATE bg_568win_game_override
       SET weight = NULL, ph_bonus = NULL, is_featured = NULL, weight_breakdown = NULL, weight_updated_at = NULL
       WHERE JSON_UNQUOTE(JSON_EXTRACT(weight_breakdown, '$.scale')) = '100'`,
    )
    console.log(`清除 AI 权重行: ${res.affectedRows}`)
  } else {
    const [[cnt]] = await db.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) c FROM bg_568win_game_override WHERE JSON_UNQUOTE(JSON_EXTRACT(weight_breakdown, '$.scale')) = '100'`,
    )
    console.log(`[DRY] 将清除 AI 权重行: ${cnt.c}`)
  }

  // 2. 写入竞品权重
  let applied = 0
  let featured = 0
  for (const line of csv.slice(1)) {
    const f = parseCsvLine(line)
    const score = Number(f[col.score])
    if (!(score >= MIN_WEIGHT_SCORE)) continue
    const uuid = f[col.uuid]
    const m = uuid.match(/^568win:(\d+):(\d+)$/)
    if (!m) continue
    const isFeatured = f[col.featured] === '1' && f[col.providerMatch] === '1'
    const weight = Number(f[col.weight])
    const breakdown = JSON.stringify({ source: 'competitor', score, sites: f[col.sites], provider_match: f[col.providerMatch] === '1' })
    applied++
    if (isFeatured) featured++
    if (DRY_RUN) continue
    await db.execute(
      `INSERT INTO bg_568win_game_override (game_provider_id, game_id, weight, is_featured, weight_breakdown, weight_updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         weight = VALUES(weight),
         is_featured = IF(VALUES(is_featured) IS NULL, is_featured, VALUES(is_featured)),
         weight_breakdown = VALUES(weight_breakdown),
         weight_updated_at = NOW(3)`,
      [Number(m[1]), Number(m[2]), weight, isFeatured ? 1 : null, breakdown],
    )
  }
  console.log(`${DRY_RUN ? '[DRY] ' : ''}写入竞品权重: ${applied} 款，其中 featured: ${featured} 款`)
  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
