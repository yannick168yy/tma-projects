# 数据库分表 / 冷热分离方案（规划稿，未实施）

编写时间：2026-08-01
背景：`bg_bet_order`、`bg_wallet_ledger` 已到 60 余万行，其余表同步增长，当前无任何分区/分表。

---

## 0. 结论先行

**现在不要做分表，也不要做分区。** 60 万行对 MySQL 8 单表是"小表"级别，
生产 buffer pool 8G（`deploy/single-node/env-aws-16g.sh`）装得下全部热表。
此时上分区/分表，收益是 0，成本是唯一键约束退化 + 全部资金查询代码改造 —— 纯亏。

**但真正的约束不是行数，是磁盘。** 2026-08-01 生产实测（第 1 节）：
全库 10 天涨了约 2.9GB，日增约 290MB，根分区剩余 58GB —— **约 6~7 个月写满**。
其中 `bg_568win_report_bet` 一张表就占 2GB（日增约 200MB），是全库增量的 70%。

优先级因此调整为：**P0 索引（已完成）→ 立刻处理 `bg_568win_report_bet` 的 JSON 膨胀
→ 再谈归档/分区**。按行数触发的分表阈值排在磁盘问题之后。

---

## 1. 生产实测数据（2026-08-01）

主机 13.213.107.231，MySQL 8.0.46，根分区 96G / 已用 39G / 剩余 58G，buffer pool 8G。
`bg_bet_order` 最早一行是 2026-07-22 —— **下面所有体量都只是 10 天累积出来的**。

| 表 | 行数 | 数据 MB | 索引 MB | 合计 MB | 日增行 |
|---|---:|---:|---:|---:|---:|
| `bg_568win_report_bet` | 341,728 | 2024 | 41 | **2065** | ~5 万 |
| `bg_568win_wallet_txn` | 318,168 | 193 | 107 | 300 | ~5 万 |
| `bg_wallet_ledger` | 632,767 | 103 | 160 | 263 | **~10 万** |
| `bg_bet_order` | 603,318 | 108 | 139 | 247 | **~10 万** |
| `bg_bet_round` | 240,872 | 43 | 47 | 89 | ~4 万 |
| `bg_bet_round_bak_20260731` | 224,225 | 44 | 0 | 44 | 残留备份，可删 |
| `bg_turnover_logs` | 162,505 | 15 | 12 | 27 | ~3 万 |

推算（按当前增速线性外推）：

| 里程碑 | 到达时间 |
|---|---|
| `bg_bet_order` / `bg_wallet_ledger` 到 500 万行 | 约 50 天 |
| 同上到 2000 万行 | 约 7 个月 |
| **根分区写满（日增 290MB / 剩 58GB）** | **约 6~7 个月** |

另外两项生产现状：
- `performance_schema` = OFF，`slow_query_log` = OFF —— 目前**没有任何查询耗时观测能力**，
  出问题只能靠事后 EXPLAIN 猜。`slow_query_log` 是动态变量，可热开不重启。
- `bg_bet_round_bak_20260731` 是 55e087f/6406c67 那次 bonus 回填留下的备份表，占 44MB，确认后可删。

---

## 2. 表分级

按"增长驱动因素"分四类，只有第 1 类需要拆：

### 类 A：随投注量线性增长（必须规划拆分）
| 表 | 每局产生行数 | 说明 |
|---|---|---|
| `bg_bet_order` | 2~4（bet/win/refund/cancel） | 核心注单账变 |
| `bg_wallet_ledger` | 2~3 | 资金账本，另含存提/彩金 |
| `bg_568win_wallet_txn` | 1~2 | 上游 seamless wallet 交易 |
| `bg_568win_report_bet` | 1 | **含 `raw_bet`/`raw_response` 两个 JSON，单行最大，磁盘增长最快** |
| `bg_turnover_logs` | 1（每 bet 行） | 流水明细 |
| `bg_turnover_allocations` | 1~N（每条 log × 命中要求数） | 流水分配 |
| `bg_bet_round` | 1 | 按局汇总（派生表） |

