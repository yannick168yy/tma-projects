# 聚合商接入面（P3-8）

现状：**单聚合商**（win568 / `aggregator_id = '568win'`）。

这份文档不是接口设计稿，是**从现有代码里描出来的实况清单**：第二家聚合商真要接进来时，
下面每一项都得有对应实现，或者明确说清「这家没有这个概念、怎么替代」。

## 为什么没有先做 provider 接口层

只有一个实现时设计出来的抽象，会把这一家的假设焊进接口里 —— 而这些假设恰恰是各家差别最大的地方：

| 假设 | win568 的做法 | 第二家很可能不一样 |
|---|---|---|
| 幂等键 | `transfer_code` + 可选 `transaction_id`，拼成 `provider_txn_id` | 单一 txn id / 复合键 / 只有请求序号 |
| 余额模型 | 单一钱包，转账制（transfer wallet） | 无缝钱包（seamless），每次下注回调扣款 |
| 结算时机 | 下注与派彩分两条回调，可跨天 | 一条回调带最终输赢 |
| 作废 | `voided_at` 标记，金额保留 | 反向冲正单 |
| 密钥 | CompanyKey + 定期轮换 | 静态 API key / 签名对 |

改造面还落在最贵的地方：注单入库与钱包扣加（`win568-wallet.service.ts` 891 行）。
在只有一家的情况下重构它，收益是「看起来可扩展」，风险是「钱算错」。

**判断该不该抽象的标准：等第二家的接口文档在手，把两家的差异摆在一起，才知道抽在哪一层。**

## 这次做了什么（把缝留出来）

1. `aggregator_id` 的取值集中到 `lib/aggregators.ts`（bff-node 与 core-node 各一份，
   值必须一致 —— 它落在 `bg_bet_order.aggregator_id` 列上，两边写的值不一样会静默查不到数据）
2. 两个服务里 28 处 `'568win'` 字面量全部改为引用常量。
   **第二家接入时 grep `DEFAULT_AGGREGATOR` 就是「需要按聚合商分流」的完整清单**
3. SQL 里用模板插值而不是新增占位符：那几条查询的参数数组很长（VIP 负盈利那条十几个参数），
   重新编号是最容易埋 bug 的改法；插的是联合类型的编译期常量，不是入参，没有注入面

## 第二家要实现的能力（按现有代码逐项）

### 1. 玩家开号 / 账号映射
- 表：`bg_aggregator_player`（`aggregator_id` + `external_username` + `currency` → 本地 user）
- 代码：`core-node/src/routes/win568-operation.routes.ts`
- 要点：一个玩家在不同币种下可能是不同的上游账号；开号失败要能重试且不产生重复映射

### 2. 起游戏（launch）
- 代码：`bff-node/src/routes/slots.routes.ts` → `win568` 起游戏 URL
- 要点：URL 带币种与语言；上游维护中的游戏要能提前拦住而不是让玩家进去白屏

### 3. 钱包回调（最贵的一块）
- 代码：`core-node/src/services/win568-wallet.service.ts`、`routes/callback.routes.ts`
- 现有五个动作：余额查询、下注、派彩、作废、退款
- 每个动作都要：幂等（按 `provider_txn_id` 唯一键）、事务内改钱包与写注单、
  失败要让上游能安全重试
- 落库：`bg_568win_wallet_txn`（上游原始流水）+ `bg_bet_order`（本地账变）+
  `bg_bet_round`（每局预聚合，前台注单页与后台报表都读它）
- 🔴 第二家的表**不要**塞进 `bg_568win_*`：那些表名带家名是对的，
  原始流水的字段形状本来就跟着上游走

### 4. 游戏目录同步
- 代码：`core-node/src/cron/win568-game-sync.cron.ts`、`bff-node/src/services/sg-game.service.ts`
- 要点：游戏 uuid 形如 `568win:<gpid>:<gameId>`，前缀就是聚合商 ——
  第二家用自己的前缀，`sg-game.service.ts` 里的解析要按前缀分流
- 附带：厂商名规范化（`win568-provider-canon.ts`）、图标探测（`game-icon-probe.service.ts`）

### 5. 密钥轮换
- 代码：`core-node/src/cron/win568-key-rotation.cron.ts`、`services/win568-key-settings.service.ts`
- 要点：租户化后密钥来自 `pf_tenant_provider` 下发到租户库的 `bg_admin_settings`（P1-5）；
  第二家若无轮换机制，这一步就是空实现，但**不要**因此把轮换从接口里删掉

### 6. 对账与报表
- `bg_568win_report_bet`（上游报表拉取）、`bi_daily_provider`（按厂商日聚合）
- 计费（P2）读的是 `bi_daily_platform`，与聚合商无关 —— 这一层不用改

## 接入检查清单

- [ ] `AGGREGATOR_IDS` 加上新家，两个服务的常量文件同步
- [ ] grep `DEFAULT_AGGREGATOR`，逐处判断该按聚合商分流还是保持默认
- [ ] 新家的原始流水表独立命名（不复用 `bg_568win_*`）
- [ ] 游戏 uuid 前缀与解析分流
- [ ] 钱包回调五个动作的幂等键设计写进本文档
- [ ] 跨聚合商的注单页/后台报表：`bg_bet_round` 的 JOIN 要按 `aggregator_id` 分流到对应流水表
- [ ] 一轮完整回归：下注 → 派彩 → 作废 → 退款 → 洗码 → 负盈利返水 → 团队佣金
      （这些都读 `bg_bet_order`，口径错了会一路错到佣金）
