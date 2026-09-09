# WXGame 聚合商接入方案（第二家）

**状态**：核心链路已实现并在阿里云测试环境联调通过（起游戏 / verify / bet / win / refund）
**最近更新**：2026-09-08（已完成真人实玩联调，见 §10）
**分支**：`claude/wxgame-integration`
**依据升级**：对方 2026-09-07 提供了正式文档站 <https://opendoc.wxgame99.com>（账号密码均为 `wxgame`），
内容比最初那份 21 页 PDF 全一倍，**本文以文档站与真实联调结果为准，PDF 已过时**。
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
| 对账 | `GetBetStatus` + 报表拉取 cron | `get_game_history_list`，含 transactionId 与注单状态 |
| 点控 RTP | 无 | **有**，玩家级 10 档 |
| 币种 | 多币种（140 迁移） | 按玩家账号分币种，开放 PHP / IDR，USDT 仍走 568Win |

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

### 图片：接口直接返回，不必靠表格补

`get_game_list` 实测**返回 `gameIcon` 字段**（官方响应字段表里没写），测试环境 288 款里
287 款有图，全部指向 `file.wxgame99.com`。所以早先「上游不返图、只能靠表格补」的判断是错的，
目录同步已改为写入 `icon_url`。

⚠️ **但表格里那批失效外链的风险仍在**：正式环境 25 家厂商全开后，`get_game_list` 是否
对 pragmatic / booongo / evoplay 也返回可用图，测试环境验不了（只开 4 家）。
2026-09-07 对表格图源的实测结果留档如下，正式环境接入时要复测：

| 图源 | 数量 | 实测 |
|---|---:|---|
| `file.wxgame99.com` | 1392 | ✅ 200 |
| `prgassets.bd88fgabh.com`（pragmatic 全部） | 567 | 🔴 DNS 无解析 |
| `static-r2-bng.thefanz.net`（booongo 全部） | 118 | 🔴 HTTP 500 |
| `common.ibcsfaqcha.net`（evoplay 全部） | 52 | 🔴 DNS 无解析 |
| `playson.com` | 3 | 🔴 403 防盗链 |

`icon_local` 列留给我方抓回 OSS 后的地址，目录同步**不覆盖**它
（用 `VALUES(icon_local)` 会把抓好的刷成 NULL）。抽样 8 张体积 7 KB – 1.4 MB，
中位数约 150 KB，前台上线前要转 WebP 压缩。

### 两份表的数量对不上
| | 游戏清单表 | 图标表 |
|---|---:|---:|
| 总数 | 2386 | 2341 |
| jili | 114 | 109 |
| rubyplay | 102 | 85 |
| hacksaw | 146 | 147 |
| popiplay | 13 | 14 |
| pragmatic 图源 | `file.wxgame99.com` | `prgassets.bd88fgabh.com`（已死） |

两份表版本不一致。**以 `get_game_list` 接口返回的为准**，表格只用来补图和中文名，
入库时对不上的要落日志而不是静默丢弃。

### 目录规模
| 类型 | 游戏清单表 | 图标表 | **接口实测（测试环境 4 家）** |
|---|---:|---:|---:|
| slot | 2303 | 2287 | 243 |
| table | 70 | 47 | 45 |
| fish | 10 | 5 | 0 |
| poker | 3 | 2 | 0 |
| **合计** | **2386** | **2341** | **288**（全部 ENABLE） |

测试环境只开 pg 135 / jili 108 / inout 35 / spribe 10，已全部入库。

厂商 25 家。**测试服只开放 4 家**（pg / jili / spribe / inout），正式服全开。
所以联调阶段只能验 pg/jili/spribe/inout。

---

## 8. 币种与语言

- WXGame 开放 **PHP / IDR**，同一本地用户按币种使用不同的上游 `playerId`，避免 PHP 与 IDR 账号串用。
- PHP / IDR 都按本地钱包原币记账，不做汇率换算。WXGame IDR 不复用 568Win 报表的千卢比单位换算。
  `bg_bet_order.original_amount` 保留原额，`exchange_rate` 为 1。
