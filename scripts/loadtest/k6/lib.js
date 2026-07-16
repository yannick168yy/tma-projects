// k6 共享库：加载用户池 token、构造带鉴权+设备指纹的请求头
// tokens.json 由 seed-users.mjs 产出，放在 scripts/loadtest/ 下（相对本文件上一级）
const RAW = open('../tokens.json')
export const TOKENS = JSON.parse(RAW)
export const BASE = __ENV.BASE_URL || 'https://www.188facai.com'

// 每个 VU 固定绑定一个用户 + 稳定的 X-Device-Id（避免同 IP 无 device 触发风控）
export function pick() {
  return TOKENS[(__VU - 1) % TOKENS.length]
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
  http_req_duration: ['p95<800', 'p99<2000'],
  http_req_failed: ['rate<0.01'],
}
