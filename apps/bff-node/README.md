# BetoGo Node BFF (Koa)

C 端唯一 REST API，v0.1 实现 [BFF-CLIENT-API.md](../../docs/product/BFF-CLIENT-API.md) 中 29 个接口。

## 本地开发

```bash
cd apps/bff-node
cp .env.example .env   # 填入 TELEGRAM_BOT_TOKEN
npm install
npm run dev            # http://localhost:3000
```

Docker 全栈：`docker compose up -d --build`（见仓库根目录）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `BFF_PORT` | 默认 3000 |
| `REDIS_URL` | Session + 临时业务数据（Core Java 就绪前） |
| `TELEGRAM_BOT_TOKEN` | BotFather token，校验 initData |
| `BFF_DEV_SKIP_TELEGRAM_AUTH` | `true` 时浏览器无 initData 可 Dev 登录（勿用于生产） |
| `SESSION_TTL_SECONDS` | Session TTL，默认 86400 |

## v0.1 路由

- `auth.routes.ts` — 认证与会话
- `user.routes.ts` — 用户资料
- `wallet.routes.ts` — 余额 / 摘要 / 流水倍数
- `deposit.routes.ts` — TG Wallet 充值
- `withdraw.routes.ts` — TG Wallet 提现
- `ledger.routes.ts` — 账变流水
- `kyc.routes.ts` — KYC
- `promotion.routes.ts` — 活动与邀请

## 架构说明

默认 `BFF_STORAGE=redis`：Session、用户、钱包、订单暂存 **Redis**（2C2G 生产推荐）。设 `BFF_STORAGE=mysql` 且配置 `MYSQL_HOST` 后走 MySQL。`core-java` 就绪后钱包可迁 Java，Redis 保留 Session。
