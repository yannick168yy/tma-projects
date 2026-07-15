# BETOGO 实测报告 · 2026-07-15（第 1 轮）

> 环境：`https://www.188facai.com`（47.84.34.139）。测试账号：**BG-10002**（+639471528796）。
> 手段：curl/Python 打 `/api/v1` + admin token（super_admin）。全部对照 [test-cases.md](test-cases.md) 用例编号。
> 本轮聚焦 🤖 用例中**无需写库、无需真实资金**的部分：鉴权闸门、只读接口结构、配置在线、伪造回调拒绝、参数化防注入、可逆行为。

## 一、结论速览

| 验证深度 | 数量 | 说明 |
|---|---|---|
| ✅ 完整行为验证 | 12 | 断言了真实行为（拦截/拒绝/持久化/一致性），非仅连通 |
| ✅ 结构/在线验证 | 35 | 接口存在、返回字段结构正确、后台配置在线；业务计算待造场景 |
| ⏳ 待造场景（DB 写） | — | 负盈利/VIP 升降级/洗码结算/风控 403/提现规则命中，需写测试流水/名单 |
| 🔒 待你配合 | — | 充值/提现/下注/短信/KYC/真机（🤝/👤 类） |

**本轮 0 个真实缺陷**。发现 1 个配置漂移（见第四节）。

## 二、完整行为验证（12）

| 编号 | 用例 | 结果 | 证据 |
|---|---|---|---|
| STAB-001 | 后台未登录拦截 | ✅ | 无 token `/admin/users` → HTTP 401 |
| ADM-004 | C 端未登录拦截 | ✅ | 无 token `/user/me` → HTTP 401 |
| SEC-005 | 令牌域隔离 | ✅ | admin token 打 `/user/me` → 401；响应无 password/hash 字段 |
| AUTH-012 | 会话恢复 | ✅ | `/user/me` 返回 id=BG-10002 / phone=+639471528796 |
| DEP-001 | 渠道列表 | ✅ | `/payment/channels` = [maya, gcash]，均含 min/max（100~800） |
| PROMO-001 | 活动列表仅开启 | ✅ | `/promotions` 仅返回 trial、firstdep（已开启项） |
| LEDGER-002 | 余额一致性 | ✅ | `/wallet/balances` 与 `/wallet/summary` 的 PHP 余额完全一致 |
| SEC-004 | 回调坏签拒绝 | ✅ | 伪造 sign POST `/webhooks/yfpay` → HTTP 403 "invalid sign" |
| DEP-005 | 回调缺签拒绝 | ✅ | 无 sign 回调 → HTTP 403，订单不受影响 |
| I18N-001 | 语言持久化 | ✅ | PATCH locale=vi → `/user/me` 读回 vi；还原 en 成功 |
| SEC-002 | 参数化防注入 | ✅ | 后台搜索注入 `' OR '1'='1` → 200 且命中 0 条，未脱库 |
| — | 服务商余额记账 | ✅ | `/admin/payment/{balance,accounting}` 返回真实聚合 |

## 三、结构/在线验证（35，接口+字段+配置在线）

**C 端新模块**（全部 HTTP 200、字段结构符合用例预期）：

| 编号 | 接口 | 关键证据 |
|---|---|---|
| VIP-001 | `/vip/levels`·`/vip/progress` | **共 9 级**，LV1 阈值 0、LV2 阈值 1000 ✓ |
| VIP-011 | `/vip/rewards` | 空号返回 `rewards:[]`（结构正确） |
| NLR-001/002 | `/vip/loss-rebate-status` | 字段齐全；空号 netLoss=0→potentialRebate=0 reason=no_loss ✓ |
| RB-001/002 | `/rebate/progress`·`/rebate/config` | 9 个大类费率矩阵、阈值在线 |
| TASK-001 | `/tasks` | 四区齐全：newbie/daily/achievement/social ✓ |
| CKIN-001/007 | `/promotions/checkin/status`·`/spin/status` | 签到 enabled；签到转盘三档 starter/premium/elite 齐 ✓ |
| SPIN-001 | `/spin/status` | enabled=true，depositRules 在线 |
| TEAM-001 | `/promotions/team/status` | 三级费率 0.35/0.1/0.05 ✓ |
| CS-001 | `/cs/welcome` | 欢迎语在线（Kaya AI） |

**后台**（全部 200、结构正确）：ADM-010 用户列表、ADM-020 存/取款记录、ADM-030 待审队列、ADM-021 渠道(10)、ADM-023 服务商余额/记账、ADM-040 游戏列表、ADM-046 投注订单(带 stats)、ADM-050 活动配置(trial/firstdep/appdl/**redep/lossRebate**)、ADM-052 转盘配置、ADM-053 洗码配置(带阈值)、ADM-054 首页装修(banners/cards/walletBanners)、ADM-076 审计日志、ADM-077 dashboard+徽章、VIP-014 权益配置(按币种)、**RISK-009/010/005 风控中心全套在线**(overview/users/policies/hits)、FP-002 指纹查询(BG-10002 返回 accounts+logs)、ADM2-003 厂商 stats(136 家)、CKIN/TASK-019 后台配置在线。

## 四、发现：配置漂移（非缺陷，需知悉）

- **负盈利返水线上实配 ≠ 代码默认**：线上 `ratePct=7%`、`minDeposit=200`、`windowDays=7`；代码默认是 5%/50。
  用例 NLR-003 措辞"默认 5%、后台可改"已覆盖此情况，**结论：以后台实配为准，逻辑正常**。属 [[reference_live_schema_drift]] 同类现象，记录备查。

## 五、下一步（待你拍板）

要把 ⏳/🔒 那批也测掉，需要以下配合或授权：

1. **造场景（DB 写测试数据）**：负盈利返水计算、VIP 升/降级、洗码结算、风控名单 403、提现规则命中——需我往测试库 `tma-mysql` 写少量测试流水/存款/名单记录来触发。**是否授权我写测试库？**
2. **多币种**：本账号只有 PHP 钱包（余额 0）。测 CUR-* 需要一个 USDT/USDC 钱包——我可用后台给 BG-10002 加币种钱包+调余额。
3. **额外后台账号**：RISK-010/ADM-003 越权测试需一个 finance/ops 角色账号（我可用 super_admin 建）。
4. **资金主链路（sandbox）**：充值→下注→提现，需你在收银台/游戏里点一下触发，我验回调与落库。
