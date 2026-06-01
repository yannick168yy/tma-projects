# Slotegrator (SG) 游戏接口文档

## 概述

Slotegrator 是游戏聚合供应商，提供老虎机、Live Casino、捕鱼、Crash 等多品类游戏。
本项目通过 BFF-Node（网关层）+ Core-Node（业务层）两层架构接入。

---

## 环境变量

| 变量 | 服务 | 说明 |
|------|------|------|
| `SG_BASE_URL` | bff-node | SG API 基础地址 |
| `SG_MERCHANT_ID` | bff-node / core-node | 商户 ID |
| `SG_MERCHANT_KEY` | bff-node / core-node | HMAC-SHA1 签名密钥 |
| `SG_CURRENCY` | bff-node / core-node | 结算货币（测试环境固定 `EUR`） |
| `SG_RETURN_URL` | bff-node | 玩家退出游戏后跳转地址 |
| `CORE_NODE_URL` | bff-node | Core-Node 内部地址（默认 `http://core-node:4000`） |
| `INTERNAL_TOKEN` | bff-node / core-node | 内部服务通信鉴权 token |

---

## 签名机制

所有向 SG 发出的请求（包括接收回调验签）均使用 HMAC-SHA1。

**算法（`slotegrator.service.ts:sgSign`）：**
1. 将所有请求参数 + `X-Merchant-Id` / `X-Timestamp` / `X-Nonce` 合并
2. 按 key 字典序排序，拼成 `URLSearchParams` 字符串
3. 用 `SG_MERCHANT_KEY` 做 HMAC-SHA1，取 hex 值

**请求 Headers：**

```
X-Merchant-Id: <SG_MERCHANT_ID>
X-Timestamp:   <Unix 秒>
X-Nonce:       <10位随机串>
X-Sign:        <HMAC-SHA1 hex>
Content-Type:  application/x-www-form-urlencoded  (POST 时)
```

---

## 一、对外暴露的接口（BFF-Node → 前端）

### 1. 游戏列表

```
GET /api/v1/slots/games
```

**无需登录**，数据来自 Redis 缓存（30 分钟 TTL），不实时查 SG。

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | number | 页码，默认 1 |
| `limit` | number | 每页数量，最大 100，默认 30 |
| `search` | string | 按游戏名 / 供应商模糊搜索 |
| `provider` | string | 按供应商过滤 |
| `category` | string | 按 category 过滤 |
| `sortCategory` | string | 按 sort_category 过滤（`slots` / `live` / `fishing` / `crash` / `table`） |
| `sortBy` | `weight` / `ph_bonus` / `name` | 排序字段，默认 `weight` |
| `themes` | string | 逗号分隔，按主题过滤 |
| `gameStyles` | string | 逗号分隔，按游戏风格过滤 |
| `playerTypes` | string | 逗号分隔，按玩家类型过滤 |

**响应：**

```jsonc
{
  "items": [
    {
      "uuid": "game-uuid",
      "name": "Dragon Tiger",          // 仅英文，不支持多语言（见下方说明）
      "provider": "Pragmatic Play",
      "category": "live_games",
      "subCategory": null,
      "sortCategory": "live",
      "imageUrl": "https://...",
      "imageHqUrl": "https://...",
      "hasDemo": true,
      "hasLobby": false,
      "isMobile": false,
      "weight": 80,
      "phBonus": 60,
      "isFeatured": false,
      "theme": null,
      "gameStyle": null,
      "playerType": null
    }
  ],
  "total": 1234,
  "page": 1,
  "pages": 42
}
```

> **游戏名称多语言支持：不支持。**
> SG `/games` API 只返回单一 `name` 字段（英文），本地数据库也只存一列 `name`。
> `language` 参数仅在启动游戏时传给 SG 引擎，影响游戏内 UI，不影响名称。
> 如需多语言展示，需在前端维护翻译映射或数据库新增 `name_*` 字段。

---

### 2. 首页推荐

