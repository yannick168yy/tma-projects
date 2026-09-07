# WXGame 聚合商接入方案（第二家）

**状态**：方案待确认，未开工
**依据**：`WX_GAME_Solution_v060708`（21 页）+ 官方游戏清单表（25 厂商 / 2386 款）+ 现有 568win 实现
**前置文档**：`06-aggregator-integration.md`（第二家要实现的能力清单，本文逐项兑现）

---

## 0. 一句话

WXGame 是**无缝钱包（seamless）+ 玩家级点控 RTP** 的私服型聚合商，与 568win 的
**转账钱包（transfer wallet）** 模型不同。两家并存，共用注单/钱包/佣金口径，
各自独立的原始流水表与协议适配层。

---

## 1. 两家的模型差异（决定抽象抽在哪一层）

| 维度 | 568win | WXGame |
|---|---|---|
| 钱包模型 | 转账制：开号 + 转入转出 | **无缝**：每笔下注实时回调扣款 |
| 玩家账号 | 我方生成 username，上游开号 | 我方生成 playerId，**上游不开号**，靠 `/verify` 现场认领 |
| 起游戏 | 我方调上游拿 URL（带账号） | 我方**签发临时 token** → 上游回调 `/verify` 换玩家 |
| 幂等键 | `transfer_code` + 可选 `transaction_id` | 单一 `transactionId`（全局唯一） |
| 局关联 | `GameRoundId` | `roundId` + 可选 `betTransactionId` |
| 作废 | `Cancel` / `Rollback` 两个动作 | 只有 `/refund` 一个 |
| 密钥 | CompanyKey，定期轮换 | AccessKeyId/Secret **静态，无轮换** |
| 对账 | `GetBetStatus` + 报表拉取 cron | **没有任何对账接口** ⚠️ |
| 点控 RTP | 无 | **有**，玩家级 10 档 |
| 币种 | 多币种（140 迁移） | 单币种开户，支持 PHP ✅ |

**结论：不做统一 provider 接口。** 差异面（钱包模型、开号方式、作废语义、对账能力）
恰好是最不该被抽象焊死的地方。改为：

- **共用**：`bg_bet_order` / `bg_bet_round` / `bg_aggregator_player` / 钱包扣加 SQL / 佣金洗码口径
- **各自**：原始流水表、签名、路由、字段映射、目录同步

抽的是**钱包记账动作**（`applyBet` / `applyWin` / `applyRefund`），不是 provider 接口。

---

## 2. 标识与命名

```
aggregator_id = 'wxgame'
game_uuid     = 'wxgame:<gameBrand>:<gameId>'
原始流水表     = bg_wxgame_wallet_txn
游戏目录表     = bg_wxgame_game
点控表        = bg_wxgame_player_rtp
```

### 🔴 gameId 不能直接 split(':')
官方清单里 **66 个 gameId 含特殊字符**，其中包含**冒号**：

```
DivineQueen:HeartOfIce     ← 冒号，会打断 uuid 解析
WuKong&Peaches             ← &，进 URL query 要 encode
Moven'Jump / Dragon'sTreasure  ← 单引号
Silver&GoldMine / Mr.Rich / GaneshaJr.
EvilGoblinsxBomb®          ← 注册商标符号（非 ASCII）
DeadwoodR.I.P
```

`sg-game.service.ts` 现有 `568win:<gpid>:<gameId>` 是纯数字，`split(':')` 安全。
WXGame **必须**用限定次数分割：

```ts
// wxgame:<brand>:<gameId>  —— gameId 自身可能含 ':'，只切前两段
const i = uuid.indexOf(':'), j = uuid.indexOf(':', i + 1)
const brand = uuid.slice(i + 1, j), gameId = uuid.slice(j + 1)
```

前端 URL 传参一律 `encodeURIComponent`。

### gameBrand 大小写要对齐
清单表里三处写法不一致：sheet 名（`PG` / `CQ9`）、supplier 表（`pg` / `cq9`）、
icon 路径（`/assets/PG/` / `/assets/CQ9/`）。API 示例用小写 `"gameBrand": "jili"`。
**以 supplier 表小写为准**，入库前统一 `toLowerCase()`，并跟对方书面确认。

