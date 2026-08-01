# 数据库分表 / 冷热分离方案（规划稿，未实施）

编写时间：2026-08-01
背景：`bg_bet_order`、`bg_wallet_ledger` 已到 60 余万行，其余表同步增长，当前无任何分区/分表。

---

## 0. 结论先行

**现在不要做分表，也不要做分区。** 60 万行对 MySQL 8 单表是"小表"级别：
按当前列宽估算 `bg_bet_order` 约 180MB 数据 + 150MB 索引，`bg_wallet_ledger` 约 250MB + 200MB，
生产 buffer pool 8G（`deploy/single-node/env-aws-16g.sh`），整张表连同索引全在内存里。
此时上分区/分表，收益是 0，成本是唯一键约束退化 + 全部资金查询代码改造 —— 纯亏。

真正该现在做的是 **P0 索引与聚合口径修复**（见第 4 节），那才是当前慢查询的来源。
分表方案按阈值触发，提前把设计和迁移脚本准备好，到点直接执行。

---

## 1. 表分级

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

## 2. 拆分策略：为什么"归档"优于"原生分区"

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

## 3. 阶段路线与触发阈值

| 阶段 | 触发条件 | 动作 |
|---|---|---|
| **P0（立即）** | 现在 | 补索引、把时间窗全表聚合改走 `bi_daily_*`、类 C 表定时清理 |
| **P1** | 单表 ≥ **500 万行** 或 (data+index) ≥ **5GB** | 类 B 上 RANGE 月分区 + 过期 DROP；`bg_568win_report_bet` 的 JSON 列先降冷 |
| **P2** | 单表 ≥ **2000 万行** | 类 A 启动归档，热表按第 4 节保留期滚动 |
| **P3** | 单表 ≥ **1 亿行** 或 单机写入/IOPS 触顶 | 才考虑真正的分库分表（第 6 节），此前一律不上 |

按现有 60 万行的规模，P2 距离约 2~3 年（按日均 1~3 万行估）。
`bg_568win_report_bet` 因为带 JSON，可能先触发 P1 的 5GB 条件——它是第一个要动的表。

---

## 4. P0：现在就该做的（不涉及分表）

### 4.1 缺失索引
`bg_bet_order` **没有 `created_at` 单列索引**（`158_bi_user_daily.sql` 给 `bg_login_log`、
`bg_wallet_ledger`、`bg_deposit_order`、`bg_withdraw_order`、`bg_568win_wallet_txn` 都补了，唯独漏了它）。
而以下查询全是按纯时间窗扫全表：
- `rebate.service.ts` 每日返水：`WHERE created_at >= ? AND created_at < ? GROUP BY user_id, currency_code`
- 亏损返水的 `EXISTS` 子查询：`bb.user_id = bo.user_id AND bb.round_id = bo.round_id`
- `bi-aggregate.service.ts` 日聚合

建议（新迁移文件，幂等写法参照 158）：
```sql
CREATE INDEX idx_created        ON bg_bet_order (created_at);
CREATE INDEX idx_created_type   ON bg_bet_order (created_at, bet_type, status);
CREATE INDEX idx_settled        ON bg_bet_order (settled_at);   -- cd1f81c 已把派彩按 settled_at 归期
```
上线前用 `EXPLAIN` 逐条验证，别盲目加——每个索引都会拖慢回调写入。

### 4.2 把历史聚合从原表移走
`bi_daily_user` / `bi_daily_platform` 已经存在，方向是对的。凡是查询窗口 > 当日的聚合
（代理 GGR、返水统计、BI 报表、`agent.routes.ts` 里那个对每个用户跑两个标量子查询的分页），
一律改读 `bi_daily_*`。只有"当日实时"才允许打原表。
这一步做完，类 A 表的读压力基本清零，P2 会被推后很久。

### 4.3 类 C 清理
- `bg_idempotency`：定时 `DELETE FROM bg_idempotency WHERE expires_at < NOW() - INTERVAL 7 DAY LIMIT 5000` 循环
- `bg_session`：Redis 已在用，MySQL 这张表若无实际读路径应废弃；否则按 `expires_at` 定时清

### 4.4 后台分页 `COUNT(*)`
`admin/bet-orders.routes.ts`、`admin/ledger.routes.ts` 每次分页都跑一次全条件 `COUNT(*)`。
数据量再大一个量级后这会是最先卡死的地方。改法：只在第 1 页算总数并缓存，或改为
"是否有下一页"（`LIMIT pageSize+1`）。

---

## 5. P1/P2 明细方案

### 5.1 类 B：RANGE 月分区（P1）

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

### 5.2 `bg_568win_report_bet`（P1，优先级最高）

这张表存了上游注单的完整 JSON 原文，行宽是其他表的 10 倍以上。
两步走，**不用分区**：
1. 冷数据 JSON 置空：`UPDATE ... SET raw_bet = NULL, raw_response = NULL WHERE order_time < now-90d`
   （对账只需要结构化列；原文若有留存要求，先落对象存储/日志归档）
2. 仍然过大则整行归档到 `bg_568win_report_bet_archive`，按 `order_time` 切。

### 5.3 类 A：冷热归档（P2）

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

## 6. P3：真分库分表（目前不要做）

只有单机彻底扛不住才走这一步，届时：
- **分片键：`user_id`**。业务查询 95% 带 `user_id`（`bg_user.id` 是 `BG-xxxxx` 序列，见 `150_user_id_seq.sql`，取数字部分 `% N` 即可均匀）。
- 类 A 全部按 `user_id` 分片，`bg_user`/`bg_wallet`/`bg_user_*` 同片（同一用户的资金操作必须在单库内完成事务）。
- 配置/字典表做**广播表**（每个分片一份）。
- 后台与 BI 的全局时间窗查询**不允许打分片**，只能读 `bi_daily_*`（所以第 4.2 步是 P3 的前置条件）。
- 中间件选型：ShardingSphere-Proxy（对 `mysql2` 完全透明，Koa 侧零改动）优先于应用层路由。
- 前置代价：跨分片事务、`ORDER BY id DESC` 全局分页、`COUNT(*)` 全部要重写，工作量以月计。

---

## 7. 需要先采集的数据（生产只读，建议你本人执行）

方案里的阈值需要真实数据校准，请在生产跑以下只读 SQL 并回贴结果：

```sql
-- 各表体量排行
SELECT TABLE_NAME, TABLE_ROWS,
       ROUND(DATA_LENGTH/1048576)  AS data_mb,
       ROUND(INDEX_LENGTH/1048576) AS idx_mb,
       ROUND((DATA_LENGTH+INDEX_LENGTH)/1048576) AS total_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA='betogo'
ORDER BY DATA_LENGTH+INDEX_LENGTH DESC LIMIT 30;

-- 近 30 天日增速（注单 / 账变 / 上游报表）
SELECT DATE(created_at) d, COUNT(*) n FROM bg_bet_order
 WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY d ORDER BY d;
SELECT DATE(created_at) d, COUNT(*) n FROM bg_wallet_ledger
 WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY d ORDER BY d;
```

有了日增速才能把第 3 节的阈值换算成具体日期。