```
GET /api/v1/slots/homepage
```

**无需登录**，服务端每 30 分钟加权随机刷新一次，TTL 3h5m。

**响应：**

```jsonc
{
  "popular": [ /* DbGame[], 6条，按 phBonus 加权 */ ],
  "slots":   [ /* DbGame[], 6条 */ ],
  "live":    [ /* DbGame[], 6条 */ ],
  "fishing": [ /* DbGame[], 6条 */ ],
  "crash":   [ /* DbGame[], 6条 */ ],
  "table":   [ /* DbGame[], 6条 */ ],
  "generatedAt": "2026-05-31T10:00:00.000Z"
}
```

---

### 3. 投注活动

```
GET /api/v1/slots/betting-activity?tab=latest|week|month
```

**无需登录**，返回实时/周/月排行榜数据。

---

### 4. 供应商列表

```
GET /api/v1/slots/providers
```

**无需登录**，返回 `string[]`，按字母排序。

---

### 5. 用户游戏历史

```
GET /api/v1/slots/history?limit=10
```

**需登录**，最多返回 20 条最近游玩记录。

**响应：**

```jsonc
[
  {
    "uuid": "game-uuid",
    "name": "Sweet Bonanza",
    "provider": "Pragmatic Play",
    "imageUrl": "https://...",
    "imageHqUrl": "https://...",
    "lastPlayedAt": "2026-05-31T15:30:00.000Z"
  }
]
```

---

### 6. 启动真钱游戏

```
POST /api/v1/slots/init
Authorization: 需登录
```

**请求体：**

```jsonc
{
  "gameUuid": "sg-game-uuid",    // 必填
  "device": "mobile",            // 可选，"mobile" | "desktop"，默认 mobile
  "language": "en"               // 可选，影响游戏内 UI 语言，默认取用户 locale
}
```

**响应：**

```jsonc
{ "url": "https://sg-game-server/..." }
```

流程：用户登录 → BFF 生成 sessionId 存 Redis（TTL 24h） → 调 SG `/games/init` → 返回 game URL。

---

### 7. 启动试玩（Demo）

```
POST /api/v1/slots/demo
```

**无需登录**，参数同上（不需要 player_id / session_id）。

---

### 8. 同步游戏库

```
POST /api/v1/slots/sync
Authorization: 需登录
```

从 SG 全量拉取游戏数据写入 `sg_games` 表，同时清理 `" Mobile"` 后缀，并去重 PC/Mobile 同名游戏。

---

## 二、SG 回调接口（SG 服务器 → 本系统）

### 接入点

```
POST /api/v1/sg/callback
```

BFF-Node 只做签名验证，通过后转发到 Core-Node：

```
POST http://core-node:4000/internal/sg/callback
Header: X-Internal-Token: <INTERNAL_TOKEN>
```

### 支持的 action

| action | 方向 | 说明 |
|--------|------|------|
| `balance` | SG → 系统 | 查询玩家余额 |
| `bet` | SG → 系统 | 扣减余额（投注） |
| `win` | SG → 系统 | 增加余额（派彩） |
| `refund` | SG → 系统 | 增加余额（退款） |
| `rollback` | SG → 系统 | 按 round_id 退回本局所有投注 |

### 请求体

```jsonc
{
  "action": "bet",
  "player_id": "user-123",
  "transaction_id": "TXN_xxx",   // 幂等 key，24h 内重复请求返回缓存响应
  "amount": "10.50",
  "round_id": "ROUND_xxx",
  "game_uuid": "game-uuid",
  "currency": "EUR"
}
```

### 成功响应

```jsonc
{ "balance": 89.50, "transaction_id": "SG_1748694000_abc123" }
```

`rollback` 额外返回：

```jsonc
{
  "balance": 100.00,
  "transaction_id": "SG_...",
  "rollback_transactions": [{ "provider_txn_id": "TXN_xxx" }]
}
```

### 错误响应

