# WXGame 聚合商接入方案（第二家）

**状态**：方案待确认，未开工
**最近更新**：2026-09-07（对方已答复第一批 3 个阻塞项，见 §9）
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
| 对账 | `GetBetStatus` + 报表拉取 cron | 无接口，**只有后台人工导出 CSV** ⚠️ |
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

### 🔴 图片：官方给了第二份专门的图标表，但 32% 的图现在就拉不到

对方另给了一份图标表（25 sheet / 2341 款，列为 `游戏ID / 游戏名称 / 游戏图标 / 游戏类型`）。
**它与游戏清单表的 icon 列是同一批 URL**，没有做落地托管，只是把图源整理得更干净。
逐个图源实测（2026-09-07）：

| 图源 | 数量 | 实测结果 |
|---|---:|---|
| `file.wxgame99.com`（上游自建） | 1392 | ✅ 200 |
| `prgassets.bd88fgabh.com`（pragmatic 全部） | 567 | 🔴 **DNS 解析失败，域名已死** |
| `static-r2-bng.thefanz.net`（booongo 全部） | 118 | 🔴 **HTTP 500** |
| `rb.thefanz.net`（rubyplay/wg） | 102 | ✅ 200 |
| `common.ibcsfaqcha.net`（evoplay 全部） | 52 | 🔴 **DNS 解析失败，域名已死** |
| `nolimitcity.com` | 44 | ⚠️ 200，但厂商官网直链 |
| `rmpiconcdn.kaga88.com` | 43 | ⚠️ 200，动态生成接口非静态图 |
| `image.91clubss.xyz`（yono 全部） | 34 | ✅ 200 |
| `www.popiplay.com` | 13 | ⚠️ 200，厂商官网直链 |
| `playson.com` | 3 | 🔴 **403 防盗链** |
| `images.jiamengweiquan.com` | 2 | 🔴 **DNS 解析失败** |
| 其他 | 5 | ✅ 200 |

**不可用合计 742 张（约 32%）**，且不是我方网络问题 —— 三个域名是全球 DNS 无记录，
即域名已过期或被弃用。受影响的是**整厂**：pragmatic 615 款、booongo 118 款、evoplay 53 款
——正好是游戏数最多的几家。

体积也是问题：抽样 8 张，范围 7 KB – 1.4 MB，中位数约 150 KB。
一屏 100 个游戏格子就是 15 MB，必须转 WebP 并压到 ~20 KB 量级。

**所以结论不变，反而更硬：图必须全部抓回自己 OSS**，且要在签约前就让对方补齐那 742 张。
可复用现有 `game-icon-probe.service.ts` 与 `cover_candidate` 那套。

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
| 类型 | 游戏清单表 | 图标表 |
|---|---:|---:|
| slot | 2303 | 2287 |
| table | 70 | 47 |
| fish | 10 | 5 |
| poker | 3 | 2 |
| **合计** | **2386**（133 款维护中） | **2341** |

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

## 9. 与对方确认事项（第一批已答复 2026-09-07）

### 已解决

| # | 事项 | 对方答复 | 结论 |
|---|---|---|---|
| 1 | `win = 0` 必须开启回调 | 已在商户后台把「派奖为0是否回调」设为**是**（附配置页截图） | ✅ 闭环。每局必有 `/bet` + `/win`，`bg_bet_round` 可正常结算 |
| 2 | 对账能力 | 后台支持**导出 CSV / Excel 报表** | ⚠️ 见下方「对账的两个待钉字段」 |
| 3 | 742 张失效图标 | 发来 `WXGAME厂商logo+厂商图标.zip`（238.6 MB） | ⏳ **待验**，见下方「图标包待验三项」 |

### ⚠️ 对账：能用，但两个字段没钉死就是废的

导出报表能满足日常对账，但必须先确认：

1. **导出字段里要有 `transactionId`** —— 这是与 `bg_bet_order.provider_txn_id` 做逐笔 diff
   的唯一连接键。若导出的只有玩家/时间/投注额/输赢额，或用的是对方另一套内部流水号，
   就只能对总额、对不出**是哪几笔**差异，等于回到人工翻界面。
2. **单次导出条数上限 + 是否支持按时间段（而非仅按天）** —— 日均十几万笔时，
   若限制单次 1 万条，对账流程要拆很多次。

**已知局限**：这是人工流程，**没有 API 就做不了自动对账 cron**。自营站每天人工下载
可接受；**包网多租户后每个租户站都要人工导一遍，不 scale**。中期仍需推对方给接口。

### ⏳ 图标包待验三项

1. 是**每款游戏的 icon** 还是只有 **25 个厂商的品牌 logo** ——
   文件名「厂商logo+厂商图标」措辞含糊，两种都讲得通
2. 文件名能否与 `gameId` 对上 —— 特别是 `Silver&GoldMine` / `DivineQueen:HeartOfIce` /
   `EvilGoblinsxBomb®` 这类含特殊字符的，打包时大概率被转义
3. 失效的 742 款（pragmatic 567 / booongo 118 / evoplay 52）是否真的补齐

体量参考：238.6 MB ÷ 2386 ≈ 100 KB/款，像是全量游戏图，但也可能只是
`file.wxgame99.com` 上那 1392 张的打包。

---

### 🔴 新发现：赢钱倍数 / 赢钱上限（来自对方配置页截图）

对方商户后台除「派奖为0是否回调」「IP 白名单」外，还有两项我方此前不知道的风控开关：

- **赢钱倍数**（当前：全局 不限制）
- **赢钱上限**（当前：全局 不限制）

