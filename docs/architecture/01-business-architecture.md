# 业务架构

## 1. 产品定位

Telegram Mini App 博彩聚合平台 MVP：用户在 TG 内打开 WebApp，完成登录、充值、进入三方游戏、下注与结算；平台通过 BFF 承接 TG 生态能力，通过 Java 核心承接高并发账变与聚合商对接。

**MVP 范围（对齐 [产品方案 v1.0](../product/PRODUCT-PLAN.md)）**

| 阶段 | 能力 | 说明 |
|------|------|------|
| P0 | TG 登录 + 多币种钱包（PHP + 虚拟币） | initData、Redis Session；多设备登录 |
| P0 | 首页即大厅（上下半屏直达游戏） | 单聚合商、多 Provider；试玩按 Provider 配置 |
| P0 | 自动充提 | TG Wallet（非 Stars）+ 三方法币/币；无人工充值审核 |
| P0 | Bet/Win 回调账变 | Redis 幂等 → MQ → 异步落库 |
| P0 | 增长红包 | 试玩官 + 邀请双向红包；无佣金 |
| P0 | 提现风控 | 自动规则 + 人工队列；法币提现需 KYC；流水倍数 N 可配 |
| P0 | 单活跃游戏会话 | 多端可登录，禁止多端同时 in-game |
| P1 | 币种扩展 | VND、IDR 等预留 |
| P2 | 数据抓取 | 赛果/赔率（独立 package） |

## 2. 角色与边界

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Telegram    │     │ 平台 (我们)   │     │ 游戏聚合商       │
│ 用户 + Bot  │────▶│ WebApp+BFF+Core│◀───▶│ 游戏/回调 API    │
└─────────────┘     └──────────────┘     └─────────────────┘
```

- **用户**：在 TG 内使用 WebApp，不直接接触 Java 核心端口。
- **BFF**：对外唯一面向前端的 API；校验 `initData`；用户资料、活动、分销；**不处理**高并发账变。
- **Core (Java)**：聚合商回调入口、钱包账变、MQ 消费、抓取适配；**不**承担 TG 签名校验（除聚合商自有签名）。
- **聚合商**：提供游戏入口、Bet/Win/Refund 等 HTTP 回调。

## 3. 核心领域模型（逻辑）

| 聚合 | 实体 | 职责 |
|------|------|------|
| 用户 | `user`, `user_profile` | TG id 映射、邀请人、状态 |
| 钱包 | `wallet`, `wallet_log` | 可用余额、冻结、流水（不可变日志） |
| 订单 | `bet_orders` | 三方注单幂等键、状态、金额、聚合商 id |
| 支付 | `deposit_order`, `withdraw_order` | 充提（MVP 可简化） |
| 分销 | `affiliate_relation`, `commission_log` | 邀请树、返佣记录（P2） |

**余额真相源（运行时）**

- **热路径**：Redis 中 `wallet:balance:{userId}`（Lua 原子加减）。
- **冷路径**：MySQL `wallet` + `wallet_log` 异步对齐（最终一致）。
- **对账**：定时任务比对 Redis 与 MySQL，差异告警。

## 4. 主流程

### 4.1 登录与会话

1. 前端通过 `@twa-dev/sdk` 获取 `initData`。
2. 请求 BFF `POST /auth/telegram`，携带 `initData`。
3. BFF 使用 Bot Token 校验 HMAC，解析 `user`。
4. 查/建用户，写入 Redis Session（`session:{token}` → userId），返回 JWT 或 Session Token。
5. 后续请求带 `Authorization`，BFF 只查 Redis，**无进程内 Session**。

### 4.2 进入游戏

1. 前端 `GET /games`（BFF）→ 可能代理 Core 或读配置。
2. `POST /games/launch`：BFF 调 Core 或聚合商 API 获取带用户标识的启动 URL。
3. 用户在聚合商侧游戏；平台钱包余额以 Redis 为准供聚合商查询（或回调扣款）。

### 4.3 Bet/Win 回调（削峰账变）

```
聚合商 POST /callback/bet|win
    → Core: 验签 + 解析
    → Redis SETNX 幂等 (callback:idempotency:{provider}:{txnId})
    → 若重复: 直接 200
    → MessageQueueService.publish(WalletLedgerEvent)
    → 立即 HTTP 200
    → [异步] Consumer: Lua 更新 Redis 余额
    → [异步] @Transactional 写 bet_orders + wallet_log + 更新 wallet 表
    → 失败: 死信 / 重试 / 人工对账
```

**业务规则要点**

- 幂等键：`(aggregator_id, provider_txn_id)` 全局唯一。
- Bet：扣减可用余额；余额不足拒绝（异步场景需定义：拒单回写聚合商或冲正策略）。
- Win：增加余额；可与 Bet 关联 `round_id`。
- 所有金额使用 **整数最小货币单位**（分），避免浮点。

### 4.4 邀请与红包（无佣金）

- 绑定：首次注册时写入 `inviter_id`（来自 Bot `start_param=inv_<code>`）。
- 试玩官 / 老带新：达标后发放 `RED_PACKET_*` 账变；流水倍数与提现限制由运营配置。
- **前期不做** 流水佣金；Commission 模块不纳入 MVP。

## 5. 非功能需求（业务侧）

| 项 | 目标 |
|----|------|
| 回调响应 | P99 < 100ms（仅幂等 + 入队） |
| 账变最终一致 | 秒级内 Redis 可见，分钟级 MySQL 可对账 |
| 合规 | 按目标司法辖区处理 KYC/负责任博彩（MVP 预留字段） |
| 审计 | `wallet_log` 只追加；关键操作带 `trace_id` |

## 6. 未来服务拆分映射

| 当前 Package / App | 未来微服务 |
|--------------------|------------|
| `bff-node` | `tg-gateway-service` |
| `wallet` + `mq consumer` | `wallet-ledger-service` |
| `callback` | `aggregator-callback-service` |
| `integration.aggregator` | `aggregator-adapter-service` |
| `integration.scraper` | `odds-scraper-service` |
| `affiliate` (BFF 或 Core) | `commission-service` |

拆分原则：**拷贝 package + 独立 DB schema + 消息契约不变**，核心业务类不改。
