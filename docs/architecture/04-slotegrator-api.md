# Slotegrator (SG) 游戏接口文档

> 基于官方文档 GIS-API_Slotegrator v1.4.4（2026-02-26）

## 概述

Slotegrator 是游戏聚合供应商，提供老虎机、Live Casino、捕鱼、Crash 等多品类游戏。

**职责划分：**
- **bff-node**：游戏列表、启动真玩/试玩、同步游戏库（调用 SG 出站 API）
- **core-node**：SG 钱包回调（验签 + 余额扣减/派彩/退款），Nginx 直连 `core-node:4000`

**重要提示：** 接入完成后需向 SG 提供生产服务器 IP，否则 API 可能不可用。

---

## Changelog（版本历史）

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2016-09-01 | 文档初始化 |
| 1.0.1 | 2016-09-07 | 指定 games/init POST 请求格式 |
| 1.0.2 | 2016-09-15 | 增加 limits 和 self-validate 端点 |
| 1.0.3 | 2016-09-23 | 指定重复请求的响应状态 |
| 1.0.4 | 2016-10-20 | games 增加 `is_mobile` 参数 |
| 1.0.5 | 2016-11-15 | Demo 模式 |
| 1.0.6 | 2017-02-17 | 更新 /limits 响应 |
| 1.0.7 | 2017-03-21 | 增加 /jackpots 端点 |
| 1.0.8 | 2017-03-30 | bet/win/refund 请求增加 `game_uuid` 和 `player_id` |
| 1.1.0 | 2018-02-22 | 增加 freespins |
| 1.1.1 | 2019-07-04 | 增加 balance notifications |
| 1.1.2 | 2020-08-25 | 参数 `is_finished` 改为 `finished` |
| 1.1.3 | 2020-10-06 | Rollback：`round_id` 固定 |
| 1.1.4 | 2020-11-25 | FreeSpins：增加 `total_bets` 属性 |
| 1.2.0 | 2022-10-21 | 更新 /games：增加 expand、bonus/prize_drop/tournament win 参数、refund 参数 |
| 1.2.1 | 2023-01-18 | win 增加可选参数 `promo` |
| 1.2.2 | 2023-01-30 | /games 增加 related_games expansion；补充 rate limit 与缓存说明 |
| 1.2.3 | 2023-03-30 | 补充 XSign 计算变量说明 |
| 1.3.0 | 2024-04-29 | 增加 freevouchers |
| 1.3.1 | 2024-05-09 | win 增加可选参数 `prize_drop` 和 `tournament` |
| 1.3.2 | 2024-07-29 | 修复 promo 活动的 win types |
| 1.4.0 | 2024-08-23 | /games/init 和 /games/init-demo 增加 `device` 参数 |
| 1.4.1 | 2024-11-21 | 增加 subsessions 说明（游戏内跳转其他游戏场景） |
| 1.4.2 | 2025-03-11 | BarbaraBang 增加 `loyalty_win` win type；seamless transactions 增加 `transaction_datetime`、`casino_request_retry_count` |
| 1.4.3 | 2025-07-14 | /games 增加整数字段 `provider_id` |
| 1.4.4 | 2026-02-26 | /games 增加 filter[] expansion |

---

## 环境变量

| 变量 | 服务 | 说明 |
|------|------|------|
| `SG_BASE_URL` | bff-node | SG API 基础地址 |
| `SG_MERCHANT_ID` | bff-node / core-node | 商户 ID |
| `SG_MERCHANT_KEY` | bff-node（出站签名）/ core-node（回调验签）| HMAC-SHA1 签名密钥 |
| `SG_CURRENCY` | core-node | 回调结算货币（测试环境固定 `EUR`，生产多货币时按合约配置） |
| `SG_RETURN_URL` | bff-node | 玩家退出游戏后跳转地址 |
| `CORE_NODE_URL` | bff-node | Core-Node 地址 |
| `INTERNAL_TOKEN` | bff-node / core-node | BFF → core-node 内部接口鉴权 |

---

## 签名机制（X-Sign）

所有出站请求（bff-node）与入站回调验签（core-node）均使用 HMAC-SHA1。

**算法：**
1. 合并请求参数 + 认证头（`X-Merchant-Id`、`X-Timestamp`、`X-Nonce`）
2. 按 key 升序字典序排序
3. 用 `http_build_query` 风格拼成 URL-encoded 字符串
4. 用 `SG_MERCHANT_KEY` 做 `sha1 hmac`，取 hex 值

