# 技术架构

## 1. 总体拓扑

```
                    ┌─────────────────────────────────────────┐
                    │           Telegram Cloud                 │
                    │  Bot API / WebApp initData / Payments   │
                    └──────────────────┬──────────────────────┘
                                       │ HTTPS
                    ┌──────────────────▼──────────────────────┐
                    │  apps/web-tma (Vue3 + Vite + Pinia)      │
                    │  Telegram WebApp SDK                     │
                    └──────────────────┬──────────────────────┘
                                       │ REST /api/*
                    ┌──────────────────▼──────────────────────┐
                    │  apps/bff-node (Koa/TS)                  │
                    │  • initData HMAC 校验                     │
                    │  • Session → Redis                       │
                    │  • 用户 / 活动 / 分销                     │
                    │  • HTTP Client → Core                    │
                    └──────────┬───────────────┬──────────────┘
                               │               │
              ┌────────────────▼───┐    ┌──────▼──────────────────┐
              │  apps/core-node     │    │  Redis 7                 │
              │  Fastify + TS       │◀──▶│  Session / 余额 / 幂等    │
              │  • callback 入口    │    └─────────────────────────┘
              │  • wallet 领域      │
              │  • Lua 原子更新     │    ┌─────────────────────────┐
              │  • NATS Consumer    │◀──▶│  NATS JetStream          │
              └──────────┬──────────┘    │  账变事件削峰             │
                         │               └─────────────────────────┘
              ┌──────────▼──────────┐
              │  MySQL 8.0          │
              │  bg_wallet_ledger   │
              │  bg_wallet / bg_user│
              └─────────────────────┘

外部: 游戏聚合商 ──HTTPS 回调──▶ Core /api/v1/callback/:provider
```

## 2. 技术栈与职责

| 层级 | 技术 | 职责 |
|------|------|------|
| 前端 | Vue 3, Vite, Tailwind, Pinia | TMA UI、SDK 封装、仅调 BFF |
| BFF | Node.js (Koa), TypeScript | TG 生态、鉴权、非账变业务 |
| 核心 | Node.js (Fastify), TypeScript | 回调、账变、Lua 原子更新、NATS 消费 |
| 缓存 | Redis 7 | Session、余额、幂等、分布式锁 |
| DB | MySQL 8 | 持久化、对账 |
| MQ | NATS JetStream | 账变事件削峰、至少一次投递 |

## 3. 无状态与横向扩展

| 组件 | 状态存放 | 扩展方式 |
|------|----------|----------|
| web-tma | 无（静态 CDN） | 多副本 + CDN |
| bff-node | Redis Session | 负载均衡 + 多实例 |
| core-node | Redis + NATS | 回调入口多实例；Consumer 竞争消费 |
| Redis | — | 主从 / Cluster（后期） |
| MySQL | — | 读写分离（后期） |

**禁止**：在 Node 使用内存 Map 存用户、在进程内缓存余额。

## 4. core-node 模块结构

```
apps/core-node/src/
├── config/
│   └── env.ts          # 环境变量（Zod 校验）
├── plugins/
│   ├── nats.ts         # NATS JetStream 插件，初始化 Stream
│   ├── mysql.ts        # MySQL 连接池插件
│   └── (redis 由 @fastify/redis 插件提供)
├── routes/
│   ├── index.ts        # 路由注册 + /health
│   └── callback.routes.ts  # 聚合商回调入口
├── services/
│   └── wallet.service.ts   # 余额更新、账变写入
├── consumers/
│   └── ledger.consumer.ts  # NATS JetStream 消费者
└── utils/
    └── lua-scripts.ts      # Redis Lua 原子脚本
```

**依赖规则（强制）**

- `callback.routes` → 验签 → NATS publish，**禁止** 直接写 MySQL。
- `ledger.consumer` → `wallet.service` → Redis Lua + MySQL。
- 跨模块只通过 **NATS 消息** 通信，不直接调用对方函数。

