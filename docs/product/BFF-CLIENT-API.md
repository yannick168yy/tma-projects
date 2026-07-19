# BetoGo 客户端 → Node BFF 接口清单

> **项目**：BetoGo（`apps/web-tma`）  
> **BFF**：`apps/bff-node`（Koa，对外唯一 C 端 API）  
> **文档状态**：v1.1 · 2026-05-24  
> **依据**：[PRODUCT-PLAN.md](./PRODUCT-PLAN.md) · [CLIENT-PRODUCT-DESIGN.md](./CLIENT-PRODUCT-DESIGN.md) · [业务架构](../architecture/01-business-architecture.md) · 当前 UI 实现（mock 数据阶段）

---

## 〇、分期范围（2026-05-24 确认）

| 阶段 | 模块 | 说明 |
|------|------|------|
| **v0.1 当前** | 认证与会话、用户与资料、KYC、活动与邀请 | 可立即开展 BFF + 前端联调 |
| **v0.1 当前（收窄）** | 钱包、充值、提现、流水账变 | **仅 Telegram Wallet**；不接 GCash/Maya/USDT 等三方 |
| **暂缓** | 游戏大厅、游戏会话、竞彩记录 | 待接入聚合游戏商后再做 |
| **暂缓** | 消息中心 | 本期不做 |
| **暂缓** | 系统配置（`/config/*`） | 依赖运营后台，本期不做；前端暂用静态/mock |

**v0.1 可开发接口：29 个**（见 §二、§七）。

---

## 一、约定

| 项 | 说明 |
|----|------|
| **Base URL** | `{VITE_BFF_BASE_URL}/api/v1` |
| **鉴权** | 除「公开配置」外，请求头带 `Authorization: Bearer <token>` |
| **登录** | `POST /auth/telegram` 携带 `X-Telegram-Init-Data`（完整 initData） |
| **追踪** | 响应/请求均带 `X-Request-Id` |
| **响应体** | `{ "code": 0, "message": "ok", "data": { ... }, "traceId": "..." }` |
| **金额** | 接口层用整数最小单位（PHP 分 / 链最小单位）；前端展示 2 位小数 |
| **BFF 边界** | 不处理聚合商回调、不直接写账变；钱包/竞彩只读由 BFF **代理 Core** |

**客户端不得直连** `core-java`（8080）。

---

## 二、接口总览（按模块）

| # | 模块 | 接口数 | v0.1 | 备注 |
|---|------|--------|------|------|
| 1 | 认证与会话 | 4 | ✅ | |
| 2 | 用户与资料 | 4 | ✅ | |
| 3 | 系统配置 | 6 | ⏸ | 待运营后台 |
| 4 | 钱包 | 3 | ✅ | TG Wallet 口径 |
| 5 | 充值 | 3 | ✅ | 仅 `channelId=tg_wallet`；取消接口 P1 |
| 6 | 提现 | 4 | ✅ | 仅 TG Wallet；收款账号绑定本期可省略 |
| 7 | 流水账变 | 2 | ✅ | |
| 8 | 游戏大厅 | 8 | ⏸ | 待聚合商 |
| 9 | 游戏会话 | 4 | ⏸ | 待聚合商 |
| 10 | KYC | 4 | ✅ | |
| 11 | 活动与邀请 | 9 | ✅ | |
| 12 | 消息中心 | 4 | ⏸ | 本期不做 |
| 13 | 竞彩记录 | 2 | ⏸ | 待聚合商 |
| | **合计** | **57** | **29 本期** | 全量规划 57（提现账号等 4 个延后） |

图例：✅ 本期开发 · ⏸ 暂缓

---

## 三、接口明细

### 3.1 认证与会话

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | 优先级 |
|------|------|------|----------|----------|------------|--------|
| POST | `/auth/telegram` | TG initData 静默登录 | `initData`, 可选 `start_param` | `token`, `expiresIn`, `user`, `isNewUser`, 可选 `trialRedPacketEligible` | 冷启动 Splash | P0 |
| GET | `/auth/session` | 校验当前 Session | — | `valid`, `userId`, `expiresAt` | 启动恢复 | P0 |
| POST | `/auth/refresh` | 刷新 Token | — | 新 `token` | Session 将过期 | P0 |
| POST | `/auth/logout` | 登出 | — | — | 设置页（可选） | P1 |

---