### playerId 生成（与 568win 规则不同）
API 明确：**playerId 只支持数字和字母，不能有特殊字符**。
568win 现有 `toWin568Username()` 保留下划线（`/^[A-Za-z0-9_]{6,40}$/`），WXGame 不能用。

```ts
// 去掉下划线会让 a_b 与 ab 撞车 —— 必须查重，撞了追加短哈希后缀
function toWxgamePlayerId(userId: string) {
  return userId.replace(/[^A-Za-z0-9]/g, '')
}
```
映射落 `bg_aggregator_player`（该表已有 `aggregator_id` 复合唯一键，直接复用，无需改表）。
写入前查 `uk_aggregator_username`，冲突则追加 `userId` 的 4 位 hash。

---

## 3. 起游戏流程（token 签发是新增环节）

```
玩家点游戏
  → bff /slots/init 判断 uuid 前缀是 wxgame
  → core-node 签发一次性 token，写 Redis：
       wxgame:launch:<token> = {userId, playerId, gameUuid, currency, tenantCode}  TTL 300s
  → core-node 调上游 POST /v1/api/get_game_url
       { token, gameId, gameBrand, language }
  → 上游回调我方 POST /wxgame/verify { token, gameId }
       我方消费 token（读后删，只能用一次）→ 返回 { playerId, balance, currency, rtp? }
  → 上游返回游戏 URL → 前端跳转
```

**要点**
- token 由**我们**定义格式，用 `randomUUID()` 即可，不要塞可推断信息
- verify 里 token 读后即删；重放返 `1006 Invalid player token`，过期返 `1007`
- verify 响应可直接带 `rtp`，省掉一次 `set_player_rtp`（见 §6）
- 上游维护中的游戏（清单里 **133 款标"维护中"**）在 `/slots/init` 就拦掉，别让玩家白屏

---

## 4. 钱包回调（最贵的一块）

### 路由挂载
比照 `win568WalletRoutes` 在 `routes/index.ts` 的双注册（根 + `/t/:tenantCode`）：

```ts
await app.register(wxgameWalletRoutes, { prefix: '/wxgame' })
await app.register(wxgameWalletRoutes, { prefix: '/t/:tenantCode/wxgame' })
```

给对方的 `OperatoinApiDomain`：
- 自营站 `https://<core域名>/wxgame`
- 包网租户 `https://<core域名>/t/<tenantCode>/wxgame`

五个端点：`/verify` `/balance` `/bet` `/win` `/refund`

### 幂等
`transactionId` 全局唯一（文档示例 bet `...0000` / win `...0001` / refund `...0003`），
直接作为 `provider_txn_id`，落 `bg_bet_order` 现有唯一键 `uk_provider_txn(aggregator_id, provider_txn_id)`。
捕获 duplicate key → 返 `1018 Transaction Already Exists` + 当前余额。

**不需要**像 568win 那样拼复合键，也不需要 `cancel:` 前缀。

### 响应格式
统一 `{ code, data:{balance, currency}, msg, requestId }`。
注意 568win 那套 `stringify()` 金额定点化（`toFixed(2)`）是 568win 的私有要求，
**WXGame 用标准 `JSON.stringify` 即可**，不要复用。

### 各动作要返的错误码
| 端点 | 必须实现 |
|---|---|
| `/verify` | `1006` 无效令牌、`1007` 令牌过期、`1012` 玩家不存在 |
| `/bet` | `1011` **余额不足**、`1018` 重复交易 |
| `/win` | `1018` 重复交易 |
| `/refund` | `1014` 交易不存在、`1018` 重复交易 |
| 全部 | `1004` 签名错、`1005` 参数错、`1019` 无效 IP、`1001` 内部错 |

### 落库
```
bg_wxgame_wallet_txn   上游原始报文（字段形状跟着上游走，不塞进 bg_568win_*）
bg_bet_order           本地账变（bet/win/refund 三种 bet_type，无 cancel）
bg_bet_round           每局预聚合（事务内按 round_id 重算，与 568win 同逻辑）
```

`bg_bet_round.aggregator_id` 已有该列，默认值 `'568win'`，**新写入必须显式传 `'wxgame'`**。
`bets.routes.ts` / 后台报表里按 `aggregator_id` JOIN 到对应流水表取游戏名。