对方答复：**超过倍数限制时返回 `win = 0`，保证流程闭环。**

流程确实闭环，但这句话有两种含义，差别极大：

| | 含义 | 后果 |
|---|---|---|
| **A** | 游戏内不会开出超上限的结果，玩家看到的就是一次未中奖，`win=0` 是正常记账 | 没问题，私服点控应有的样子 |
| **B** | 游戏画面显示中奖，但回调我方 `win = 0` | 玩家看到中了 5000、余额一分没涨 → 客诉核弹。且**我方账完全平衡、报表无异常**，只能等玩家投诉才知道 |

私服模式下大概率是 A，但**不能靠猜**，已去函要求明确。

**衍生问题**：一旦触发截断，我方收到的 `win = 0` 与「玩家真的没中奖」**完全无法区分**，
客诉排查与对账都失去依据。已要求对方在回调中增加标记字段
（`capped: true` 或附截断前原始金额）。

**约定要求**：这两项配置如需调整，对方须提前通知 —— 否则对方后台改一下，
我方账就静默错了。目前均为「不限制」，不阻塞开发。

### 我方需提供给对方的资料（对方已催，2026-09-07 整理）

| 项 | 值 | 依据 |
|---|---|---|
| **回调地址（测试）** | `https://www.188facai.com/api/v1/wxgame/{verify,balance,bet,win,refund}` | 与 568win 回调同一 server_name，nginx 转 `core-node:4000/wxgame/<action>` |
| **回调地址（生产）** | `https://betogo.games/api/v1/wxgame/{...}` | 生产域名，开站前确认 |
| **我方出口 IP（测试）** | `47.84.34.139` | 需向对方报备，用于调 `get_game_url` 等 |
| **币种** | 主用 **PHP**；另有 IDR / USDT / USDC | 对方 152 币种列表全部覆盖，无需换算 |
| **地区** | 菲律宾为主，另有印尼、越南 | `bg_user.locale` 取值 `en/id/vi/zh-CN`，钱包币种 PHP/IDR |
| **默认 RTP** | **95** | 接近正规厂商行业标准（老虎机通常 95–97），与 568win 玩家体感一致；毛利靠点控个别玩家与低价点位拿 |

⚠️ **语言缺口**：对方只支持 `en / es / id / pt / ru / th / vi`（部分厂商多 `hi`），**没有中文**。
我方 `zh-CN` 用户起游戏时只能回落 `en`。

nginx 已加 location（`deploy/nginx/bff-api.conf`），**白名单留空 + `deny all`** ——
拿到对方出口 IP 前不开放。宁可对方联调报 403 让我们加白，也不先裸奔：
这套签名不覆盖 body，nginx 是第一道闸。

### 待答复（第二批，非阻塞）

| # | 事项 | 不解决的后果 |
|---|---|---|
| 4 | **`/refund` 在 `betTransactionId` 缺失时怎么定位原单** | 该字段可选，捕鱼类不传。同一 `roundId` 下捕鱼有连续多笔 bet，**退错钱** |
| 5 | **回调方向的签名方案** | 文档只写了我方调他们的规则，反方向一字未提。大概率同一套，但必须书面确认 |
| 6 | **RTP 权限档位**（`50–97` 还是 `50–500`） | 能不能开 100 以上放水档，直接决定这家的运营价值 |
| 7 | **TADA 与 jili 的关系** | icon 路径与 gameId 双重重叠，不问清会图片错配 + 主键冲突 |
| 8 | **对方回调我方的出口 IP 段** | 配置页已确认有 IP 白名单机制，双向都要报备 |

### 实现中新发现、文档未写（拿到测试密钥后多数可自测）

| # | 事项 | 影响 |
|---|---|---|
| 9 | `get_game_list` **有无分页** | 已按一次全返实现。若实际有分页而未传页码，会**静默只拿到第一页**，目录缺一大半且无报错。错误码有 `1020 已达最大请求限制`，说明存在限流，多半也有分页 |
| 10 | **token 长度与字符集限制** | 文档示例是 `"33445566"`（8 位数字），我方用 32 位 hex。有上限则起游戏直接失败 |
| 11 | `playerId` **长度上限** | 只说「数字字母」未说长度。我方 `bg_user.id` 是 varchar(32) |
| 12 | `/verify` 的 `gameId` **是否与 token 绑定校验** | 🔴 安全项，**测不出来**，必须问：若上游不校验，玩家可拿 A 游戏的 token 起 B 游戏 |
| 13 | `gameType` 完整取值与是否支持逗号多选 | 清单实际有 slot/table/fish/poker 四种，接口文档只出现 slot，请求示例却写 `"slot,table"` |

第 9–11、13 项拿到测试密钥后我方自测即可，不必占用对方响应时间；第 12 项是设计问题需对方书面确认。

另需商务提供：**测试环境 `AccessKeyId` / `AccessKeySecret`（当前最卡）**、生产域名、
正式服开放厂商范围（测试服只开 pg / jili / spribe / inout 四家）。

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
- [ ] 验图标包（是否每款游戏 / 文件名对得上 gameId / 742 张是否补齐）
- [ ] 图片全量落地 OSS + 转 WebP 压缩
- [ ] 钉死导出报表含 `transactionId` + 条数上限，写一版人工对账 SOP
- [ ] 赢钱上限触发时的语义确认（A/B）+ 要到 `capped` 标记字段
- [ ] 洗码 / 返水 / 佣金三条口径确认含 WXGame 注单
- [ ] 一轮完整回归
