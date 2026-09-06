# 开放 API v1（P3-7）

给包网客户的只读数据接口。用途是把「后台再加一个报表 / 导出某个字段」这类需求
从「改我们的代码」变成「客户写他自己的脚本」。

- Base URL：`https://<你的站点域名>/api/open/v1`
- 鉴权：请求头 `X-Api-Key: <prefix>.<secret>`
- 密钥自助管理：客户后台 → 系统设置 → 自助配置 → 开放 API
- **只读**。写接口（调余额、改配置）不开放：那是资损面，需要比「一把 key」
  更强的授权设计，而目前客户的需求都是拉数据

## 密钥

- 完整密钥**只在创建那一刻返回一次**，库里只存 sha256 摘要。丢了只能吊销重建
- 每把 key 可设：权限范围、每分钟请求上限（10~600，默认 120）、IP 白名单、过期时间
- 限流按 key 计，不按 IP：客户服务器换 IP 很正常，而一把 key 打爆共享连接池会影响前台玩家
- 响应头 `X-RateLimit-Limit` / `X-RateLimit-Remaining`；超限 429 + `Retry-After: 60`

### 权限范围

| scope | 覆盖 |
|---|---|
| `users:read` | 用户列表 |
| `orders:read` | 充值 / 提现订单 |
| `bets:read` | 注单流水 |
| `billing:read` | 平台账单与对账明细 |
| `stats:read` | 每日经营数据 |

## 通用约定

- 响应体：`{ "code": 0, "message": "ok", "data": ..., "traceId": "..." }`，`code != 0` 即失败
- 分页：`?page=1&pageSize=50`，pageSize 上限 200
- 时间窗：`?from=2026-09-01&to=2026-09-07`，默认近 7 天，**单次最长 92 天**
- 错误码：401 密钥无效/缺失/过期/已吊销；403 IP 不在白名单或缺 scope；429 超限
- 401 与 403 的文案会说明具体原因（是 IP 没加白，还是缺哪个 scope）——
  统一回「无权限」只会让客户反复怀疑自己抄错了 key

## 接口

### `GET /me`
当前密钥的租户、权限、限流上限。接对接时先打这个确认 key 通了。

### `GET /users`
用户列表。**不返回手机号与邮箱** —— 后台里能看（有审计），API 是会落到客户自己库里的，
少一层扩散面。

### `GET /deposits` · `GET /withdrawals`
充提订单，支持 `?status=`。含 `settlement_mode`（platform=平台代收代付 / tenant=自带通道），
对账时按它拆分。提现**不返回收款账号**（玩家隐私，也是跨租户联防要保护的对象）。

### `GET /bets`
注单流水，支持 `?userId=`。`win_loss` 含本金；`voided_at` 非空为已作废注单，统计时要排除。

### `GET /stats/daily`
每日经营数据（按币种）：充值、提现、投注、派彩、活动成本、首充。与客户后台
「数据分析」同源，数字一定对得上。

### `GET /billing/invoices` · `GET /billing/daily`
平台账单与逐日对账明细（USDT 折算率为当日快照）。与后台「平台账单」页同源。

## 示例

```bash
KEY='bgk0a1b2c3d4.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
BASE='https://your-site.com/api/open/v1'

curl -s -H "X-Api-Key: $KEY" "$BASE/me"
curl -s -H "X-Api-Key: $KEY" "$BASE/stats/daily?from=2026-09-01&to=2026-09-07"
curl -s -H "X-Api-Key: $KEY" "$BASE/deposits?status=paid&pageSize=200&page=1"
```

## 版本策略

`/api/open/v1` 的 v1 是开放 API 自己的版本号，与内部 `/api/v1` 无关。
新增字段不升版本；删字段或改字段含义才升 v2，且 v1 至少并行 3 个月。