**请求 Headers：**

```
X-Merchant-Id: <SG_MERCHANT_ID>
X-Timestamp:   <Unix 秒，与当前时间差超过 30s 视为过期>
X-Nonce:       <随机字符串>
X-Sign:        <HMAC-SHA1 hex>
Content-Type:  application/x-www-form-urlencoded  (POST 时)
```

**PHP 示例：**
```php
$mergedParams = array_merge($requestParams, $headers);
ksort($mergedParams);
$hashString = http_build_query($mergedParams);
$XSign = hash_hmac('sha1', $hashString, $merchantKey);
```

---

## HTTP 状态码

| Code | 含义 |
|------|------|
| 200 | 成功 |
| 201 | 资源创建成功（Location header 指向新资源） |
| 204 | 成功，无响应体 |
| 304 | 未修改，可使用缓存 |
| 400 | 错误请求（无效 JSON、无效参数等） |
| 401 | 认证失败 |
| 403 | 无权访问该端点 |
| 404 | 资源不存在 |
| 405 | 方法不允许 |
| 415 | 不支持的媒体类型 |
| 422 | 数据验证失败 |
| 429 | 请求过多（超出 rate limit） |
| 430 | 内部服务器错误 |

**通用错误响应体：**
```json
{
  "name": "Not Found Exception",
  "message": "The requested resource was not found.",
  "code": 0,
  "status": 404
}
```

---

## 分页

分页元数据通过 HTTP headers 返回：

| Header | 说明 |
|--------|------|
| `X-Pagination-Total-Count` | 资源总数 |
| `X-Pagination-Page-Count` | 总页数 |
| `X-Pagination-Current-Page` | 当前页（1-based） |
| `X-Pagination-Per-Page` | 每页数量 |
| `Link` | 导航链接（self/next/last） |

也可通过响应体中的 `_links` 和 `_meta` 获取（Collections enveloping）。

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
| `sortCategory` | string | 按 sort_category 过滤（`slots`/`live`/`fishing`/`crash`/`table`/`bingo`/`pinoy`） |
| `sortBy` | `weight`/`ph_bonus`/`name` | 排序字段，默认 `weight` |
| `themes` | string | 逗号分隔，按主题过滤 |
| `gameStyles` | string | 逗号分隔，按游戏风格过滤 |
| `playerTypes` | string | 逗号分隔，按玩家类型过滤 |

**响应：**
```jsonc
{
  "items": [
    {
      "uuid": "game-uuid",
      "name": "Dragon Tiger",
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

> **游戏名多语言：不支持。** SG 只返回英文 `name`，`language` 参数仅影响游戏内 UI 语言。

---

### 2-8. 其余前端接口

（`/slots/homepage`、`/slots/betting-activity`、`/slots/providers`、`/slots/history`、`/slots/init`、`/slots/demo`、`/slots/sync` 见原有文档，无变化）

---

## 二、SG 向外发出的请求（SG → 本系统回调）

### 接入点

```
POST /v1/slotegrator/callback
  → (Nginx) proxy_pass http://127.0.0.1:4000/api/v1/sg/callback