- WXGame 不开放 USDT；统一游戏路由按币种分开配置，USDT 继续使用 568Win。
- 币种字段在 bet/win/refund 里是**可选**的，"以商户开户币种为准" → 我方以本地钱包币种为准，
  收到的 `currency` 只做校验不做换算，不一致直接返 `1015 Invalid currency code`。
- 语言只有 7 种：`en / es / id / pt / ru / th / vi`（部分厂商多一个 `hi`）。
  **没有中文**。`language` 参数按用户 locale 映射，映射不到默认 `en`。

---

## 9. 与对方确认事项（截至 2026-09-08）

### 🔴 已被官方文档推翻的两条

**1. win = 0 回调「已解决」是错的。**
对方后台确实有「派奖为0是否回调」开关并已为我方打开，但官方文档
`single-wallet/callbacks/win` 原文：

> 由于生产实际运营过程中，存在大量 win=0 的情况，**并非所有游戏厂商都支持 win=0 的回调**
>（比如：yono 未中奖时，不支持 win=0 的派奖回调），**建议商户不要依赖 win=0 作为结算逻辑**。

开关不保证覆盖所有厂商。**闭合一局要靠三条线兜**：
`/win` 的 `isEnd` 字段 → `win=0` 回调 → 对账接口的 `status`。
其中 `isEnd` 只有 jili / pg / pp / fc / bg / 3aoks / popok 支持，其余"陆续完善"。

👉 实现上已回避这个问题：注单直接落 `settled`，不依赖任何"结算信号"。

**2. 「没有对账接口、只能后台导 CSV」是错的。**
对方口头说只有后台导出，实际有 `POST /v1/api/get_game_history_list`：
含 `transactionId`、`status`（INIT/BET/SETTLED/CANCELED/ERROR）、bet/win 金额与各阶段时间戳，
游标分页单页最大 1000，限流 60 次/分钟（超限 1020）。
**足以做自动对账 cron，包网多租户也 scale。**

### 已答复

| 事项 | 结论 |
|---|---|
| 赢钱上限触发时返 win=0 是 A 还是 B | **A**：「win=0 就是明确未中奖，中奖了会有实际派彩金额」。截断发生在游戏内，不会出现画面中奖却回调 0。不需要 `capped` 字段 |
| 对账数据含 transactionId | 有 |
| `/refund` 无 `betTransactionId` 时如何定位 | 捕鱼批次结算，见下方「特殊逻辑」 |
| 回调方向签名 | 与我方调用方向**同一套**（文档 `guide/auth` 明确），且官方承认**不把 body 纳入签名** |
| 对方回调出口 IP | `18.140.115.44` / `47.128.245.215` / `13.212.145.68`（AWS 新加坡），已配 nginx 白名单 |
| **RTP 权限档位** | **常规户 50–97，高爆户 100–500。我方是常规户** |
| `get_game_list` 分页 | 无分页，不传 gameBrand 一次返回全部（实测 288 款） |

### ⚠️ RTP 只能往下调，不能放水

开户信息写明「商户类型：常规」，所以可用档位是 **50–97**，`100 / 150 / 500` 用不了。
运营若要对特定 VIP 做"放水挽回"，现在做不到，需申请转高爆户。**这是商业决策点。**

### 🔴 官方「特殊逻辑说明」——推翻了朴素的回调模型

1. **捕鱼按 3 秒批次结算**：累加 3 秒内总输赢，净值为负回调 `/bet`，否则回调 `/win`。
   因此**捕鱼可能在没有任何前置 `/bet` 的情况下先收到 `/win`**，也不能依赖 `betTransactionId`。
   👉 实现上 `/win` 不要求存在对应 bet 行，否则捕鱼第一笔派奖会被直接拒掉。
2. **spribe 等小游戏**：单轮多次下注、多次赢钱，且有退款逻辑。
3. **PG 部分游戏 1 bet 多 win**：同一 roundId 多条 win，`isEnd=false` 表示本局未结束。
   👉 `bg_bet_round` 是 SUM 聚合，天然支持。

### 仍未答复

