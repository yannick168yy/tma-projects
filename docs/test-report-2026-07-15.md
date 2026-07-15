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

---

# 第 2 轮 · 造场景深度测试（已授权写测试库）

> 已打通 SSH→tma-mysql 通道，DB 密码全程留服务器端不落本地。所有测试数据**用后即删**，收尾核对：仅剩 admin 账号、无残留测试流水/名单。

## 六、风控名单 403（DB 造场景，端到端）✅

| 编号 | 用例 | 结果 | 证据 |
|---|---|---|---|
| RISK-001 | 名单命中拦登录 | ✅ | 插 `bg_risk_blacklist(user,BG-10002)` → 登录 HTTP 403；命中日志 `login/blacklist_user/deny` |
| RISK-002 | 名单命中拦领取 | ✅ | 同名单下 checkin/claim、spin/draw 均 403；命中日志 `promo_claim/blacklist_user/deny`×2 |
| RISK-005 | 影子模式 | ✅ | `bg_risk_policy`：bonus_abuse/multi_account 均 action=`tag_only`（仅日志不拦） |
| RISK-012 | 异常兜底/解除恢复 | ✅ | 删名单后登录立即恢复 200；旧会话在拉黑期间 /user/me 仍 200（名单只在动作点拦，不校验会话，符合设计） |
| RISK-010 | 策略修改需 super_admin | ✅ | finance 账号 PUT `/admin/risk/policies` → body.code=403「仅超级管理员可修改风控策略」；super_admin 同请求 code=0 |

## 七、RBAC 角色越权（建 finance 子账号）✅

| 编号 | 用例 | 结果 | 证据 |
|---|---|---|---|
| ADM-003 | 角色越权 | ✅ | finance 打 op-password POST / system-params PUT / risk-policies PUT 均 body.code=403，附专属文案；读类接口(用户列表/op-password GET)正常 200 |

## 八、激励计算（DB 造流水）✅

| 编号 | 用例 | 结果 | 证据 |
|---|---|---|---|
| VIP-001/升级 | VIP 9 级判级 | ✅ | 阈值表 LV1-9=0/1k/5k/20k/60k/150k/400k/1M/3M；插 6000 流水 → `/vip/progress` level=3、next=20000 |
| RB-005 | 洗码等级联动 | ✅ | 同流水下 `/rebate/progress` level=3（与 VIP 一致，每币种独立账） |

## 九、第 2 轮新发现（配置漂移 + API 契约，均非缺陷）

1. **提现名单动作 = escalate 非 deny**：线上 `bg_risk_policy` 中 withdraw 的 blacklist_* 配成 **escalate（转人工）**，login/promo_claim 才是 deny。
   → 用例 **RISK-003** 原写"withdraw 403"是代码默认值；**线上实为转人工放行**。建议按线上口径修订 RISK-003 预期为「escalate 进人工队列」。
2. **授权失败的 HTTP 码 = 400（body.code=403）**：`requireRole` 用 `fail(ctx,403)`，但 HTTP status 走默认 **400**、仅 body.code=403（代码注释明确"与替换前行为一致"）。
   → 前端/自动化若按 HTTP status 判断权限会看到 400。用例里 super_admin 越权类的"403"应理解为 **body.code=403 / HTTP 400**。

## 十、累计进度

| 类别 | 已验证 | 备注 |
|---|---|---|
| 🤖 只读+行为+造场景 | **~58 条** | 本文覆盖，0 真实缺陷，2 处配置/契约提示 |
| ⏳ 待造场景（剩余） | 负盈利返水完整计算、洗码每日结算、VIP 降级(季度cron)、提现规则命中 | techniques 已验证可行，按需继续 |
| 🔒 待你配合 | 多币种(USDT钱包已授权可加)、充值/提现/下注(sandbox)、短信/KYC/真机 | — |

---

# 第 3 轮 · 充值后深度测试（BG-10002 已有 500 PHP + 500 USDT）

## 十一、多币种独立账（CUR-*）✅

| 编号 | 用例 | 结果 | 证据 |
|---|---|---|---|
| CUR-001 | VIP/任务/洗码按币种独立 | ✅ | PHP VIP 与 USDT VIP 各自独立账（USDT lv1）；`/tasks?currency=USDT`、`/rebate/progress?currency=USDT` 均按币种返回 |
| CUR-002 | 负盈利门槛按币种 | ✅ | USDT 负盈利 minDeposit=5、PHP=200（各币种独立配置） |
| LEDGER-001 | 账变入账记录 | ✅ | 500 PHP + 500 USDT 充值为 `admin_adjust` 类型账变，各一条，余额快照正确 |

## 十二、提现闸门（WD-*，均拒绝类不出款）✅

| 编号 | 用例 | 结果 | 证据 |
|---|---|---|---|
| WD-001 | 未 KYC 提现被拒 | ✅ | tg_wallet 与 matrix 两通道 POST 均 body.code=403 `errors.kycRequired` |
| WD-002 | 流水闸门可见 | ✅ | `GET /withdrawals/eligibility` 返回 turnoverOk=false、rejectReasons=["KYC not approved","Turnover requirement not met"] |
| WD-005 | 闸门顺序 | ✅ | 超额提现仍先撞 KYC（403 kyc）→ 证实 **KYC > 流水 > 余额** 闸门顺序，KYC 为最外层 |

> 附注：法币提现当前仅支持 `channelId=tg_wallet`+PHP；最低提现额 ₱10,000。

## 十三、负盈利返水完整计算（旗舰 P0，DB 造 3 表）✅

构造 `bg_bet_order`(bet 1000 / win 200，同 round，slots) + `bg_turnover_logs`(关联 slots) + `bg_deposit_order`(paid)，验证 C 端 `/vip/loss-rebate-status` 计算：

| 编号 | 验证点 | 结果 | 证据 |
|---|---|---|---|
| NLR-004 | 净输=白名单品类 bet−win | ✅ | netLoss=800（1000−200，经 slots round EXISTS 命中） |
| NLR-005 | 存款窗口按币种累计 | ✅ | windowDeposit=500（仅 PHP 币种 paid 存款；USDT 不混入） |
| NLR-006 | 净存款封顶（min 取小） | ✅ | 存款≥净输时 base=800→返水 **56.00**；删存款使 500<800 时 base=500→返水 **35.00**，精确命中 min(netLoss,dep)×7% |
| NLR-001/002 | 预览与原因流转 | ✅ | eligible→no_loss 随数据正确切换 |

> 全部测试数据用后即删；收尾核对：你的 500 PHP + 500 USDT 真实存款完整保留，负盈利预览回落 no_loss，无残留。

## 十四、累计进度（截至第 3 轮）

| 类别 | 已验证 | 说明 |
|---|---|---|
| 🤖 全技术类 | **~72 条** | 只读/行为/安全/风控场景/RBAC/计算场景/多币种/提现闸门/负盈利全链路，**0 真实缺陷** |
| ⏳ 剩余造场景 | 洗码每日结算(cron)、VIP 季度降级、提现规则命中(大额/篡改/对账) | 方法同 NLR，可续 |
| 🔒 待你配合 | 真实下注一局(注单/流水口径 BET-001/GAME-011)、KYC 通过后真实出款(WD-003)、短信/真机 | — |
