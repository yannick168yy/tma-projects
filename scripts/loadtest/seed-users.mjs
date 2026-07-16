// 压测用户池种子脚本 —— 直接写 Redis，绕过 captcha / 限流 / 登录
//
// 在服务器上通过 bff 容器运行（容器内有 ioredis + REDIS_URL）：
//   ssh ... 'podman exec -i -e LT_COUNT=200 -e LT_BALANCE=100000000 -e LT_TTL=14400 \
//     tma-bff-node node --input-type=module' < seed-users.mjs > tokens.json
//
// 输出：stdout 打印 JSON 数组 [{userId, token}]，进度打到 stderr。
// 所有写入的 key 记录进 SET `tma:loadtest:keys`，cleanup.mjs 据此一键清除。
import Redis from 'ioredis'

const COUNT = Number(process.env.LT_COUNT || 200)
const BALANCE = Number(process.env.LT_BALANCE || 100_000_000) // 钱包 available（分）；给足以免写测试跑空
const TTL = Number(process.env.LT_TTL || 14_400) // session 存活秒数，默认 4h 覆盖压测窗口
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const INDEX_KEY = 'tma:loadtest:keys'

const redis = new Redis(REDIS_URL)
const nowIso = () => new Date().toISOString()
const expiresIso = () => new Date(Date.now() + TTL * 1000).toISOString()
const hex64 = () => {
  const b = new Uint8Array(32)
  for (let i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

const out = []
const pipe = redis.pipeline()
for (let i = 1; i <= COUNT; i++) {
  const userId = `LT-${i}`
  const token = hex64()
  const userKey = `tma:user:${userId}`
  const walletKey = `tma:wallet:${userId}`
  const sessionKey = `tma:session:${token}`

  const user = {
    id: userId,
    displayName: `LoadTest ${i}`,
    inviteCode: `LT${i}`,
    locale: 'en',
    status: 'active',
    registeredAt: nowIso(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  }
  pipe.set(userKey, JSON.stringify(user))
  pipe.set(walletKey, JSON.stringify({ available: BALANCE, frozen: 0 }))
  pipe.set(sessionKey, JSON.stringify({ userId, expiresAt: expiresIso() }), 'EX', TTL)
  pipe.sadd(INDEX_KEY, userKey, walletKey, sessionKey)
  out.push({ userId, token })
  if (i % 500 === 0) process.stderr.write(`  seeded ${i}/${COUNT}\n`)
}
await pipe.exec()
process.stderr.write(`done: ${COUNT} users, balance=${BALANCE}, ttl=${TTL}s\n`)
process.stdout.write(JSON.stringify(out))
await redis.quit()
