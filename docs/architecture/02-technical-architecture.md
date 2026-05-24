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
                    │  apps/bff-node (Koa/Express)             │
                    │  • initData HMAC 校验                     │
                    │  • Session → Redis                       │
                    │  • 用户 / 活动 / 分销                     │
                    │  • HTTP Client → Core                    │
                    └──────────┬───────────────┬──────────────┘
                               │               │
              ┌────────────────▼───┐    ┌──────▼──────────────────┐
              │  apps/core-java     │    │  Redis 7                 │
              │  Spring Boot 3.x    │◀──▶│  Session / 余额 / 幂等    │
              │  • callback 入口    │    └─────────────────────────┘
              │  • wallet 领域      │
              │  • MQ 抽象层        │    ┌─────────────────────────┐
              │  • AMQP Consumer    │◀──▶│  RabbitMQ 3.x            │
              └──────────┬──────────┘    │  账变事件削峰             │
                         │               └─────────────────────────┘
              ┌──────────▼──────────┐
              │  MySQL 8.0          │
              │  bet_orders         │
              │  wallet / wallet_log│
              └─────────────────────┘

外部: 游戏聚合商 ──HTTPS 回调──▶ Core /callback/*
```

## 2. 技术栈与职责

| 层级 | 技术 | 职责 |
|------|------|------|
| 前端 | Vue 3, Vite, Tailwind, Pinia | TMA UI、SDK 封装、仅调 BFF |
| BFF | Node.js (Koa 推荐：轻量中间件链) | TG 生态、鉴权、非账变业务 |
| 核心 | Java 17+, Spring Boot 3.x | 回调、账变、抓取、MQ |
| 缓存 | Redis 7 | Session、余额、幂等、分布式锁 |
| DB | MySQL 8 | 持久化、对账 |
| MQ | RabbitMQ 3 | 账变事件、未来佣金等 |

## 3. 无状态与横向扩展

| 组件 | 状态存放 | 扩展方式 |
|------|----------|----------|
| web-tma | 无（静态 CDN） | 多副本 + CDN |
| bff-node | Redis Session | 负载均衡 + 多实例 |
| core-java | Redis + MQ | 回调入口多实例；Consumer 竞争消费 |
| Redis | — | 主从 / Cluster（后期） |
| MySQL | — | 读写分离（后期） |

**禁止**：在 Node/Java 使用 `static Map` 存用户、在内存缓存余额。

## 4. Java 模块与包结构（未来可拆服务）

```
com.tma.core
├── common          # 配置、异常、工具、RedisTemplate 封装
├── mq              # MessageQueueService 接口 + Rabbit 实现
├── wallet          # 领域服务、Lua 脚本、Repository
├── callback        # 聚合商 HTTP 入口（薄控制器）
├── consumer        # @RabbitListener 账变消费者
└── integration
    ├── aggregator  # 各厂商 Adapter（接口 + 实现）
    └── scraper     # 抓取任务（与 wallet 零耦合）
```

**依赖规则（强制）**

- `callback` → `mq`, `wallet`(仅 DTO/接口) ，**禁止** callback 直接写 MySQL。
- `consumer` → `wallet`, `mq`
- `integration.*` 不得依赖 `wallet` 实现类，仅依赖事件/DTO。
- 跨模块只通过 **接口 + 事件** 通信。

## 5. MessageQueueService（透明替换）

```java
public interface MessageQueueService {
    void publish(String exchange, String routingKey, Object payload, Map<String, Object> headers);
    // 消费侧由 @RabbitListener 或统一 MessageHandler 注册，不暴露 RabbitTemplate 给 wallet
}
```

- 现实现：`RabbitMQMessageQueueService`（Spring AMQP）。
- 未来：`KafkaMessageQueueService` — **仅新增类**，不改 `wallet` / `consumer` 业务。

**建议队列设计（MVP）**

| Exchange | Type | Queue | Routing Key | 用途 |
|----------|------|-------|-------------|------|
| `tma.wallet` | topic | `wallet.ledger` | `ledger.bet` / `ledger.win` | 账变事件 |
| `tma.wallet.dlx` | fanout | `wallet.ledger.dlq` | — | 死信对账 |

## 6. 高并发账变模型

### 6.1 同步路径（HTTP 回调）

1. 验证聚合商签名（每厂商 `AggregatorSignatureVerifier`）。
2. `SETNX idempotency:{agg}:{txnId}` TTL 7d。
3. 序列化 `WalletLedgerMessage` → `MessageQueueService.publish`。
4. 返回 `200 { "code": 0 }`（body 与厂商文档对齐）。

### 6.2 异步路径（Consumer）

1. 反序列化消息，二次幂等（防 MQ 重复）。
2. `EVAL` Lua：检查余额 → 扣/加 → 写 `wallet:balance:{userId}`。
3. 本地事务：`INSERT wallet_log` + `UPSERT bet_orders` + `UPDATE wallet`。
4. 提交失败：抛异常 → NACK → 重试；超次 → DLQ。

### 6.3 Lua 脚本职责（示意）

- 输入：`userId`, `delta`, `bizType`, `minBalance`
- 原子：读余额 → 校验 → 写回 → 返回 before/after
- **不在 Lua 写 MySQL**（保持脚本简短、可测试）

## 7. BFF 技术要点

- 中间件顺序：`requestId` → `bodyParser` → `rateLimit` → `auth` → routes。
- `auth`：解析 JWT/Session Token → Redis `GET session:{id}`。
- `initData` 校验：官方算法 `secret_key = HMAC_SHA256(bot_token, "WebAppData")`。
- 调 Core：内部网络 + `X-Internal-Service-Key`（MVP 可 IP 白名单）。
- **BFF 不实现 竞彩回调**；若前端需要竞彩记录历史，BFF 代理 Core 只读 API。

## 8. 前端架构要点

```
src/
├── api/           # axios/fetch 封装，baseURL → BFF
├── stores/        # Pinia: user, wallet, game
├── composables/   # useTelegramWebApp, useInitData
├── router/
├── views/
└── components/
```

- 启动时 `Telegram.WebApp.ready()` / `expand()`。
- 所有 API 自动附带 `Authorization` 与 `X-Telegram-Init-Data`（仅登录接口需要完整 initData）。
- 环境变量：`VITE_BFF_BASE_URL`。

## 9. 安全清单（CSO）

| 风险 | 措施 |
|------|------|
| 伪造 TG 用户 | BFF 强制 initData HMAC |
| 伪造聚合商回调 | 每厂商 IP 白名单 + 签名 + 幂等 |
| 重放回调 | Redis SETNX + DB 唯一索引 |
| 越权访问 | BFF 校验 userId；Core 内部 API 内网 + 密钥 |
| 刷接口 | BFF rate limit（Redis 滑动窗口） |
| 敏感配置 | `.env` 不入库；生产用密钥管理 |
| SQL 注入 | MyBatis/JPA 参数化 |
| 日志泄密 | 不打印 initData、token、完整卡号 |

## 10. 可观测性（MVP 预留）

- 统一 `X-Request-Id` / `trace_id` 贯穿 BFF → Core → MQ。
- 指标：回调 QPS、MQ 堆积、Consumer lag、Redis 余额操作耗时、DLQ 深度。
- 日志：结构化 JSON（生产）。

## 11. 本地开发（Docker Only）

```bash
cp .env.example .env
docker compose up -d --build
# 客户端 http://localhost:5173
# MySQL :3306  Redis :6379  RabbitMQ :5672  管理台 :15672
```

**不在本机**运行 Vite dev、Node BFF 或 Java Core 进程；后续 `bff-node`、`core-java` scaffold 后同样加入根目录 `docker-compose.yml`。

## 12. 配置分层

| 环境 | 配置来源 |
|------|----------|
| 本地 | `.env` + `application-local.yml` |
| 单机生产 | 环境变量 + 挂载配置 |
| 未来 K8s | ConfigMap + Secret，**不改代码** |
