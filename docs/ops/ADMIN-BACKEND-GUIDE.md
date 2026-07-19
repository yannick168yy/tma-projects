# BetoGo 管理后台使用手册

## 访问地址

| 环境 | 地址 |
|------|------|
| 测试服 | http://47.84.34.139:8085 |
| 生产 | 通过 Nginx 代理或单独域名 |

---

## 默认账号

| 用户名 | 初始密码 | 角色 |
|--------|----------|------|
| admin | Betogo@2025 | super_admin |

> 首次登录后请立即修改密码（目前通过数据库直接修改 `admin_accounts.password_hash`，密码修改 API 待开发）。
> 账号在 bff-node 启动 15 秒后自动创建，若数据库中已有管理员账号则不会重复创建。

---

## 功能模块

### 1. 数据概览（Dashboard）

路径：`/dashboard`

展示平台核心指标（实时查询 MySQL）：

- 总用户数 / 活跃用户数 / 冻结用户数
- 今日存款笔数及金额
- 今日提款笔数及金额
- 待审批提款单数
- 平台用户总余额（分）

---

### 2. 用户管理（Users）

路径：`/users`

#### 列表功能

- 搜索：按用户 ID、显示名、邮箱模糊搜索
- 筛选：按状态（活跃 / 冻结 / 封禁）筛选
- 字段：ID、显示名、TG 用户名、余额、状态、标记、最后登录时间
- 操作栏：
  - **详情**：进入用户详情页
  - **禁用**：一键将用户状态改为 `frozen`（含二次确认）
  - **标记▾**：下拉选择用户标签

#### 用户标签

| 标签值 | 显示名 | 含义 |
|--------|--------|------|
| normal | 普通 | 默认 |
| arbitrage | 套利客 | 存在套利行为的用户（红色标注） |

#### 用户详情页（`/users/:id`）

**基本信息**：ID、显示名、Email、TG 用户名、状态、标记、最后登录时间、注册时间、余额

**管理操作**：
- 修改状态：active / frozen / banned，可填写原因
- 修改标记：普通 / 套利客
- 调整余额：单位为"分"，正数加余额，负数扣余额，需填写备注

**活动记录（三个标签页）**：
- **账本记录**：最近 20 条资金变动（存款/提款/投注/红包/奖励）
- **登录记录**：最近 20 次登录，含时间、IP、设备信息、登录方式（telegram/google）
- **游戏记录**：最近 30 条投注记录，含类型（bet/win/refund）、金额、状态、Round ID

> TG 用户名说明：`telegram_username` 字段在 2026-05-27 随迁移 004 新增，已有老用户需重新登录一次后才会写入。

---

### 3. 存款管理（Deposits）

路径：`/deposits`

查看所有存款订单（只读），支持按用户 ID、状态筛选。

| 字段 | 说明 |
|------|------|
| 订单号 | `bg_deposit_order.order_id` |
| 用户 ID | |
| 金额 | 原始存款金额（非分） |
| 入账 | 实际入账 PHP 分 |
| 状态 | pending / paid / failed / cancelled |
| 渠道 | tg_wallet / ton_connect / yfpay 等 |

---

### 4. 提款审批（Withdrawals）

路径：`/withdrawals`

查看并处理提款申请，支持按用户 ID、状态筛选。

#### 审批操作

| 操作 | 效果 |
|------|------|
| 批准 | 订单状态 → `completed` |
| 拒绝（需填写原因） | 订单状态 → `rejected`，金额自动退回用户余额 |

> 用户提款时余额已扣除；拒绝时系统自动执行退款，无需手动操作。

---

### 5. 游戏管理（Games）

路径：`/games`

管理从 568Win 同步的游戏列表（后台「同步 568Win 游戏库」按钮触发，core-node 拉取）。

- 搜索：按游戏名称搜索
- 筛选：按游戏商、启用状态筛选
- 开关：可对单款游戏执行启用 / 禁用（写入 `bg_568win_game_override.is_active`，前台 `/slots` 接口按此过滤）

---

### 6. 操作日志（Audit Log）

路径：`/audit-log`

记录所有管理员写操作，不可篡改（INSERT ONLY），存储在 `admin_audit_log` 表。

覆盖的操作类型：

| action | 说明 |
|--------|------|
| withdrawal.approve | 批准提款 |
| withdrawal.reject | 拒绝提款 |
| user.status_change | 修改用户状态 |
| user.balance_adjust | 手动调整余额 |
| user.label_change | 修改用户标记 |
| game.enable | 启用游戏 |
| game.disable | 禁用游戏 |

---

## 后端 API 路由

所有管理接口前缀：`/api/v1/admin`

```
POST   /admin/auth/login               管理员登录（返回 Bearer token）
POST   /admin/auth/logout              退出（销毁 Redis session）

GET    /admin/dashboard                数据概览

GET    /admin/users                    用户列表（page, pageSize, search, status）
GET    /admin/users/:id                用户详情（含账本/登录/游戏记录）
PATCH  /admin/users/:id/status         修改用户状态
PATCH  /admin/users/:id/label          修改用户标记
POST   /admin/users/:id/adjust-balance 调整余额

GET    /admin/deposits                 存款列表（page, pageSize, userId, status）

GET    /admin/withdrawals              提款列表（page, pageSize, userId, status）
POST   /admin/withdrawals/:id/approve  批准提款
POST   /admin/withdrawals/:id/reject   拒绝提款（body: { reason }）

GET    /admin/games                    游戏列表（page, pageSize, provider, search, isActive）
PATCH  /admin/games/:uuid/toggle       启用/禁用游戏（body: { isActive: boolean }）

GET    /admin/audit-log                操作日志（page, pageSize）
```

---

## 技术说明

- **认证**：管理员登录后返回 Bearer Token，存储在 Redis，TTL 8 小时
- **密码存储**：scrypt 哈希，不存明文
- **审计日志**：所有写操作自动调用 `writeAuditLog()`，含操作人、IP、变更详情
- **前端技术栈**：Vue 3 + Ant Design Vue，端口 8085，Nginx 直接对外
- **后端**：bff-node（Koa），`/api/v1/admin/*` 路由组，独立 `adminAuthMiddleware` 守护

---

## 数据库相关表

| 表名 | 用途 |
|------|------|
| `admin_accounts` | 管理员账号（id, username, password_hash, role, status） |
| `admin_audit_log` | 操作审计日志 |
| `bg_user` | 用户主表（含 telegram_username, label, last_login_at） |
| `bg_login_log` | 用户登录记录（ip, user_agent, auth_method） |
| `bg_wallet` | 用户余额（available_cents, frozen_cents） |
| `bg_wallet_ledger` | 资金流水 |
| `bg_deposit_order` | 存款订单 |
| `bg_withdraw_order` | 提款订单 |
| `bg_bet_order` | 游戏投注记录（来自 568Win 钱包回调） |