### 类 B：随用户活动增长（可分区，可直接删）
`bg_login_log`、`bg_risk_hit_log`、`bg_capi_event`、`bg_game_session`、`cs_message`、
`bg_spin_record`、`bg_checkin_log`、`bg_task_claim`、`bg_promo_claim`、`tg_broadcast_fail`

### 类 C：TTL 表（不分区，定时清理即可）
`bg_idempotency`（有 `expires_at`）、`bg_session`（应迁 Redis）

### 类 D：不拆（随用户数或配置增长）
- 用户维表：`bg_user`、`bg_wallet`、`bg_user_vip_state`、`bg_user_identity`、`bg_kyc`、`bg_team_node`、`bg_user_attribution`
- 订单表：`bg_deposit_order`、`bg_withdraw_order`、`bg_matrix_*`（笔数比注单低 2~3 个数量级）
- 配置/字典：`sg_games`、`bg_568win_game`、`bg_promo_config`、`bg_admin_settings`、`payment_channels`
- BI 聚合：`bi_daily_*`、`bi_user_active_day`（本身就是压缩层，到千万行再按 `stat_date` 年分区）

---

## 3. 拆分策略：为什么"归档"优于"原生分区"

MySQL 原生分区有一条硬约束：**分区键必须包含在每一个唯一键（含主键）里**。
类 A 的表全都栽在这条上，而且代价是资金安全：

| 表 | 现唯一键 | 按 `created_at` 分区后 | 后果 |
|---|---|---|---|
| `bg_bet_order` | `uk_provider_txn(aggregator_id, provider_txn_id)` | 必须加 `created_at` | 上游回调幂等键**退化为分区内唯一**，跨月边界的重复回调会双重入账 |
| `bg_turnover_logs` | `uk_bet_order(bet_order_id)` | 必须加 `created_at` | 同一笔注单可被**重复计入流水**，直接影响提现流水校验 |
| `bg_568win_wallet_txn` | `uk_transfer_txn(transfer_code, transaction_id)` | 同上 | 同上 |
| `bg_wallet_ledger` | PK `id VARCHAR(40)` | PK 改 `(id, created_at)` | 账本行 ID 全局唯一性丢失 |

外键也必须全部删除（`fk_bet_user`、`fk_ledger_user`、`fk_568win_txn_user`、`fk_gs_user`、`fk_session_user`），
分区表不支持 FK。

**因此类 A 采用冷热分离归档，而不是原生分区**：
- 热表结构与唯一键 **完全不变**，幂等/防重保护 100% 保留；
- 归档表 `xxx_archive` 结构相同，只保留主键（去掉业务唯一键与外键），是只读表；
- 搬迁按 `created_at` 边界批量 `INSERT ... SELECT` + `DELETE`，可随时中断续跑；
- 读路径：默认只查热表，用户/后台要看更早数据时显式查归档（或 `UNION ALL`）。

**类 B 用原生 RANGE 分区**：这些表没有跨行唯一约束（`bg_capi_event` 的 `uk_platform_event` 除外，
它的幂等窗口只有几秒，退化可接受），按月分区后过期直接 `ALTER TABLE ... DROP PARTITION`，
毫秒级，不产生 `DELETE` 的 undo 与主从延迟。

---

## 4. 阶段路线与触发阈值

时间列按第 1 节的实测增速外推，不是拍脑袋估的。

| 阶段 | 触发条件 | 预计到达 | 动作 |
|---|---|---|---|
| **P0** | 现在 | — | ✅ 补 `bg_bet_order.idx_created`（191）；待办：时间窗聚合改走 `bi_daily_*`、类 C 定时清理、开慢查询日志 |
| **P1** | 磁盘剩余 < 40GB | **约 2 个月** | `bg_568win_report_bet` JSON 降冷（单表就是全库增量的 70%）；删 `bg_bet_round_bak_20260731` |
| **P2** | 单表 ≥ 2000 万行 | **约 7 个月** | 类 A 启动归档，热表按第 5 节保留期滚动；类 B 上 RANGE 月分区 |
| **P3** | 单表 ≥ 1 亿行 或 单机写入/IOPS 触顶 | 约 2.5 年 | 才考虑真正的分库分表（第 7 节），此前一律不上 |