| 事项 | 影响 |
|---|---|
| `/verify` 的 `gameId` 是否与 token 绑定校验 | 安全项，测不出来。**我方已自行校验**（含 `gameBrand`），不依赖对方 |
| TADA 与 jili 的关系 | 不急，TADA 不在测试环境的 4 家里 |

另需商务提供：生产域名与生产密钥、正式服开放厂商范围。

---

## 10. 实现现状（2026-09-08）

分支 `claude/wxgame-integration`，已在阿里云测试环境部署并联调。

### 已完成

| 模块 | 文件 | 验证方式 |
|---|---|---|
| 记账层抽取 | `services/wallet-ledger.ts` | 6 条 SQL 与原实现逐字一致，568win 70 个测试全过 |
| 建表 | `222_wxgame_integration.sql` | 两个租户库均已执行 |
| 上游客户端 | `clients/wxgame.client.ts` | 真凭证实测 `get_game_list` 返回 288 款 |
| 目录同步 | `services/wxgame-game.service.ts` + cron | 288 款入库，含图与状态 |
| 起游戏 | `routes/wxgame-operation.routes.ts` | 真实拿到 spribe/aviator 游戏 URL |
| 回调五件套 | `services/wxgame-wallet.service.ts` | 对方从白名单 IP 回调 `/verify` 返 200 |
| 前台游戏列表 | `sg-game.service.ts` | 缓存 5343 款（568win 5055 + WXGame 288）|
| 口径分流 | `vip.service` / `withdraw-review` / `bets.routes` / `admin/bet-orders` | 见下 |

### 联调抓到的两个 bug（单元测试抓不到）

1. **重复回调在余额不足时返 1011 而非 1018**。钱已扣掉后上游重发同一 `transactionId`，
   余额不够再扣一次，而余额检查排在查重之前。上游会当成玩家没钱而重试或标失败，
   两边账就对不上。已把查重挪到余额检查前（并发窗口仍由 `uk_provider_txn` 兜底）。
   *mock 里余额永远够，所以单测过了。*
2. **撤销写钱包流水报 `Data truncated`**。`bg_wallet_ledger.type` 是 ENUM，
   合法值里没有 `refund`，整笔事务回滚返 1001。改用 `adjust`（与 568win 退回 stake 一致），
   注单侧 `bg_bet_order.bet_type` 照常记 `refund`。
   *mock 不校验 ENUM，这类问题只有真库能发现。*

### 口径分流的实测差异

某测试玩家在 WXGame 净输 150：
- 改前（`aggregator_id = '568win'`）→ 负盈利返水算出 **0**
- 改后（`IN (AGGREGATOR_IDS_SQL)`）→ **150**

玩家输了拿不到返水、代理拿不到佣金，且报表上看不出来。这是整个接入里最容易漏的一处。

**不该改的两处**：`admin-store.ts`（3 处）与 `sg-game.service.ts`（2 处）里的
`DEFAULT_AGGREGATOR` 查的是 `bg_568win_game` 系列表，在那里是当「568win」字面标签用的。

### 🎮 真人实玩联调结果（2026-09-08 01:41–02:01）

用户在测试环境真实玩了 spribe/aviator 与 jili/103（Golden Empire），
上游回调全部正常进入，**不是模拟数据**。

| 厂商 | 局数 | 投注 | 派彩 |
|---|---:|---:|---:|
| spribe/aviator | 1 | 16.00 | 0 |
| jili/103 | 14 | 31.00 | 14.10 |

**验证到的三件事**：

1. **`win = 0` 的回调真的会发。** 官方文档警告"并非所有厂商支持"，
   但 spribe 与 jili 实测都发了 win=0。对方后台那个开关是有效的
   （yono 等厂商仍不能假设，正式环境要逐家复测）。
2. **真实 roundId 是上游自己的编号**（`47918443`、`2408257824335425103`），
   与我方伪造的格式完全不同 —— 按 roundId 关联的设计经得起真数据。
3. **账精确对上**：`1484 − 31 + 14.1 = 1467.10`，钱包余额分毫不差。
   洗码分类正确（aviator → table，jili 老虎机 → slots），注单全部 `settled`。

### 🔴 阻塞：`get_game_history_list` 始终返回空，对账拿不到数据

