// k6 共享库：按与 seed-users.mjs 相同的确定性规则复算用户池 token，构造带鉴权+设备指纹的请求头
// 无需 tokens.json —— 用户数由 -e POOL=200 指定（须与 seed 的 LT_COUNT 一致）
export const BASE = __ENV.BASE_URL || 'https://www.188facai.com'
const POOL = Number(__ENV.POOL || 200)

// 每个 VU 固定绑定一个用户（LT-i / token LTK-i）+ 稳定 X-Device-Id（避免同 IP 无 device 触发风控）
export function pick() {
  const i = ((__VU - 1) % POOL) + 1
  return { userId: `LT-${i}`, token: `LTK-${i}` }
}
export function authParams(tags) {
  const u = pick()
  return {
    headers: {
      Authorization: `Bearer ${u.token}`,
      'X-Device-Id': `lt-${u.userId}`,
      'Content-Type': 'application/json',
    },
    tags: tags || {},
  }
}

// 阶梯加压档位，可用 -e PROFILE=small|medium|large 切换；默认 small（先摸底，保护 2 核小机）
const PROFILES = {
  small: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 20 },
    { duration: '1m', target: 40 },
    { duration: '30s', target: 0 },
  ],
  medium: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 150 },
    { duration: '30s', target: 0 },
  ],
  large: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 150 },
    { duration: '1m', target: 300 },
    { duration: '1m', target: 500 },
    { duration: '30s', target: 0 },
  ],
}
export const stages = PROFILES[__ENV.PROFILE || 'small']

// 通用阈值：p95<800ms、错误率<1%；越界即判定拐点已过
export const thresholds = {
  http_req_duration: ['p(95)<800', 'p(99)<2000'],
  http_req_failed: ['rate<0.01'],
}