```jsonc
{
  "error_code": "INSUFFICIENT_FUNDS",   // PLAYER_NOT_FOUND | INSUFFICIENT_FUNDS | INTERNAL_ERROR | UNKNOWN_ACTION
  "error_description": "Insufficient balance"
}
```

> 注意：SG 协议要求所有回调 HTTP 状态码均返回 200，错误通过 `error_code` 字段区分。

---

## 三、向 SG 发出的请求（bff-node → SG API）

### 3.1 获取游戏列表

```
GET {SG_BASE_URL}/games?page=1&per-page=50&expand=tags,parameters,images
```

分页拉取全量游戏，写入本地 `sg_games` 表（ON DUPLICATE KEY UPDATE）。

**SgGame 数据结构：**

```typescript
{
  uuid: string
  name: string           // 英文名
  type?: string
  image: string          // 标准图片 URL
  provider: string
  provider_id?: number | string
  technology?: string    // "html5" 等
  category?: string
  sub_category?: string
  has_demo?: 0 | 1
  has_lobby: 0 | 1
  is_mobile: 0 | 1
  has_freespins?: 0 | 1
  has_tables?: 0 | 1
  label?: string
  tags?: Array<{ code: string; label: string } | string>
  parameters?: {
    rtp?: number | null
    volatility?: string | null
    reels_count?: string | null
    lines_count?: number | null
  }
  images?: Array<{ name: string; file: string; url: string; type: string }>
  // images[].type === "high-quality" 时取为 image_hq_url
}
```

---

### 3.2 启动游戏

```
POST {SG_BASE_URL}/games/init
```

```typescript
{
  game_uuid: string
  player_id: string      // 即用户 ID（userId）
  player_name: string
  currency: string       // SG_CURRENCY，测试为 "EUR"
  session_id: string     // UUID，存 Redis sg:session:{id}，TTL 24h
  return_url: string     // SG_RETURN_URL
  language: string       // "en" / "zh" 等，影响游戏内 UI
  device: "mobile" | "desktop"
}
```

响应：`{ url: string }`

---

### 3.3 启动试玩

```
POST {SG_BASE_URL}/games/init-demo
```

参数同上，无 `player_id` / `player_name` / `session_id`。

---

### 3.4 交易报告（对账用）

```
POST {SG_BASE_URL}/report/transactions
```

由后台对账服务（`sg-settlement.service.ts`）调用，拉取指定日期的交易汇总与本地 `bg_bet_order` 核对，结果写入 `sg_settlement_report`。

---

## 四、数据库表

| 表名 | 说明 |
|------|------|
| `sg_games` | SG 游戏库（uuid, name, provider, weight, is_featured, sort_category 等） |
| `bg_bet_order` | 投注记录（aggregator_id='slotegrator'） |
| `bg_wallet` | 玩家钱包（available 余额） |
| `bg_wallet_ledger` | 钱包流水（bet / win / adjust） |
| `bg_idempotency` | 幂等缓存（scope='sg_callback'，TTL 24h） |
| `sg_settlement_report` | 日对账报告（sg_ggr / local_bet 等） |

---

## 五、游戏权重说明

`sg_games.weight` 由以下字段加权计算（最大 100）：

- `weight`：供应商基础分
- `ph_bonus`：菲律宾市场加分（首页 popular 区优先按此排序）
- `is_featured`：精选标记，参与排序时乘 1.5 系数

---

## 六、注意事项

1. **货币**：测试环境 SG 仅支持 EUR，`exchange_rate` 固定 1（不换算），生产需配置 `EUR_TO_PHP_RATE`。
2. **回调幂等**：同一 `transaction_id` 在 24h 内重复回调返回缓存响应，不重复写账。
3. **PC/Mobile 去重**：同名游戏存在 PC 和 Mobile 版时，优先保留 Mobile，列表层自动过滤 PC 版。
4. **游戏名称**：SG 仅提供英文名，目前无多语言支持。