## 5. NATS JetStream 设计

| 参数 | 值 |
|------|-----|
| Stream 名 | `BETOGO` |
| Subjects | `betogo.>` |
| Retention | WorkQueue（消费后删除） |
| Storage | File（持久化） |
| 消费者 | `ledger-worker`（durable, explicit ack） |
| 最大重试 | 5 次（超出后进 NATS dead letter） |
| Ack 超时 | 30 秒 |

## 6. 高并发账变模型

### 6.1 同步路径（HTTP 回调）

1. 验证聚合商签名（各厂商适配器）。
2. `EVAL` Lua 幂等锁：`SET idempotency:{refId} 1 NX EX 604800`。
3. 序列化 payload → `js.publish('betogo.callback', ...)`。
4. 立即返回 `200 { "code": 0 }`。

### 6.2 异步路径（NATS Consumer）

1. 拉取消息，反序列化。
2. 调 `WalletService.applyLedger`：
   - 幂等检查（Redis SETNX）。
   - `EVAL` Lua：检查余额 → 原子 INCRBY → 返回新余额。
   - `INSERT bg_wallet_ledger`（仅追加，不更新）。
3. `msg.ack()`。
4. 失败：`msg.nak()` → NATS 自动重试；超次后消息留在 Stream 供告警。

### 6.3 Lua 脚本职责

- 原子：读余额 → 校验最低余额 → INCRBY → 返回新余额。
- 不在 Lua 写 MySQL（保持脚本简短可测）。

## 7. BFF 技术要点

- 中间件顺序：`requestId` → `bodyParser` → `rateLimit` → `auth` → routes。
- `auth`：解析 Session Token → Redis `GET session:{id}`。
- `initData` 校验：`HMAC_SHA256(bot_token, "WebAppData")`。
- 调 Core：内部网络 `http://core-node:4000` + `X-Internal-Service-Key`。
- **BFF 不实现账变回调**；账变历史由 BFF 代理 Core 只读 API。

## 8. 前端架构要点

```
src/
├── api/           # fetch 封装，baseURL → BFF
├── stores/        # Pinia: user, wallet, promotion, locale
├── composables/   # useTelegramWebApp, useInitData
├── views/
└── components/
```

- 启动时 `Telegram.WebApp.ready()` / `expand()`。
- 所有 API 自动附带 `Authorization`。
- 环境变量：`VITE_BFF_BASE_URL`。

## 9. 安全清单

| 风险 | 措施 |
|------|------|
| 伪造 TG 用户 | BFF 强制 initData HMAC |
| 伪造聚合商回调 | 各厂商 IP 白名单 + 签名 + 幂等 |
| 重放回调 | Redis SETNX（7天）+ DB 唯一索引 |
| 越权访问 | BFF 校验 userId；Core 内部 API 内网 + 密钥 |
| 刷接口 | BFF rate limit（Redis 滑动窗口） |
| 敏感配置 | `.env` 不入库；生产用密钥管理 |
| SQL 注入 | mysql2 参数化查询 |
| 日志泄密 | 不打印 initData、token |

## 10. 可观测性（MVP 预留）

- 统一 `X-Request-Id` 贯穿 BFF → Core → NATS。
- 指标：回调 QPS、NATS 堆积、Consumer lag、Redis 余额操作耗时。
- 日志：结构化 JSON（生产），pino-pretty（开发）。

## 11. 本地开发（Docker Only）

```bash
cp .env.example .env
docker compose up -d --build
# 客户端   http://localhost:8080
# BFF      http://localhost:3000
# Core     http://localhost:4000
# NATS 监控 http://localhost:8222
# MySQL    :3306  Redis :6379
```

## 12. 配置分层

| 环境 | 配置来源 |
|------|----------|
| 本地 | `.env` |
| 单机生产 | 环境变量（docker compose prod） |
| 未来 K8s | ConfigMap + Secret，不改代码 |