有了 15 局真实注单之后，该接口**仍然返回空列表**（`code=0`，`data` 里没有 `list` 字段）。
已排除是我方参数问题 —— 下列组合全部返回空：

| 请求 | 结果 |
|---|---|
| `{}` 空 body | `list=0` |
| `{"roundId":"47918443"}` 精确查已知局 | `list=0` |
| `{"roundId":"2408257824335425103"}` | `list=0` |
| `{"playerId":"BG10012"}` | `list=0` |
| `{"gameBrand":"jili"}` / `{"gameBrand":"spribe"}` | `list=0` |
| 各种 `page.nextTimeAtUTC` 时间游标（未来/1h前/1d/7d/30d） | `list=0` |

**直接按 roundId 精确查都查不到，所以不是分页或游标语义的问题。**

可能原因（待对方答复）：接口未对我方测试商户开通 / 注单入库有延迟 /
小游戏与 slot 不进该接口 / 存在文档未列出的必填参数。

**影响**：对账 cron 已在运行且逻辑经过单测，但永远扫到 0 条，
等于目前**没有对账能力**。无缝钱包下回调丢失是静默的，这是上线前必须解决的一项。

参考 requestId：`d79f26883afbfbf664c53adc61fb3dfc`

### 待办

**🔴 上线阻塞**
1. `get_game_history_list` 拉不到数据 → 目前等于没有对账能力，见上一节
2. **游戏重名**：288 款里 237 款（82%）与 568win 同名（两家聚合同一批上游厂商），
   前台 5343 款里出现大量重复，玩家分不清。三种处理方式待业务决策：
   优先走 WXGame 隐藏 568win 同名款 / 保留两份并标厂商 / WXGame 只对特定玩家开放。
   **这是商业决策，不是技术选择**
3. 生产环境密钥与域名（商务）

**⚠️ 上线前应完成**
4. 正式环境开通 25 家后逐家复测 `win=0` 回调（文档点名 yono 不支持）
5. 图源复测：`get_game_list` 返回的 `gameIcon` 对 pragmatic / booongo / evoplay
   是否可用（测试环境只开 4 家，验不了）。确认坏了再决定是否建落 OSS 管线 ——
   S3 当前未配置，先建等于猜一个可能不存在的问题
6. 图片体积：抽样 7 KB – 1.4 MB，中位数约 150 KB，前台需转 WebP 压缩

**待对方答复**
7. `/verify` 的 `gameId` 是否与 token 绑定校验（安全项，我方已自行校验，不依赖对方）
8. TADA 与 jili 的关系（TADA 不在测试环境的 4 家里）

**已完成**：点控 RTP 后台（前后端）、对账 cron 与后台页面（逻辑就绪，等接口有数据）、
包网租户化（bff 已改走 `/t/<code>/...`，自营站路径不变）

---

## 11. 落地拆解（原始规划，保留供对照）

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

## 12. 接入检查清单（对齐 `06-aggregator-integration.md`）

- [x] `AGGREGATOR_IDS` 加 `'wxgame'`，bff / core 两份常量同步
- [x] 原始流水表独立命名 `bg_wxgame_*`
- [x] uuid 前缀 `wxgame:` 与**限定次数**解析（gameId 含冒号）
- [x] 幂等键 = `transactionId`，落 `uk_provider_txn`
- [x] Nonce 去重 + IP 白名单（签名不覆盖 body）
- [x] `bg_bet_round` JOIN 按 `aggregator_id` 分流
- [x] 洗码 / 返水 / 提现风控三条口径确认含 WXGame 注单
- [x] 密钥轮换留空实现（对方无轮换机制，不删接口）
- [x] 点控 RTP 后台（档位限 50–97，前后端已上）
- [x] 包网租户化：bff 改调 `/t/<code>/internal/wxgame/...`
- [x] 一轮完整回归：真人实玩 15 局，账精确对上，返水实测算出 35 PHP
- [~] 对账 cron：逻辑与后台页面就绪，但上游 `get_game_history_list` 返回空，等对方
- [ ] 游戏重名（237/288 与 568win 撞名）的业务处理方式
- [ ] 正式环境逐家复测 win=0 回调与图源；图片按需转 WebP
