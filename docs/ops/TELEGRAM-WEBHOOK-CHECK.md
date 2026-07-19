# Telegram Webhook 自检（Ammer / 充值入账）

BFF 入账接口：**`POST https://www.188facai.com/api/v1/webhooks/telegram`**

用户支付成功后，Telegram 向该 URL 推送 `successful_payment`；BFF 据此完成充值单入账。

---

## 1. 你怎么确认「路径对不对」

在浏览器或本机执行（**不会暴露 Token** 的查法）：

```bash
curl -s "https://www.188facai.com/api/v1/webhooks/telegram" \
  -X POST -H "Content-Type: application/json" -d '{}'
```

- 若返回 JSON（如 `handled: false` 或 200），说明 **Nginx → BFF 路径通**。
- 若 502/404，说明反代或 BFF 未就绪，先修部署。

路径无需你再选：仓库已固定为 **`/api/v1/webhooks/telegram`**（见 `apps/bff-node/src/routes/webhook.routes.ts`）。

---

## 2. 你怎么确认「setWebhook 是否已配置」

在**服务器**上（能读到 `.env` 里 `TELEGRAM_BOT_TOKEN`）：

```bash
cd /opt/tma-projects
set -a && source .env && set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

看返回 JSON 里的 `result.url`：

| `result.url` | 含义 |
|--------------|------|
| `https://www.188facai.com/api/v1/webhooks/telegram` | ✅ 已配置正确 |
| 空或别的 URL | ❌ 未配置或配错 |

**2026-05-24 生产检查结果**：`url` 为空 → **尚未 setWebhook**，支付成功后不会自动入账，需执行下一步。

---

## 3. 如何配置 setWebhook（一次性）

仍在服务器上：

```bash
cd /opt/tma-projects
set -a && source .env && set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://www.188facai.com/api/v1/webhooks/telegram"
```

成功时返回 `"ok":true`。再跑一遍 `getWebhookInfo` 确认 `url`。

---

## 4. 配置前检查清单

- [ ] `TELEGRAM_BOT_TOKEN`、`AMMER_PAY_PROVIDER_TOKEN` 已在生产 `.env`
- [ ] `https://www.188facai.com/api/v1/health` 正常
- [ ] 宝塔 Nginx 已反代 `/api/` → `127.0.0.1:3000`（`deploy/single-node/nginx-bff-proxy.conf`）
- [ ] 前端创建充值单后能用 **createInvoiceLink** 调起支付（研发项）

---

## 5. 测试支付后如何确认入账

1. 在 Mini App 发起一笔 **Test** 环境小额充值  
2. 支付完成后，查库：

```bash
podman exec tma-mysql mysql -utma -p'<密码>' betogo \
  -e "SELECT id, status, amount_cents FROM bg_deposit_order ORDER BY id DESC LIMIT 5;"
```

3. 或看 BFF 日志：`podman logs tma-bff-node --tail 50`