### 3.2 用户与资料

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | 优先级 |
|------|------|------|----------|----------|------------|--------|
| GET | `/user/me` | 当前用户资料 | — | TG 头像/昵称/id、平台 userId、邀请码、注册时间 | Profile、顶栏头像 | P0 |
| GET | `/user/status` | 账号状态 | — | `active` / `frozen` / `banned`, `reason` | 启动门禁、游戏/提现拦截 | P0 |
| PATCH | `/user/me` | 更新扩展资料 | 姓名、生日、性别、手机、邮箱等 | 更新后 profile | Profile 个人信息表单 | P1 |
| PATCH | `/user/language` | 语言偏好 | `locale`: `en` \| `id` \| `vi` \| `zh-CN` | 当前 locale | Menu 语言切换 | P0 |

---

### 3.3 系统配置（多为公开或弱鉴权）— ⏸ 暂缓

> 依赖运营后台；v0.1 前端继续使用 `@/data/*` 静态配置。Banner、维护、法币通道等接口 **本期不实现**。

| 方法 | 路径 | 说明 | 阶段 |
|------|------|------|------|
| GET | `/config/bootstrap` | 启动聚合配置 | v0.2+ |
| GET | `/config/maintenance` | 维护状态 | v0.2+ |
| GET | `/config/banners` | Banner 列表 | v0.2+ |
| GET | `/config/payment-channels` | 充提通道 | v0.2+（三方支付接入时） |
| GET | `/config/support` | 客服与社群链接 | v0.2+ |
| GET | `/config/legal/{slug}` | 法律文档 | v0.2+ |

---

### 3.4 钱包（BFF → Core 代理）

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | 优先级 |
|------|------|------|----------|----------|------------|--------|
| GET | `/wallet/balances` | 多币种余额 | — | `[{ currency, available, frozen }]` | 顶栏 ₱ 余额、Wallet 总览 | P0 |
| GET | `/wallet/summary` | 资产摘要 | — | PHP 主显、各币余额、冻结说明 | WalletModal 头部 | P0 |
| GET | `/wallet/turnover` | 提现流水进度 | 可选 `currency` | 倍数 N、已完成/所需流水、是否可提 | 提现确认页 TurnoverProgress | P0 |

---

### 3.5 充值 — v0.1 仅 Telegram Wallet

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | v0.1 |
|------|------|------|----------|----------|------------|------|
| POST | `/deposits` | 创建充值订单 | `amount`, `currency`（`PHP`）, `channelId`: **`tg_wallet`** | `orderId`, TG Wallet 调起参数 | Wallet 充值确认 | ✅ |
| GET | `/deposits/{orderId}` | 查询充值单 | — | `status`, 到账金额 | 支付中/结果页轮询 | ✅ |
| GET | `/deposits` | 充值历史 | 分页 + 筛选 | 列表 | Wallet History | ✅ |
| POST | `/deposits/{orderId}/cancel` | 取消未支付订单 | — | — | 用户放弃支付 | P1 |

> v0.1：`channelId` 固定为 `tg_wallet`。BFF 封装 Telegram Wallet 支付，前端只拿调起参数。  
> GCash / Maya / USDT 等通道 **v0.2+** 接入三方后再扩展 `channelId` 枚举。

---

### 3.6 提现 — v0.1 仅 Telegram Wallet

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | v0.1 |
|------|------|------|----------|----------|------------|------|
| GET | `/withdrawals/eligibility` | 提现预检 | `currency`, `channelId`: **`tg_wallet`**, `amount` | 流水是否够、限额、手续费 | 进入提现 Tab | ✅ |
| POST | `/withdrawals` | 发起提现 | `amount`, `currency`, `channelId`: **`tg_wallet`** | `orderId`, `status` | Wallet 提现提交 | ✅ |
| GET | `/withdrawals/{orderId}` | 提现单详情 | — | 状态时间线、拒绝原因 | 结果页/历史详情 | ✅ |
| GET | `/withdrawals` | 提现历史 | 分页 + 状态筛选 | 列表 | Wallet History | ✅ |
| GET | `/withdrawals/accounts` | 收款账号列表 | `channelId` | GCash/Maya/链地址等 | 三方提现 | v0.2+ |
| POST | `/withdrawals/accounts` | 绑定收款账号 | 依通道 | 新 `accountId` | 三方提现 | v0.2+ |
| DELETE | `/withdrawals/accounts/{accountId}` | 删除收款账号 | — | — | 账号管理 | v0.2+ |

> v0.1：TG Wallet 出款无需绑定外部收款账号；KYC 门禁仍保留（法币口径提现规则预置，TG 通道按产品规则可简化）。  
> 流水倍数 N 校验在 `eligibility` 中返回；无游戏聚合商时，有效流水可能仅来自红包/活动，规则由后台配置。

---

### 3.7 流水账变

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | 优先级 |
|------|------|------|----------|----------|------------|--------|
| GET | `/ledger` | 流水列表 | `page`, `type`（deposit/withdraw/bet/red_packet/all）, 时间范围 | 类型、金额、时间、余额快照 | Wallet History、Profile | P0 |
| GET | `/ledger/{id}` | 流水详情 | — | 订单号、traceId、关联业务单 | 点击流水行 | P0 |

