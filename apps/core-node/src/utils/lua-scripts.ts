// 原子余额更新：检查余额充足 → 扣减 → 返回新余额
// KEYS[1] = wallet:{userId}:available
// ARGV[1] = amount_cents (正数=加，负数=扣)
// ARGV[2] = min_balance (扣减时的最低余额保证，默认 0)
export const ATOMIC_BALANCE_UPDATE = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local min_balance = tonumber(ARGV[2]) or 0
local current = tonumber(redis.call('GET', key)) or 0

if amount < 0 and (current + amount) < min_balance then
  return redis.error_reply('INSUFFICIENT_BALANCE')
end

local new_balance = redis.call('INCRBY', key, amount)
return new_balance
`

// 幂等锁：SETNX + EXPIRE，用于回调去重
// KEYS[1] = idempotency:{refId}
// ARGV[1] = TTL 秒
export const IDEMPOTENCY_LOCK = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local result = redis.call('SET', key, '1', 'NX', 'EX', ttl)
if result then return 1 else return 0 end
`