---

## 5. 鉴权

### 我方 → 上游
```
Header: AccessKeyId / Sign / Nonce / Timestamp
Sign = Hex(SHA256(AccessKeySecret + Nonce + Timestamp))
```

### 🔴 上游 → 我方：签名不覆盖 body
这条规则**不含请求体、不含路径、不含 HTTP 方法**。同一组 `Nonce+Timestamp` 算出的
`Sign` 在 60 秒内可以配任意 body 复用。仅验 `Sign` 等于不验。

**我方接收侧必须叠加**：
1. `Timestamp` 60 秒窗口校验（文档已定）
2. **`Nonce` Redis 去重**，key `wxgame:nonce:<nonce>`，TTL 120s，重复直接拒
3. **IP 白名单**（错误码有 `1019 Invalid IP`，说明对方也这么做）
4. 业务幂等兜底（`uk_provider_txn`）——即使前三层被绕过，钱也不会重复扣

密钥存 `bg_admin_settings`（比照 `win568-key-settings.service.ts`），
租户化后由 `pf_tenant_provider` 下发。**无轮换机制**，`06` 文档要求的轮换接口留空实现。

---

## 6. 点控 RTP（新增业务能力，568win 没有）

```
POST /v1/api/set_player_rtp  { playerIds: [...], rtp: "95" }  → 成功设置的 playerIds
POST /v1/api/get_player_rtp  { playerIds: [...] }             → [{playerId, rtp}]
```

档位：`50 / 65 / 75 / 85 / 90 / 95 / 97 / 100 / 150 / 500`
（按开户权限可能只给 `50–97` 或 `50–500`，**签约时要确认拿的是哪档**）

### ⚠️ 点控只覆盖 34% 的游戏
supplier 表的"是否支持高爆"列：

| 状态 | 厂商 | 游戏数 |
|---|---|---|
| **支持** | pg / jili / spribe / inout / yono / tada / jdb / fachai / 3oaks / popok / bg | 733 |
| 部分支持 | pragmatic / jili-fish | — |
| **更新中（尚不支持）** | cq9 / dreamtech / evoplay / habanero / booongo / hacksaw / ka / nolimitcity / playson / popiplay / rubyplay / wg | ~1550 |

表内合计支持数 **786 / 2338**。后台点控页要标出哪些游戏不受控，避免运营误判。

### 实现
- 新表 `bg_wxgame_player_rtp(user_id, rtp, operator_id, reason, updated_at)`
- 后台页面：单个/批量设置，记录操作人与原因（**这是资损敏感操作，必须有审计**）
- 建议接 `op_password` 校验（比照余额调整 `POST /admin/users/:id/adjust-balance`）
- `set_player_rtp` 只返回**成功**的 playerIds → 必须比对入参差集，失败的要落日志告警
- 优化：`/verify` 响应可直接带 `rtp`，起游戏时下发，省一次调用

---

## 7. 游戏目录同步

```
POST /v1/api/get_game_list { gameBrand?, gameType? }
→ [{ gameId, gameName, gameFullName, gameType, gameBrand }]
```

接口只有 5 个字段：**没有 RTP、没有最小/最大投注、没有多语言名、没有维护状态、没有图**。
所有富化信息只能来自官方清单表格 + 我们自己抓。

### 表结构 `bg_wxgame_game`
```sql
game_brand   VARCHAR(32)  NOT NULL
game_id      VARCHAR(128) NOT NULL   -- 非纯数字，含特殊字符
name_en      VARCHAR(255)
name_full    VARCHAR(255)
game_type    VARCHAR(32)             -- slot / table / fish / poker
icon_url     VARCHAR(512)            -- 上游原始 URL
icon_local   VARCHAR(512)            -- 我方 OSS 落地后的 URL
is_maintain  TINYINT(1)
is_enabled   TINYINT(1)
supports_rtp TINYINT(1)              -- 是否支持点控（来自 supplier 表）
raw_game     JSON
PRIMARY KEY (game_brand, game_id)    -- 🔴 必须复合主键
```

