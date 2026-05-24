# Ammer Pay / Telegram 支付接入清单

BetoGo 使用 **Telegram Bot Payments + Ammer Pay** 作为 Provider（非独立 HTTP「Ammer Webhook」为主路径）。入账以 **Telegram `successful_payment`** 为准。

## 你需要完成的配置

### 1. BotFather + Ammer Merchant Hub

| 步骤 | 操作 |
|------|------|
| 1 | [@BotFather](https://t.me/BotFather) → 你的 `@BetoGoBot` → **Payments** |
| 2 | 选择 **Ammer Pay** → **Connect Ammer Pay Live** |
| 3 | 复制 **Provider Token**（形如 `6073714100:TEST:...` 或 Live token） |
| 4 | 在 [Ammer Merchant Hub](https://merchants.ammer.io/) 创建 **Telegram** 销售渠道，填入 Bot Token、**Gateway Secret** |
| 5 | 配置收款 **Ammer Card** 号 |

文档：https://ammer-tech.github.io/AmmerPayBotDocumentation/

### 2. 写入 Nacos（已支持字段）

在 namespace `batogo` → `bff-node`：

```properties
AMMER_PAY_PROVIDER_TOKEN=<Provider Token from BotFather>
TELEGRAM_BOT_TOKEN=<Bot Token>
USDT_TO_PHP_RATE=58
```

本地：`./scripts/publish-nacos-config.sh`（读取 `.env`）

### 3. 设置 Telegram Webhook

BFF 已实现：`POST /api/v1/webhooks/telegram`

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://www.188facai.com/api/v1/webhooks/telegram"
```

确保 Nginx 将 `/api/` 反代到 `bff-node:3000`。

### 4. 前端调起支付（待接）

创建充值单后，需用 Bot API **`createInvoiceLink`** 或 **`sendInvoice`**：

- `provider_token` = `AMMER_PAY_PROVIDER_TOKEN`
- `currency` = **`PHP` only**（Telegram Bot API 不接受 `USDT`；用户选 USDT 时 BFF 按 `USDT_TO_PHP_RATE` 折算成 PHP 账单，入账仍按订单币种）
- `payload` = 充值单 `orderId`（BFF 已写入 `invoice_payload`）

用户支付成功后，Telegram 推送 `successful_payment` → Webhook 入账。

### 5. 你需要提供给研发/运维的信息

| 项 | 说明 |
|----|------|
| Provider Token | BotFather Payments 里 Ammer Pay 的 token |
| Gateway Secret | Merchant Hub 销售渠道配置（若与 token 不同） |
| 环境 | Test / Live |
| 支持币种 | PHP、USDT 是否已在 Ammer 开通 |
| Webhook 公网 URL | `https://www.188facai.com/api/v1/webhooks/telegram` |

## BFF 当前行为

| 环境 | 充值 |
|------|------|
| 开发 `NODE_ENV !== production` | 创建订单后 **自动到账**（无 TG 支付） |
| 生产 | 依赖 **Webhook**；未配置 Webhook 前不会自动入账 |

## 参考

- [Ammer Pay Telegram Bot 文档](https://ammer-tech.github.io/AmmerPayBotDocumentation/)
- [Telegram Bot API — Payments](https://core.telegram.org/bots/api#payments)
