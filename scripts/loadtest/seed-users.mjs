// 压测用户池种子 —— 复用 app 自身编译产物(dist)里的 store facade，
// 自动按 BFF_STORAGE 路由：user→MySQL(bg_user/bg_user_promo_state)、session→Redis。
// 必须在 tma-bff-node 容器内运行(能 import /app/dist + 有 MySQL/Redis 连接)：
//   ssh ... 'podman exec -i -e LT_COUNT=200 -e LT_TTL=14400 tma-bff-node node --input-type=module' < seed-users.mjs
//
// token 用确定性规则 `LTK-<i>`(不与真实 64-hex 冲突)，k6 端同规则复算，无需回传 tokens.json。
const store = await import('/app/dist/services/store/index.js')
const { loadEnv } = await import('/app/dist/config/env.js')
const { getRedis } = await import('/app/dist/clients/redis.client.js')

const COUNT = Number(process.env.LT_COUNT || 200)
const TTL = Number(process.env.LT_TTL || 14_400)
const env = loadEnv()
store.initStore(env)
const redis = getRedis(env)
const nowIso = () => new Date().toISOString()
const expiresIso = () => new Date(Date.now() + TTL * 1000).toISOString()

for (let i = 1; i <= COUNT; i++) {
  const uid = `LT-${i}`
  await store.saveUser(redis, {
    id: uid,
    displayName: `LoadTest ${i}`,
    inviteCode: `LTINV${i}`,
    locale: 'en',
    status: 'active',
    registeredAt: nowIso(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  })
  await store.saveSession(redis, `LTK-${i}`, { userId: uid, expiresAt: expiresIso() }, TTL)
  if (i % 50 === 0) process.stderr.write(`  seeded ${i}/${COUNT}\n`)
}

// 自校验：走 app 的读路径确认 getUser(MySQL) + session(Redis) 都在
let ok = 0
for (let i = 1; i <= COUNT; i++) {
  const u = await store.getUser(redis, `LT-${i}`)
  const s = await redis.exists(`tma:session:LTK-${i}`)
  if (u && u.status === 'active' && s) ok++
}
process.stderr.write(`seeded ${COUNT} users (MySQL) + sessions (Redis)，回读校验 ${ok}/${COUNT}，ttl=${TTL}s\n`)
await redis.quit()
process.exit(ok === COUNT ? 0 : 1)