**复合主键是硬要求**：清单里 TADA 表和 JILI 表的 gameId 都从 `2` 开始，
单靠 gameId 会互相覆盖（同 `098_568win_game_composite_key.sql` 踩过的坑）。

### 🔴 TADA 的 icon 全部指向 jili 目录
TADA 104 款游戏的 icon 都是 `https://file.wxgame99.com/assets/jili/<id>.png`，
且 gameId 与 JILI 表大量重叠。要么表格填错，要么 TADA 是 jili 的马甲厂牌。
**接入前必须问清楚**，否则 TADA 的图会全部错配。

### 图片必须落地到自己的 OSS
2386 款的图源分布：

| 图源 | 数量 | 风险 |
|---|---|---|
| `file.wxgame99.com`（上游自建 CDN） | 1984 | 可控 |
| `rb.thefanz.net` / `static-r2-bng.thefanz.net` | 237 | 第三方 |
| `common.ibcsfaqcha.net` | 52 | 第三方 |
| `nolimitcity.com` | 44 | **厂商官网直链**，随时防盗链 |
| `rmpiconcdn.kaga88.com`（动态生成接口） | 43 | **接口非静态图** |
| `www.popiplay.com` / `playson.com` / 其他 | 21 | 厂商官网直链 |
| 空 | 5 | 需人工补 |

**约 400 张外链第三方站点**，包括厂商官网直链和动态生成接口。这些必须一次性抓回
自己 OSS，不能直接在前端引用（防盗链 + 跨境加载慢 + 随时 404）。
可复用现有 `game-icon-probe.service.ts` 与 `cover_candidate` 那套。

### 目录规模
| 类型 | 数量 |
|---|---|
| slot | 2303 |
| table | 70 |
| fish | 10 |
| poker | 3 |
| **合计** | **2386**（其中 **133 款维护中**） |

厂商 25 家。**测试服只开放 4 家**（pg / jili / spribe / inout），正式服全开。
所以联调阶段只能验 pg/jili/spribe/inout。

---

## 8. 币种与语言

- **PHP 在支持列表内**（152 种币种），直接用 PHP 开户，**避免汇率换算**。
  `bg_bet_order.original_amount` / `exchange_rate` 保持 NULL。
- 币种字段在 bet/win/refund 里是**可选**的，"以商户开户币种为准" → 我方以本地钱包币种为准，
  收到的 `currency` 只做校验不做换算，不一致直接返 `1015 Invalid currency code`。
- 语言只有 7 种：`en / es / id / pt / ru / th / vi`（部分厂商多一个 `hi`）。
  **没有中文**。`language` 参数按用户 locale 映射，映射不到默认 `en`。

---

## 9. 🔴 签约前必须跟对方确认的 6 件事

| # | 事项 | 不解决的后果 |
|---|---|---|
| 1 | **`win = 0` 必须开启回调** | 文档写明"未中奖默认不回调"。不开的话输的局只有 `/bet` 没有 `/win`，`bg_bet_round` 永远挂着未结算局，注单页、报表、洗码、负盈利返水、团队佣金**全线口径错** |
| 2 | **要一个对账接口或 T+1 对账文件** | 9 个接口里没有任何交易查询/报表能力。掉单（超时、重启）后**无手段与对方核对**，只能认我方的账 → 资损无法追溯。568win 有 `GetBetStatus` + 报表 cron，这家是零 |
| 3 | **`/refund` 在 `betTransactionId` 缺失时怎么定位原单** | 该字段可选，捕鱼类不传。同一 `roundId` 下捕鱼会有连续多笔 bet，**退错钱** |
| 4 | **回调方向的签名方案** | 文档只写了我方调他们的规则，反方向一字未提。大概率同一套，但必须书面确认 |
| 5 | **RTP 权限档位**（`50–97` 还是 `50–500`） | 能不能开 100 以上放水档，直接决定这家的运营价值 |
| 6 | **TADA 与 jili 的关系** | icon 路径与 gameId 双重重叠，不问清会图片错配 + 主键冲突 |

另需商务提供：生产域名、`AccessKeyId` / `AccessKeySecret`、我方出口 IP 报备、对方回调 IP 段。

---

## 10. 落地拆解