---

### 3.8 游戏大厅 — ⏸ 暂缓（待聚合商）

| 方法 | 路径 | 阶段 |
|------|------|------|
| GET | `/games/categories` | v0.3+ |
| GET | `/games` | v0.3+ |
| GET | `/games/hot` | v0.3+ |
| GET | `/games/recent` | v0.3+ |
| GET | `/games/search` | v0.3+ |
| GET | `/games/{gameId}` | v0.3+ |
| GET | `/games/providers` | v0.3+ |
| GET | `/games/winners/marquee` | v0.3+ |

> v0.1 前端继续使用 `@/data/home.ts`、`@/data/menu.ts` 等 mock 游戏数据；点击游戏卡片可 Toast「即将上线」。

---

### 3.9 游戏会话 — ⏸ 暂缓（待聚合商）

| 方法 | 路径 | 阶段 |
|------|------|------|
| GET | `/games/session/status` | v0.3+ |
| POST | `/games/launch` | v0.3+ |
| POST | `/games/session/heartbeat` | v0.3+ |
| POST | `/games/session/release` | v0.3+ |

---

### 3.10 KYC

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | 优先级 |
|------|------|------|----------|----------|------------|--------|
| GET | `/kyc/status` | KYC 状态 | — | `none` / `pending` / `approved` / `rejected`, 驳回原因 | 提现门禁、Profile | P0 |
| POST | `/kyc/documents/upload-url` | 获取证件上传凭证 | `docType`, `mimeType` | presigned URL / upload token | 拍照上传前 | P0 |
| POST | `/kyc/submissions` | 提交 KYC | 姓名、证件、文件 id 等 | `submissionId`, `status` | KYC 分步表单 | P0 |
| GET | `/kyc/submissions/latest` | 最近提交详情 | — | 字段与审核状态 | KYC 中心 | P0 |

---

### 3.11 活动与邀请

| 方法 | 路径 | 说明 | 请求要点 | 响应要点 | 客户端场景 | 优先级 |
|------|------|------|----------|----------|------------|--------|
| GET | `/promotions` | 活动列表 | `locale` | 试玩官、邀请、厂商活动等 | BonusesPage | P0 |
| GET | `/promotions/{promoId}` | 活动详情 | — | 规则、奖励、流水要求、时间 | 活动展开 | P0 |
| POST | `/promotions/{promoId}/claim` | 领取活动奖励 | — | 到账金额、流水约束 | Bonuses CTA | P0 |
| GET | `/promotions/trial-play` | 试玩官进度 | — | 是否已领、流水进度、可否提现 | 首页快捷卡、首登 Sheet | P0 |
| POST | `/promotions/trial-play/claim` | 领取试玩官红包 | — | 红包金额 | RedPacketSheet | P0 |
| GET | `/promotions/referral` | 邀请有礼概况 | — | 邀请码、累计奖励、待发放 | Bonuses / Profile | P0 |
| GET | `/promotions/referral/link` | 邀请链接 | — | `deepLink`, `shareText` | Copy Link / TG Share | P0 |
| GET | `/promotions/referral/records` | 邀请记录 | `page` | 好友脱敏、状态、奖励 | 邀请进度列表 | P0 |
| GET | `/promotions/red-packets` | 红包记录 | `page` | 类型、金额、时间 | Profile 红包记录 | P0 |

---

### 3.12 消息中心 — ⏸ 暂缓

本期不做。Bot Push 仍可由服务端发送，Mini App 内不设消息列表。

| 方法 | 路径 | 阶段 |
|------|------|------|
| GET | `/messages` | 后续 |
| GET | `/messages/unread-count` | 后续 |
| PATCH | `/messages/{id}/read` | 后续 |
| POST | `/messages/read-all` | 后续 |

---

### 3.13 竞彩记录 — ⏸ 暂缓（待聚合商）

| 方法 | 路径 | 阶段 |
|------|------|------|
| GET | `/bets` | v0.3+ |
| GET | `/bets/{id}` | v0.3+ |

---

## 四、客户端页面 → 接口映射（v0.1）