P1 的触发条件从"行数"改成了"磁盘"——因为按实测，磁盘会比行数先到红线。
若磁盘先扩容（EBS 在线扩容，无停机），P1 可整体后移，但 `bg_568win_report_bet` 的
JSON 降冷仍然该做：2GB 里绝大部分是对账用不到的原文。

---

## 5. P0：现在就该做的（不涉及分表）

### 5.1 缺失索引（已完成，迁移 191）
`bg_bet_order` **没有 `created_at` 单列索引**（`158_bi_user_daily.sql` 给 `bg_login_log`、
`bg_wallet_ledger`、`bg_deposit_order`、`bg_withdraw_order`、`bg_568win_wallet_txn` 都补了，唯独漏了它）。
而以下查询全是按纯时间窗扫全表：
- `rebate.service.ts` 每日返水：`WHERE created_at >= ? AND created_at < ? GROUP BY user_id, currency_code`
- 亏损返水的 `EXISTS` 子查询：`bb.user_id = bo.user_id AND bb.round_id = bo.round_id`
- `bi-aggregate.service.ts` 日聚合

生产 EXPLAIN 实证（加索引前）：`type=ALL`、`possible_keys=NULL`、`rows=601337`，
实测每日返水聚合 0.23s。按日增 10 万行外推，3 个月后同一条查询要 10s 以上。

已落地 `191_bet_order_created_index.sql`：
```sql
CREATE INDEX `idx_created` ON `bg_bet_order` (`created_at`) ALGORITHM=INPLACE LOCK=NONE;
```
测试环境验证：`type: ALL` → `type: range`，`key: idx_created`。

**只加了这一个**，另外两个候选经核对后否掉：
- `(created_at, bet_type, status)`：返水查询 `GROUP BY user_id` 覆盖不到，不解决问题；
- `(settled_at)`：`withdraw-review.service.ts:613` 那条按 `settled_at` 归期的查询
  是 `WHERE user_id = ? AND status='settled'`，走 `idx_user_created` 前缀即可。

注单表日写入 10 万行，每多一个索引都是常态写放大，不加没用的。

### 5.2 把历史聚合从原表移走
`bi_daily_user` / `bi_daily_platform` 已经存在，方向是对的。凡是查询窗口 > 当日的聚合
（代理 GGR、返水统计、BI 报表、`agent.routes.ts` 里那个对每个用户跑两个标量子查询的分页），
一律改读 `bi_daily_*`。只有"当日实时"才允许打原表。
这一步做完，类 A 表的读压力基本清零，P2 会被推后很久。

**另有一处同类问题**：`rebate.service.ts` 有三处（约 409 / 573 / 652 行）在跑
`SELECT user_id, currency, SUM(effective_amount) FROM bg_turnover_logs WHERE is_reversed = 0 GROUP BY user_id, currency`
—— 无时间下界的**全表** GROUP BY。而 `151_turnover_total_accumulator.sql` 已经为此
在 `bg_user_vip_state` 加了 `turnover_total` 累加列（写侧事务内增量维护），
只是这三处批处理路径没跟着改。该表日增约 3 万行，现在 16 万行还看不出来，
半年后是 500 万行的全表扫。

### 5.3 类 C 清理
- `bg_idempotency`：定时 `DELETE FROM bg_idempotency WHERE expires_at < NOW() - INTERVAL 7 DAY LIMIT 5000` 循环
- `bg_session`：Redis 已在用，MySQL 这张表若无实际读路径应废弃；否则按 `expires_at` 定时清

### 5.4 后台分页 `COUNT(*)`
`admin/bet-orders.routes.ts`、`admin/ledger.routes.ts` 每次分页都跑一次全条件 `COUNT(*)`。
数据量再大一个量级后这会是最先卡死的地方。改法：只在第 1 页算总数并缓存，或改为
"是否有下一页"（`LIMIT pageSize+1`）。