```

core-node `SgCallbackService` 完成 HMAC 验签与业务处理，**不经 bff-node 转发**。

**通用说明：**
- 所有回调 HTTP 响应状态码均返回 `200`，错误通过 `error_code` 字段区分
- SG 最多等待 **3 秒**响应，超时后会重试（最多 33 次）
- 重试时 `casino_request_retry_count` 递增；首次 bet 始终为 0
- 同一 `transaction_id` 在 24h 内重复回调返回幂等缓存响应

---

### 2.1 balance — 查询玩家余额

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | `"balance"` |
| `player_id` | string | 玩家 ID |
| `currency` | string | **余额货币**（多货币合约时每个货币独立查询） |
| `session_id` | string | 游戏会话 ID（可选，开启 session 选项时传入） |

**响应：**
```json
{ "balance": 57.12 }
```

> **⚠️ 多货币关键点**：生产多货币合约下，SG 按 `currency` 分别查余额。必须返回对应货币的余额，不能混用。

---

### 2.2 bet — 投注（扣款）

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | `"bet"` |
| `amount` | double | 投注金额 |
| `currency` | string | **投注货币** |
| `game_uuid` | string | 游戏 UUID |
| `player_id` | string | 玩家 ID |
| `transaction_id` | string | SG 侧唯一交易 ID（幂等 key） |
| `session_id` | string | 游戏会话 ID |
| `type` | string | `"bet"` / `"tip"` / `"freespin"` |
| `freespin_id` | string | freespin 活动 ID（freespin 时存在） |
| `quantity` | int | 剩余 freespin 轮数（freespin 时存在） |
| `round_id` | string | 当前回合 ID（可选） |
| `finished` | boolean | 回合是否已结束（可选） |
| `transaction_datetime` | string | SG 系统内注册时间戳（含微秒，可选，v1.4.2+） |
| `casino_request_retry_count` | int | 重试次数（bet 始终为 0，可选，v1.4.2+） |

**响应：**
```json
{ "balance": 27.18, "transaction_id": "integrator-side-txn-id" }
```

**请求示例：**
```
action=bet&amount=10.00&currency=USD&transaction_id=abcd12345&session_id=abcd12345&type=bet
```

---

### 2.3 win — 派彩

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | `"win"` |
| `amount` | double | 派彩金额 |
| `currency` | string | **派彩货币** |
| `game_uuid` | string | 游戏 UUID |
| `player_id` | string | 玩家 ID |
| `transaction_id` | string | SG 侧唯一交易 ID |
| `session_id` | string | 游戏会话 ID |
| `type` | string | win 类型（见下表） |
| `round_id` | string | 当前回合 ID（可选） |
| `finished` | boolean | 回合是否已结束（可选） |
| `freespin_id` | string | freespin 活动 ID（可选） |
| `quantity` | int | 剩余 freespin 轮数（可选） |
| `transaction_datetime` | string | SG 注册时间戳（可选，v1.4.2+） |
| `casino_request_retry_count` | int | 重试次数（可选，v1.4.2+） |

**win type 枚举：**

| type | 说明 |
|------|------|
| `win` | 默认派彩 |
| `jackpot` | 累计大奖 |
| `freespin` | 免费旋转 |
| `bonus` | Pragmatic Play 专用 |
| `pragmatic_prize_drop` | Pragmatic Play 专用 |
| `pragmatic_tournament` | Pragmatic Play 专用 |
| `promo` | GameArt、BetGames、AmigoGaming 促销 |
| `prize_drop` | Endorphina、BGaming 奖池 |
| `tournament` | Endorphina 锦标赛 |
| `unaccounted_promo` | Spribe 专用 |
| `loyalty_win` | BarbaraBang 专用（v1.4.2+） |

> **注意：** ELK 供应商的 freespin win 不提供 `round_id`。

**响应：**
```json
{ "balance": 170.21, "transaction_id": "integrator-side-txn-id" }
```

---

### 2.4 refund — 退款

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | `"refund"` |
| `amount` | double | 退款金额 |
| `currency` | string | 退款货币 |
| `game_uuid` | string | 游戏 UUID |
| `player_id` | string | 玩家 ID |
| `transaction_id` | string | SG 侧唯一交易 ID |
| `session_id` | string | 游戏会话 ID |
| `type` | string | `"bet"` / `"tip"` / `"freespin"`（可选） |
| `bet_transaction_id` | string | 对应的 bet 交易 ID（SG 侧） |
| `freespin_id` | string | freespin 活动 ID（可选） |
| `quantity` | int | 剩余 freespin 轮数（可选） |
| `round_id` | string | 回合 ID（可选） |
| `finished` | boolean | 回合是否已结束（可选） |
| `transaction_datetime` | string | SG 注册时间戳（可选） |
| `casino_request_retry_count` | int | 重试次数（可选） |

> 如果对应 bet 不存在，直接记录 refund 并返回成功。

**响应：**
```json
{ "balance": 27.18, "transaction_id": "integrator-side-refund-txn-id" }
```

---

### 2.5 rollback — 整局回滚

> **注意：仅两个供应商启用此功能**

Rollback 是取消整个回合（或不支持 round 的供应商取消部分 session 的操作）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | `"rollback"` |
| `currency` | string | 回滚货币 |
| `game_uuid` | string | 游戏 UUID |
| `player_id` | string | 玩家 ID |
| `transaction_id` | string | SG 侧唯一交易 ID |
| `rollback_transactions` | array | 需要回滚的交易列表 |

> **⚠️ 重要：只能回滚 `rollback_transactions` 列表中的交易。** 不要根据 `provider_round_id` 做额外联动回滚，否则会导致数据不同步。

**响应：**
```json
{
  "balance": 100.00,
  "transaction_id": "SG_...",
  "rollback_transactions": [{ "provider_txn_id": "TXN_xxx" }]
}
```

---

### 错误响应（回调）

```json
{
  "error_code": "INSUFFICIENT_FUNDS",
  "error_description": "Not enough money to continue playing"
}
```

| error_code | 适用场景 |
|------------|----------|
| `INSUFFICIENT_FUNDS` | `bet` 时余额不足 |
| `INTERNAL_ERROR` | 所有其他错误（玩家不存在、数据库错误等） |

---

## 三、本系统向 SG 发出的请求（bff-node → SG API）

### 3.1 获取游戏列表

```
GET {SG_BASE_URL}/games?page=1&per-page=50&expand=tags,parameters,images,related_games
```

> **注意：**
> - 生产环境每页最多 50 条，`per-page=0` 无效
> - Rate limit：生产 100 req/s，staging/demo 1 req/s
> - 游戏图片 URL 禁止在前端直接暴露（必须缓存到本地或 CDN）

**Request fields：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `expand` | string，可选 | 附加展开字段，逗号分隔：`tags`、`parameters`、`images`、`related_games`、`filter[]` |

**Game item fields：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `uuid` | string | 游戏 UUID（用于 `/init` 和 `/lobby`） |
| `name` | string | 游戏名称 |
| `image` | string | 游戏图片 URL |
| `type` | string | 游戏类型 |
| `provider` | string | 供应商名称 |
| `provider_id` | integer | 供应商 ID（v1.4.3+） |
| `technology` | string | 技术类型（`html5`/`flash`） |
| `has_lobby` | integer | 是否有 lobby（1/0） |
| `is_mobile` | integer | 是否适配移动端（1/0），移动端需在新窗口打开 |
| `has_freespins` | integer | 是否支持 freespins（1/0） |
| `has_tables` | integer | 是否有游戏桌（1/0） |
| `freespin_valid_until_full_day` | integer | freespin 有效期截止到当日 00:00（1/0） |
| `label` | string | 子供应商标签 |

**Available expansions：**

| expansion | 说明 |
|-----------|------|
| `tags` | 标签对象列表（code + label） |
| `parameters` | 附加参数（rtp、volatility、reels_count、lines_count） |
| `images` | 图片对象列表（含 high-quality 类型） |
| `related_games` | 相关游戏列表（uuid + is_mobile） |
| `filter[provider]` | 按供应商过滤 |
| `filter[is_mobile]` | 按移动端版本过滤 |
| `filter[has_freespins]` | 按是否有 freespins 过滤 |

---

### 3.2 Game Tags

```
GET {SG_BASE_URL}/game-tags?expand=category
```

返回游戏标签集合（code + label + category）。

---

### 3.3 Lobby（有 lobby 的游戏）

```
GET {SG_BASE_URL}/games/lobby?game_uuid=abc123&currency=USD
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `game_uuid` | string，必填 | 游戏 UUID |
| `currency` | string，必填 | 玩家使用的货币 |
| `technology` | string，可选 | `html5` 或 `flash` |

