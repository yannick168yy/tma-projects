# bff-node 安全审计记录

> 审计时间：2026-05-28  
> 审计范围：bff-node 所有路由、服务层、存储层

---

## 已修复

### [高危] #1 普通提现竞态（TOCTOU）
**文件**：`src/routes/withdraw.routes.ts`  
**问题**：`POST /withdrawals` 直接 GET 余额 → 检查 → 减法 → SET，并发请求可同时通过余额检查，导致超额提现。且使用 `saveWallet` 绕过 ledger，提现无账变记录。  
**修复**：引入 Redis 分布式锁（30s NX），改用 `creditWallet`（原子扣款 + ledger 写入）。  
**PR**：fix(yfpay): 修复支付安全漏洞 + 后续提现竞态修复

---

### [高危] #2 YfPay 充值金额单位歧义
**文件**：`src/routes/yfpay-callback.routes.ts`、`src/routes/yfpay.routes.ts`  
**问题**：`OrderDeposit.amount` 存 PHP 元（浮点），`OrderWithdraw.amount` 存分（整数），字段名相同但单位不同。回调中用 `Math.round(order.amount * 100)` 隐式换算，若未来有人从 withdraw 路径复制代码会导致 100 倍误充。  
**修复**：创单时显式写入 `creditedCents`（分），回调优先读 `creditedCents`，`amount × 100` 仅作兜底。加注释说明两个类型的单位差异。

---

### [高危] #7 creditWallet 非原子性（Redis 模式）
**文件**：`src/services/store/redis-store.ts`  
**问题**：原实现分三步：GET wallet → SET wallet → LPUSH ledger。若 SET 成功后进程崩溃，ledger 缺失（账务不一致）；若两个并发请求同时 GET 到相同余额再各自 SET，后写者覆盖先写者的余额增量（并发余额计算错误）。  
**修复**：改用 Lua 脚本，在单个 Redis 命令原子执行：读 wallet → 加减 → 写 wallet → LPUSH ledger entry（含 balanceAfter）。

---

### [高危] #10 Telegram Webhook 无签名验证
**文件**：`src/routes/webhook.routes.ts`  
**问题**：`POST /webhooks/telegram` 不验证请求来源，任何人可伪造 successful_payment 事件触发任意用户充值。  
**修复**：读取 `X-Telegram-Bot-Api-Secret-Token` header，与 `TELEGRAM_WEBHOOK_SECRET` 环境变量比对。需在 Telegram setWebhook 时传 `secret_token` 参数（见下方配置说明）。

---

## 待修复（已知风险）

### [高危] .env 含真实凭证
**文件**：`.env`  
**问题**：TELEGRAM_BOT_TOKEN、YFPAY_API_KEY、GEMINI_API_KEY 等真实密钥存于文件，若 .env 在 git 历史中则永久泄露。  
**建议**：确认 `.env` 在 `.gitignore` 中；使用 `git filter-repo` 清理历史；生产环境通过阿里云 KMS 或 Nacos 管理密钥，不落文件。

### [高危] 管理员初始密码硬编码
**文件**：`src/services/admin-auth.service.ts`（seed 逻辑）  
**问题**：`'Betogo@2025'` 硬编码为 seed 密码，任何看到代码的人知道初始凭证。  
**建议**：seed 时生成随机密码并打印到日志（仅首次），或在首次登录时强制修改密码。

### [高危] Dev 模式跳过 Telegram 认证
**文件**：`src/services/auth.service.ts`、`.env`  
**问题**：`BFF_DEV_SKIP_TELEGRAM_AUTH=true` 在 `.env` 中已启用，若该变量被带入生产环境任何人可免认证登录。  
**建议**：生产部署时严格确认该变量为 `false`；可在 CI/CD 中加断言。

### [中危] CORS 允许任意 Origin
**文件**：`src/app.ts`  
**问题**：`origin: (ctx) => ctx.get('Origin') || '*'`，允许任意域名跨域携带 credentials。  
**建议**：改为白名单：`['https://www.188facai.com', 'https://admin.188facai.com']`。

### [中危] Admin Token 存 localStorage
**文件**：`apps/web-admin/src/stores/auth.ts`  
**问题**：管理员 token 存于 localStorage，XSS 漏洞可直接读取。  
**建议**：改用 HttpOnly + Secure Cookie 存 token，前端无法通过 JS 读取。

### [中危] 提现 POST 未二次校验 KYC
**文件**：`src/routes/withdraw.routes.ts`  
**问题**：`GET /eligibility` 检查 KYC，但 `POST /` 不检查，用户可绕过 eligibility 直接提现。  
**状态**：当前 KYC 后端尚未实现（`getKyc` 在 MySQL 模式返回 null），待 KYC 功能上线后同步在 POST 中加验证。

### [中危] Webhook 缺速率限制
**文件**：所有公开路由  
**建议**：对登录、充值创单等接口加 Redis 滑动窗口限速（如 `/auth/login` 每 IP 每分钟 10 次）。

---

## 配置说明

### TELEGRAM_WEBHOOK_SECRET 配置步骤

1. 生成随机 secret（建议 32 字节 hex）：
   ```bash
   openssl rand -hex 32
   ```
2. 写入 `.env`：
   ```
   TELEGRAM_WEBHOOK_SECRET=<生成的值>
   ```
3. 调用 Telegram setWebhook API 时加上 `secret_token` 参数：
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://www.188facai.com/api/v1/webhooks/telegram&secret_token=<生成的值>
   ```

---

## 单位约定（防混淆）

| 字段 | 单位 | 示例 |
|------|------|------|
| `OrderDeposit.amount` | PHP 元（浮点） | `100.00` |
| `OrderDeposit.creditedCents` | PHP 分（整数） | `10000` |
| `OrderWithdraw.amount` | PHP 分（整数） | `10000` |
| `WalletRecord.available` | PHP 分（整数） | `10000` |
| `LedgerEntry.amount` | PHP 分（整数） | `10000` |
| `creditWallet(cents)` | PHP 分（整数） | `10000` |

> **规则**：所有钱包/账变操作统一使用分（cents）。`OrderDeposit.amount` 是历史遗留的 PHP 元字段，仅用于对账展示，不直接用于入账计算。