### 5.5 打开查询观测
生产 `performance_schema` 和 `slow_query_log` 全是 OFF，等于没有任何慢查询证据链。
`slow_query_log` 是动态变量，热开不重启：
```sql
SET GLOBAL slow_query_log = 1;
SET GLOBAL long_query_time = 1;
```
（`performance_schema` 需重启才能开，且吃内存，可以先不动。）

---

## 6. P1/P2 明细方案

### 6.1 类 B：RANGE 月分区（P2）

统一模板（以 `bg_login_log` 为例）：
```sql
ALTER TABLE bg_login_log
  DROP PRIMARY KEY, ADD PRIMARY KEY (id, created_at),
  PARTITION BY RANGE COLUMNS(created_at) (
    PARTITION p202608 VALUES LESS THAN ('2026-09-01'),
    PARTITION p202609 VALUES LESS THAN ('2026-10-01'),
    ...
    PARTITION pmax    VALUES LESS THAN (MAXVALUE)
  );
```
配一个月度任务：`REORGANIZE PARTITION pmax` 新增下月分区 + `DROP PARTITION` 删过期。

| 表 | 分区键 | 保留期 | 备注 |
|---|---|---|---|
| `bg_login_log` | `created_at` | 12 个月 | |
| `bg_risk_hit_log` | `created_at` | 12 个月 | 风控举证周期 |
| `bg_capi_event` | `created_at` | 6 个月 | `uk_platform_event` 需加 `created_at`，幂等窗口极短，可接受 |
| `bg_game_session` | `started_at` | 3 个月 | 需先删 `fk_gs_user` |
| `cs_message` | `created_at` | 24 个月 | 客诉证据链，别删太早 |
| `bg_spin_record` / `bg_checkin_log` | `created_at` | 24 个月 | 涉及奖品发放，保守些 |
| `tg_broadcast_fail` | `created_at` | 3 个月 | |

### 6.2 `bg_568win_report_bet`（P1，优先级最高）

这张表存了上游注单的完整 JSON 原文，行宽是其他表的 10 倍以上。
两步走，**不用分区**：
1. 冷数据 JSON 置空：`UPDATE ... SET raw_bet = NULL, raw_response = NULL WHERE order_time < now-90d`
   （对账只需要结构化列；原文若有留存要求，先落对象存储/日志归档）
2. 仍然过大则整行归档到 `bg_568win_report_bet_archive`，按 `order_time` 切。

### 6.3 类 A：冷热归档（P2）

| 表 | 归档键 | 热表保留 | 归档表 |
|---|---|---|---|
| `bg_bet_order` | `created_at` | 6 个月 | `bg_bet_order_archive` |
| `bg_wallet_ledger` | `created_at` | 12 个月 | `bg_wallet_ledger_archive` |
| `bg_bet_round` | `first_at` | 6 个月 | 与 `bg_bet_order` 同步切 |
| `bg_turnover_logs` | `created_at` | 与 `bg_bet_order` 一致 | 必须与注单同批搬，否则 `bet_order_id` 悬空 |
| `bg_turnover_allocations` | 跟随 `log_id` | 同上 | |
| `bg_568win_wallet_txn` | `created_at` | 3 个月 | |

**归档表 DDL 原则**：
```sql
CREATE TABLE bg_bet_order_archive LIKE bg_bet_order;
ALTER TABLE bg_bet_order_archive
  DROP FOREIGN KEY fk_bet_user,
  DROP INDEX uk_provider_txn,             -- 归档为只读，唯一约束交给热表
  ADD KEY idx_provider_txn (aggregator_id, provider_txn_id);
```

**搬迁作业**（独立脚本，参照 `scripts/` 目录既有写法，**不进迁移目录**）：
```
循环，每批 2000 行，两批之间 sleep 100ms：
  START TRANSACTION;
  INSERT INTO xxx_archive SELECT * FROM xxx WHERE created_at < :cutoff ORDER BY id LIMIT 2000;
  DELETE FROM xxx WHERE created_at < :cutoff ORDER BY id LIMIT 2000;
  COMMIT;
```
先跑 `bg_turnover_allocations` → `bg_turnover_logs` → `bg_bet_order`（子表先行），避免中间态悬挂。