| UI 页面 / 组件 | v0.1 接口 | 备注 |
|----------------|-----------|------|
| **冷启动** | `POST /auth/telegram`, `GET /auth/session` | 无 bootstrap；游戏列表仍 mock |
| **AppShell 顶栏** | `GET /wallet/balances`, `GET /user/me` | |
| **HomeContent** | — | mock 数据；Banner/游戏 API 暂缓 |
| **SearchOverlay** | — | mock 或本地过滤 |
| **WalletModal** | `GET /wallet/summary`, `POST /deposits`, `GET /deposits/{id}`, `GET /withdrawals/eligibility`, `POST /withdrawals`, `GET /ledger` | 仅 TG Wallet 通道 |
| **BonusesPage** | `GET /promotions`, `GET /promotions/trial-play`, `GET /promotions/referral`, `POST /promotions/*/claim` | |
| **BingoPage / MenuPage** | — | mock 游戏 |
| **ProfilePage** | `GET /user/me`, `PATCH /user/me`, `GET /kyc/status`, KYC 提交相关 | 法律/客服链接暂静态 |
| **首登红包 Sheet** | `GET /promotions/trial-play`, `POST /promotions/trial-play/claim` | UI 待补 |
| **KYC 中心** | `GET /kyc/status`, `POST /kyc/documents/upload-url`, `POST /kyc/submissions` | UI 待补 |
| **游戏 / 维护 / 消息** | — | 暂缓 |

---

## 五、非客户端接口（仅供对照）

以下 **不由 BetoGo 前端调用**，但属于平台链路：

| 调用方 | 目标 | 说明 |
|--------|------|------|
| 游戏聚合商 | Core `POST /callback/bet`, `/callback/win` 等 | 竞彩下单/派彩回调 |
| 支付通道 | Core/BFF Webhook | TG Wallet、GCash、USDT 入账/出款回调 |
| 运营后台 | 独立 Admin API | 非本清单范围 |
| Telegram Bot | Bot API | Push 通知（非 Mini App REST） |

---

## 六、BFF 路由文件建议（`apps/bff-node`）

**v0.1 仅实现以下路由文件：**

| 路由文件 | 覆盖模块 | v0.1 |
|----------|----------|------|
| `auth.routes.ts` | §3.1 | ✅ |
| `user.routes.ts` | §3.2 | ✅ |
| `wallet.routes.ts` | §3.4 | ✅ |
| `deposit.routes.ts` | §3.5 | ✅ |
| `withdraw.routes.ts` | §3.6 | ✅ |
| `ledger.routes.ts` | §3.7 | ✅ |
| `kyc.routes.ts` | §3.10 | ✅ |
| `promotion.routes.ts` | §3.11 | ✅ |
| `config.routes.ts` | §3.3 | ⏸ |
| `game.routes.ts` | §3.8 + §3.9 | ⏸ |
| `message.routes.ts` | §3.12 | ⏸ |
| `bet.routes.ts` | §3.13 | ⏸ |

---

## 七、v0.1 开发清单（29 个接口）

### 7.1 认证与会话（4）

- `POST /auth/telegram`
- `GET /auth/session`
- `POST /auth/refresh`
- `POST /auth/logout`（P1，可后补）

### 7.2 用户与资料（4）

- `GET /user/me`
- `GET /user/status`
- `PATCH /user/me`
- `PATCH /user/language`

### 7.3 钱包 · TG Wallet 口径（3）

- `GET /wallet/balances`
- `GET /wallet/summary`
- `GET /wallet/turnover`

### 7.4 充值 · 仅 TG Wallet（3）

- `POST /deposits`（`channelId=tg_wallet`）
- `GET /deposits/{orderId}`
- `GET /deposits`

### 7.5 提现 · 仅 TG Wallet（4）

- `GET /withdrawals/eligibility`
- `POST /withdrawals`
- `GET /withdrawals/{orderId}`
- `GET /withdrawals`

### 7.6 流水（2）

- `GET /ledger`
- `GET /ledger/{id}`

### 7.7 KYC（4）

- `GET /kyc/status`
- `POST /kyc/documents/upload-url`
- `POST /kyc/submissions`
- `GET /kyc/submissions/latest`

### 7.8 活动与邀请（9）

- `GET /promotions`
- `GET /promotions/{promoId}`
- `POST /promotions/{promoId}/claim`
- `GET /promotions/trial-play`
- `POST /promotions/trial-play/claim`
- `GET /promotions/referral`
- `GET /promotions/referral/link`
- `GET /promotions/referral/records`
- `GET /promotions/red-packets`

### 7.9 建议联调顺序

1. **Auth** → `POST /auth/telegram` + Session 持久化  
2. **User** → `GET /user/me` + `start_param` 邀请绑定  
3. **Promotions** → 试玩官领取 + 邀请链接  
4. **Wallet + Ledger** → 余额展示 + 流水列表  
5. **Deposits / Withdrawals** → TG Wallet 充提闭环  
6. **KYC** → 提交与状态查询  

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-24 | 初版：全量 61 个 BFF 接口 |
| v1.1 | 2026-05-24 | 按研发分期收窄 v0.1 为 29 个；游戏/消息/系统配置暂缓；支付仅 TG Wallet |