### 迁移文件（当前最大 221，落库前需先确认服务器 `schema_migrations` 实际最大号）
```
222_wxgame_integration.sql    bg_wxgame_wallet_txn + bg_wxgame_player_rtp
223_wxgame_games.sql          bg_wxgame_game（复合主键）
224_wxgame_settings.sql       bg_admin_settings 插入密钥项
```
（`bg_aggregator_player` / `bg_bet_order` / `bg_bet_round` **不需要改表**）

### 代码
```
core-node/src/lib/aggregators.ts          AGGREGATOR_IDS 加 'wxgame'（bff 同步改）
core-node/src/services/wallet-ledger.ts   新建：从 win568-wallet.service 抽出的记账动作
core-node/src/services/wxgame-wallet.service.ts   五个动作
core-node/src/services/wxgame-rtp.service.ts      点控
core-node/src/routes/wxgame-wallet.routes.ts      回调路由（双注册）
core-node/src/clients/wxgame.client.ts            签名 + 4 个上游接口
core-node/src/cron/wxgame-game-sync.cron.ts       目录同步
bff-node/src/routes/slots.routes.ts               按 uuid 前缀分流起游戏
bff-node/src/services/sg-game.service.ts          uuid 解析分流（限定次数分割）
web-admin                                          点控 RTP 页面
```

### 分流点清单
`grep -rn DEFAULT_AGGREGATOR apps --include="*.ts"` 共 **38 处**，分布：

| 文件 | 处数 | 处理 |
|---|:-:|---|
| `core-node/services/win568-wallet.service.ts` | 10 | 保持 568win |
| `core-node/routes/win568-operation.routes.ts` | 6 | 保持 568win |
| `bff-node/services/vip.service.ts` | 5 | **改为跨聚合商聚合** |
| `bff-node/services/admin-store.ts` | 4 | **改为跨聚合商聚合** |
| `bff-node/services/sg-game.service.ts` | 3 | **按前缀分流** |
| `bff-node/services/withdraw-review.service.ts` | 2 | **改为跨聚合商聚合** |
| `bff-node/routes/bets.routes.ts` | 2 | **按 aggregator_id 分流 JOIN** |
| `bff-node/routes/admin/games.routes.ts` | 2 | **按前缀分流** |
| `bff-node/routes/admin/bet-orders.routes.ts` | 2 | **按 aggregator_id 分流 JOIN** |

⚠️ `vip.service` / `admin-store` / `withdraw-review` 这三处是**洗码、负盈利返水、
团队佣金、提现风控**的口径来源。现在写死 `568win` 意味着 WXGame 的注单**不会计入返水和佣金**。
这是接入中最容易漏、漏了最贵的地方。

### 建议顺序
1. 抽 `wallet-ledger.ts`（不改行为，纯重构，跑现有 `win568-wallet.test.ts` 回归）
2. 建表 + 目录同步（先把 2386 款和图灌进来，图落 OSS）
3. token 签发 + `/verify` + `/balance`（不涉及钱）
4. `/bet` `/win` `/refund` + 幂等 + 记账
5. 38 处分流点逐个过，重点是那三个佣金口径文件
6. 点控 RTP 后台
7. **完整回归**：下注 → 派彩 → 退款 → 洗码 → 负盈利返水 → 团队佣金

---

## 11. 接入检查清单（对齐 `06-aggregator-integration.md`）

- [ ] `AGGREGATOR_IDS` 加 `'wxgame'`，bff / core 两份常量同步
- [ ] 38 处 `DEFAULT_AGGREGATOR` 逐处判断
- [ ] 原始流水表独立命名 `bg_wxgame_*`
- [ ] uuid 前缀 `wxgame:` 与**限定次数**解析（gameId 含冒号）
- [ ] 幂等键 = `transactionId`，落 `uk_provider_txn`
- [ ] `bg_bet_round` JOIN 按 `aggregator_id` 分流
- [ ] Nonce 去重 + IP 白名单（签名不覆盖 body）
- [ ] 密钥轮换留空实现（不删接口）
- [ ] 图片 400 张外链落地 OSS
- [ ] 洗码 / 返水 / 佣金三条口径确认含 WXGame 注单
- [ ] 一轮完整回归