**必须先改的读路径**（否则归档当天就出线上事故）：
| 文件 | 问题 |
|---|---|
| `apps/bff-node/src/services/withdraw-review.service.ts` | orphan 检查明确要查**全历史** bet（见 commit cd1f81c），归档后必须 `UNION ALL` 归档表 |
| `apps/bff-node/src/routes/admin/bet-orders.routes.ts` | 后台注单查询，需加"查询归档"开关 |
| `apps/bff-node/src/routes/admin/users.routes.ts` | 用户详情的注单/账变/优惠分页 |
| `apps/bff-node/src/routes/ledger.routes.ts` | 用户端钱包历史，默认热表即可，加"更早记录"入口 |
| `apps/bff-node/src/services/store/mysql-store.ts` | `listLedger` / `getLedgerEntry` |
| `apps/bff-node/src/services/rebate.service.ts` | 只查当日，热表足够，**无需改** |
| `apps/core-node/src/services/turnover.service.ts` | 流水核销只看未完成要求，热表足够 |

---

## 7. P3：真分库分表（目前不要做）

只有单机彻底扛不住才走这一步，届时：
- **分片键：`user_id`**。业务查询 95% 带 `user_id`（`bg_user.id` 是 `BG-xxxxx` 序列，见 `150_user_id_seq.sql`，取数字部分 `% N` 即可均匀）。
- 类 A 全部按 `user_id` 分片，`bg_user`/`bg_wallet`/`bg_user_*` 同片（同一用户的资金操作必须在单库内完成事务）。
- 配置/字典表做**广播表**（每个分片一份）。
- 后台与 BI 的全局时间窗查询**不允许打分片**，只能读 `bi_daily_*`（所以第 5.2 步是 P3 的前置条件）。
- 中间件选型：ShardingSphere-Proxy（对 `mysql2` 完全透明，Koa 侧零改动）优先于应用层路由。
- 前置代价：跨分片事务、`ORDER BY id DESC` 全局分页、`COUNT(*)` 全部要重写，工作量以月计。

---

## 8. 待办清单

已完成（2026-08-01，测试 + 生产均已执行）：
- [x] `bg_bet_order.idx_created`（迁移 191）。生产在线 DDL 5 秒完成，写入无中断。
      **注意**：加完之后当日窗口查询仍走全表扫，这是对的——现在表里只有 10 天数据，
      一天 = 全表 35%（`filtered: 34.80`），优化器判定全扫更便宜。缩到 1 小时窗口即
      `type: range / key: idx_created / rows: 18894`，证明索引可用。它是**预防性**的：
      表越深，一天占比越小，索引就越必然被选中，届时省下的是几十秒级的全表扫。
- [x] 生产 `slow_query_log=ON` / `long_query_time=1`，用 `SET PERSIST` 写进
      `mysqld-auto.cnf`（在 datadir 卷内，容器重建也保留）。
- [x] 删除 `bg_bet_round_bak_20260731`（228,219 行 / 44MB 陈旧快照，最后更新停在
      2026-07-31 09:25，全仓无代码引用）。

按优先级排队（均需单独授权后执行）：
- [ ] `bg_568win_report_bet` JSON 降冷（第 6.2 节）—— **磁盘红线的主因，约 2 个月内必须动**
- [ ] `rebate.service.ts` 三处 `bg_turnover_logs` 全表 GROUP BY 改走 `bg_user_vip_state.turnover_total`（第 5.2 节）
- [ ] 窗口 > 当日的聚合改读 `bi_daily_*`（第 5.2 节，同时是 P3 的前置条件）
- [ ] 后台分页 `COUNT(*)` 改造（第 5.4 节）
- [ ] 类 C 表定时清理（第 5.3 节）