**响应 lobby 字段：**

| 字段 | 说明 |
|------|------|
| `lobbyData` | 用于 `/games/init` 的 `lobby_data` 参数 |
| `name` | 桌台名 |
| `isOpen` | 是否营业中 |
| `openTime` / `closeTime` | 营业时间 |
| `dealerName` / `dealerAvatar` | 荷官信息 |
| `technology` | 技术类型 |
| `limits` | 下注限额（包含 `currency`、`min`、`max`） |
| `tableId` | 用于 /freevouchers/set 请求 |

---

### 3.4 启动真钱游戏

```
POST {SG_BASE_URL}/games/init
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `game_uuid` | string，必填 | 游戏 UUID |
| `player_id` | string，必填 | 玩家 ID |
| `player_name` | string，必填 | 玩家昵称（部分游戏显示） |
| `currency` | string，必填 | **玩家本次游戏使用的货币**（多货币时决定 SG 用哪个合约） |
| `session_id` | string，必填 | 唯一 session ID，存 Redis，TTL 24h |
| `device` | string，可选，默认 `desktop` | `desktop` / `mobile` |
| `return_url` | string，可选 | 游戏结束后跳转地址 |
| `language` | string，可选 | 玩家语言，影响游戏内 UI |
| `email` | string，可选 | 玩家邮箱 |
| `lobby_data` | string，可选 | 有 lobby 的游戏必传，来自 `/games/lobby` 响应 |

**响应：**
```json
{ "url": "https://game-server/endpoint" }
```

> **Subsessions 说明（v1.4.1）：** 部分供应商允许在游戏内跳转到其他游戏（seamless sessions）。此时 `game_uuid` 不同但 `session_id` 相同；或者移动版下注、桌面版派彩，此时 `session_id` 不同但 `round_id` 相同。

---

### 3.5 启动试玩（Demo）

```
POST {SG_BASE_URL}/games/init-demo
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `game_uuid` | string，必填 | 游戏 UUID |
| `device` | string，可选 | `desktop` / `mobile` |
| `return_url` | string，可选 | 跳转地址 |
| `language` | string，可选 | 玩家语言 |

