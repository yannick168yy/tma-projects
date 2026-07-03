/**
 * Slotegrator 自验证脚本
 * 步骤：1) 确保测试玩家存在  2) games/init  3) self-validate
 */
import { createHmac, randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'

const SG_BASE   = 'https://staging.slotegrator.com/api/index.php/v1'
const MERCHANT_ID  = '3c93c9af1ffee03245460d1df7d123de'
const MERCHANT_KEY = '5b2965f7454ef6e054bae3645834d8d8b82c4a0d'
const CALLBACK_URL = 'https://www.188facai.com/api/v1/sg/callback'
const CURRENCY     = 'EUR'
const PLAYER_ID    = 'sg_test_player_001'
const PLAYER_NAME  = 'Test Player'
const GAME_UUID    = '00018917d25147249c2de4af342bb0a5' // Romeo And Juliet / KAGaming

// ── Auth helpers ──────────────────────────────────────────────────────────────
function sgSign(params) {
  const payload = Object.keys(params).sort()
    .map(k => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&')
  return createHmac('sha1', MERCHANT_KEY).update(payload).digest('hex')
}

function sgHeaders(bodyParams) {
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = Math.random().toString(36).slice(2, 12)
  const merged = { ...bodyParams, 'X-Merchant-Id': MERCHANT_ID, 'X-Timestamp': ts, 'X-Nonce': nonce }
  return {
    'X-Merchant-Id': MERCHANT_ID,
    'X-Timestamp':   String(ts),
    'X-Nonce':       nonce,
    'X-Sign':        sgSign(merged),
    'Content-Type':  'application/x-www-form-urlencoded',
  }
}

async function sgPost(path, params) {
  const headers = sgHeaders(params)
  const body    = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)])))
  const res     = await fetch(`${SG_BASE}${path}`, { method: 'POST', headers, body })
  const text    = await res.text()
  if (!res.ok) throw new Error(`SG ${path} → ${res.status}: ${text}`)
  return JSON.parse(text)
}

// ── 确保测试玩家存在 ──────────────────────────────────────────────────────────
async function ensureTestPlayer() {
  const db = await mysql.createConnection({
    host: '47.84.34.139', port: 13306,
    user: process.env.MYSQL_USER ?? 'betogo',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: 'betogo',
  })
  // bg_user
  await db.execute(
    `INSERT IGNORE INTO bg_user (id, display_name, status, created_at)
     VALUES (?, ?, 'active', NOW())`,
    [PLAYER_ID, PLAYER_NAME],
  )
  // bg_wallet — 给足余额让 bet 能扣
  await db.execute(
    `INSERT INTO bg_wallet (user_id, available_cents, frozen_cents, version)
     VALUES (?, 100000000, 0, 1)
     ON DUPLICATE KEY UPDATE available_cents = 100000000`,
    [PLAYER_ID],
  )
  await db.end()
  console.log(`✅ 测试玩家 ${PLAYER_ID} 已就绪，余额 ₱1,000,000`)
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  // 1. 确保测试玩家存在
  await ensureTestPlayer()

  // 2. games/init
  console.log('\n📡 调用 /games/init ...')
  const sessionId = randomUUID()
  const initParams = {
    game_uuid:   GAME_UUID,
    player_id:   PLAYER_ID,
    player_name: PLAYER_NAME,
    currency:    CURRENCY,
    session_id:  sessionId,
    return_url:  'https://www.188facai.com',
    language:    'en',
    device:      'desktop',
  }
  const initResp = await sgPost('/games/init', initParams)
  console.log('游戏 URL:', initResp.url)
  console.log('\n⚠️  请在浏览器中打开上面的 URL，然后【不要碰游戏任何按钮】，直接继续...')
  console.log('按回车键继续执行 self-validate...')
  await new Promise(r => process.stdin.once('data', r))

  // 3. self-validate
  console.log('\n📡 调用 /self-validate ...')
  const validateParams = {
    player_id:    PLAYER_ID,
    callback_url: CALLBACK_URL,
    currency:     CURRENCY,
  }
  const valResp = await sgPost('/self-validate', validateParams)
  console.log('\n✅ self-validate 响应:')
  console.log(JSON.stringify(valResp, null, 2))
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