无需 `player_id` / `player_name` / `session_id`。

---

### 3.6 交易报告（对账）

```
POST {SG_BASE_URL}/report/transactions
```

后台对账服务（`sg-settlement.service.ts`）调用，拉取指定日期交易汇总与本地 `bg_bet_order` 核对，结果写入 `sg_settlement_report`。

---

## 四、数据库表

| 表名 | 说明 |
|------|------|
| `sg_games` | SG 游戏库（uuid, name, provider, weight, is_featured, sort_category 等） |
| `bg_bet_order` | 投注记录（aggregator_id='slotegrator'） |
| `bg_wallet` | 玩家钱包（available 余额，**多货币后按 currency 分行**） |
| `bg_wallet_ledger` | 钱包流水（bet / win / adjust，含 currency） |
| `bg_idempotency` | 幂等缓存（scope='sg_callback'，TTL 24h） |
| `sg_settlement_report` | 日对账报告 |
| `bg_turnover_requirements` | 流水要求（含 currency 字段） |
| `bg_turnover_logs` | 投注流水贡献记录（含 currency 字段） |
| `bg_game_turnover_rates` | 各游戏大类贡献率（与货币无关） |

---

## 五、多货币支持（生产环境）

### 核心机制

SG 生产环境为每种货币开独立合约。`currency` 字段存在于所有回调（balance/bet/win/refund/rollback）中，是多货币隔离的关键字段。

**货币映射关系（现有充值通道）：**

| 充值通道 | 货币 | SG 合约货币 |
|----------|------|------------|
| TG Wallet | PHP | PHP |
| GCash / Maya / BDO / BPI | PHP | PHP |
| Matrix USDT | USDT | USDT |
| Matrix TRX | TRX | TRX |
| TON Connect | TON | TON |

### 回调处理要点

1. **balance**：按 `currency` 返回对应货币余额
2. **bet**：从对应货币余额扣款；流水贡献记入同币种要求
3. **win**：向对应货币余额入账
4. **rollback**：按 `rollback_transactions` 列表精准回滚，不扩展到其他交易

### 游戏启动（/games/init）

`currency` 字段决定本次 session 使用哪个 SG 合约。前端需让玩家选择"用哪个余额玩"，传入对应货币。

---

## 六、游戏权重说明

`sg_games.weight` 由以下字段加权计算（最大 100）：

- `weight`：供应商基础分
- `ph_bonus`：菲律宾市场加分（首页 popular 区优先按此排序）
- `is_featured`：精选标记，参与排序时乘 1.5 系数

---

## 七、注意事项

1. **货币**：测试环境 SG 仅支持 EUR；`SG_MULTI_CURRENCY=false` 时 SG 侧固定 EUR，但回调读写用户进游戏时选择的钱包币种（如 PHP 100 → 游戏内显示 100 EUR，扣款仍从 PHP 钱包 1:1）。生产多货币合约开启 `SG_MULTI_CURRENCY=true` 后，每种货币独立结算。
2. **回调幂等**：同一 `transaction_id` 24h 内重复回调返回缓存响应，不重复写账。
3. **PC/Mobile 去重**：同名游戏存在 PC/Mobile 两版时，优先保留 Mobile，列表层自动过滤 PC 版。
4. **游戏名称**：SG 仅提供英文名，无多语言支持。
5. **图片 URL**：严禁前端直接使用 SG 图片 URL，必须代理或缓存。
6. **3 秒超时**：所有回调必须在 3 秒内响应，否则 SG 触发重试，最多 33 次。
7. **Rollback 范围**：只处理 `rollback_transactions` 列表内的交易，不要基于 `round_id` 联动回滚。
