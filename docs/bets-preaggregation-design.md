# `/bets` 注单历史预聚合改造设计（评审稿）

> 目标：消除 `/bets` 查询的 `Using temporary; Using filesort`，把"每次查询按局分组+重排+3 JOIN"降为"索引扫一页"。压测实测：现状读侧天花板 ~17 req/s、拐点在 5 并发以下；根因不是索引缺失，而是 `GROUP BY 局` 但 `ORDER BY MAX(id)`（分组键≠排序键）导致无法避免的临时表+filesort，且成本随用户历史注单数增长。加索引无效（已实测），真解是**预聚合每局汇总**。

## 1. 现状与病灶（实测依据）

`apps/bff-node/src/routes/bets.routes.ts` 的查询：
- 内层 `bg_bet_order` 按 `IFNULL(round_id, id)` 分组，`ORDER BY MAX(id) DESC LIMIT/OFFSET`
- 外层 3 个 LEFT JOIN（`bg_568win_wallet_txn` → `bg_568win_game` → `bg_568win_game_override`）取游戏名/图标，含 `LOCATE/SUBSTRING_INDEX/CAST` 字符串运算
- 另有一条 `COUNT(*)` 子查询做同样的分组（分页总数）

EXPLAIN：内层 `Using temporary; Using filesort`，扫描行数 ≈ 用户全部历史注单。压测（单用户 3000 局，CONC=10）：
- 现状 `IFNULL`+COUNT：**56 qps / p95 266ms**
- 改 `GROUP BY round_id`：82 qps
- 再缓存 COUNT：102 qps（~1.8×，仍有 filesort）
- **加索引 `(user_id,round_id,id)`：无提升**（filesort 来自 `ORDER BY MAX(id)`，索引救不了）
- `IFNULL(round_id,id)` 无法做生成列（MySQL 禁止生成列引用自增 `id`）

## 2. 方案：每局汇总表 `bg_bet_round`

一局一行，在下注/结算事务内增量维护。读路径不再分组/JOIN。

### 2.1 表结构（提案 DDL）

```sql
CREATE TABLE `bg_bet_round` (
  `id`            bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id`       varchar(32)  NOT NULL,
  `round_key`     varchar(128) NOT NULL COMMENT '局标识=IFNULL(round_id, 首个bet的bet_order.id)',
  `round_id`      varchar(128) DEFAULT NULL COMMENT '展示用真实局号(可空)',
  `aggregator_id` varchar(32)  NOT NULL DEFAULT '568win',
  `bet_amount`    decimal(18,4) NOT NULL DEFAULT 0,
  `win_amount`    decimal(18,4) NOT NULL DEFAULT 0,
  `currency_code` varchar(32)  NOT NULL DEFAULT 'PHP',
  `status`        enum('running','settled','void') NOT NULL DEFAULT 'running',
  -- 展示字段：写入时快照，读路径零 JOIN
  `game_name`     varchar(255) DEFAULT NULL,
  `game_name_zh`  varchar(255) DEFAULT NULL,
  `game_provider` varchar(64)  DEFAULT NULL,
  `game_image`    varchar(512) DEFAULT NULL,
  `first_at`      datetime(3)  NOT NULL COMMENT '本局首注时间(=旧 MIN(created_at))',
  `last_id`       bigint unsigned NOT NULL COMMENT '本局最大 bet_order.id(=旧 MAX(id)，排序键)',
  `updated_at`    datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_round` (`user_id`, `round_key`),
  KEY `idx_user_last` (`user_id`, `last_id` DESC),        -- 服务 ORDER BY last_id DESC + 分页
  KEY `idx_user_first` (`user_id`, `first_at`)            -- 服务 dateFrom 过滤
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='注单按局汇总(读加速)';
```

字段与旧查询语义一一对应：`round_key`=分组键、`last_id`=`MAX(id)`（排序）、`first_at`=`MIN(created_at)`、`bet_amount/win_amount`=旧 SUM。

### 2.2 读路径改写（`bets.routes.ts`）

```sql
-- 总数：普通索引计数(可再叠 Redis 缓存)
SELECT COUNT(*) FROM bg_bet_round WHERE user_id=? [AND first_at>=?]

-- 列表：纯索引范围扫，无 GROUP BY / 无 JOIN / 无 filesort
SELECT round_id, bet_amount, win_amount, currency_code, first_at AS created_at,
       game_name, game_name_zh, game_provider, game_image
FROM bg_bet_round
WHERE user_id=? [AND first_at>=?]
ORDER BY last_id DESC
LIMIT ? OFFSET ?
```

`idx_user_last (user_id, last_id DESC)` 直接给出有序结果 → 无临时表、无 filesort，成本 = O(page)，与用户历史规模无关。

### 2.3 写入钩子（`apps/core-node/src/services/win568-wallet.service.ts`）

均在既有事务内、紧跟对应 `bg_bet_order` 写入之后，做一次 UPSERT（同一 `conn`，保证原子一致）：

- **deduct（新注 `INSERT bg_bet_order` 之后，:345 附近）**：
  ```sql
  INSERT INTO bg_bet_round
    (user_id, round_key, round_id, aggregator_id, bet_amount, win_amount, currency_code, status,
     game_name, game_name_zh, game_provider, game_image, first_at, last_id)
  VALUES (?,?,?,?,?,0,?, 'running', ?,?,?,?, NOW(3), ?)
  ON DUPLICATE KEY UPDATE
    bet_amount = bet_amount + VALUES(bet_amount),
    last_id    = GREATEST(last_id, VALUES(last_id));
  ```
  - `round_key` = `IFNULL(GameRoundId||transferCode, 新 bet_order.id)`（现状 round_id 线上 100% 覆盖，几乎恒为真实局号）
  - `last_id` = 刚 `INSERT bg_bet_order` 的 `insertId`
  - 展示字段：deduct 已为打码做过品类/游戏查询（`allocateBetTurnover`），顺带取 name/provider/image 传入；缺失则留空（读侧回退与旧 `COALESCE(..., '568Win '||game_id)` 一致）
- **raise-bet（productType 3/7，加注，:300-317）**：`bet_amount += diff`、`last_id=GREATEST(...)`（与旧 SUM 口径一致，因加注是在原 bet 上增额）
- **settle（:462-481 派彩之后）**：
  ```sql
  UPDATE bg_bet_round SET win_amount = win_amount + ?, status='settled', last_id=GREATEST(last_id, ?)
  WHERE user_id=? AND round_key=?;
  ```
  `?`=`winLoss`（与旧 `SUM(win/refund)` 口径一致：settle 落一条 `bet_type='win'` 的 bet_order）
- **returnStake（退注 refund，:406-416）**：`win_amount += refund`（旧口径 refund 计入 win_amount）
- **cancel / rollback（reverse，:493-507）**：反向。两种口径二选一（评审定）：
  1. 冲减：`bet_amount -= ?`/`win_amount -= ?`，若归零则 `status='void'`
  2. 置空：`status='void'`（读侧默认过滤 void）
  ⚠️ 这是**唯一需要仔细对齐旧语义的点**——旧查询把 `cancel` 行既不算 bet 也不算 win，但 rollback/cancel 会反转钱包；汇总表要与之保持一致，建议按"冲减 + void 标记"。

### 2.4 一致性 / 幂等
- 汇总 UPSERT 与 `bg_bet_order` 写入**同事务**，天然一致；deduct 的 `findTxns` 去重已在前，重复回调不会重复计入。
- 汇总表是**派生数据**：即使某次钩子漏算，可用 §3 的回填 SQL 从 `bg_bet_order` 重算重建，不影响资金。

## 3. 迁移与灰度（提案，**审批后**才落 `infra/database/betogo/0NN_*.sql`）

> ⚠️ 按项目规矩，回填是"一次性大改动"，**不直接写进会每次部署重跑的迁移**里做全表 DELETE/重算。下面拆成"建表迁移(可进迁移目录)" + "回填(独立手动脚本)"。

**迁移文件（幂等，可进目录）**：仅 `CREATE TABLE bg_bet_round`（见 §2.1，加 `IF NOT EXISTS`）。

**回填脚本（`scripts/backfill-bet-round.sql`，标注手动执行、分批）**：从 `bg_bet_order` 按旧分组重算，`INSERT ... ON DUPLICATE KEY UPDATE` 幂等；大表按 user_id 或 id 区间分批，低峰执行。
```sql
INSERT INTO bg_bet_round (user_id, round_key, round_id, aggregator_id, bet_amount, win_amount,
  currency_code, status, first_at, last_id)
SELECT user_id, IFNULL(round_id, id), MAX(round_id), MAX(aggregator_id),
  SUM(CASE WHEN bet_type='bet' THEN amount ELSE 0 END),
  SUM(CASE WHEN bet_type IN('win','refund') THEN amount ELSE 0 END),
  MAX(currency_code),
  IF(SUM(bet_type='win')>0,'settled','running'), MIN(created_at), MAX(id)
FROM bg_bet_order
WHERE user_id BETWEEN ? AND ?          -- 分批
GROUP BY user_id, IFNULL(round_id, id)
ON DUPLICATE KEY UPDATE
  bet_amount=VALUES(bet_amount), win_amount=VALUES(win_amount),
  status=VALUES(status), last_id=VALUES(last_id);
-- 展示字段(game_name等)可回填时留空，读侧回退旧 COALESCE 文案；或另跑一次 JOIN 补齐
```

**上线顺序（零丢单）**：
1. 部署**建表** + **写钩子**（core-node）→ 新注单起即维护 `bg_bet_round`
2. 跑**回填**覆盖历史（`ON DUPLICATE KEY` 与钩子并存不冲突；跨部署点的在途局最多被回填重算一次，幂等无误）
3. 部署**读改写**（bff-node），`/bets` 切到 `bg_bet_round`
4. 观察一段时间后，旧查询代码可删

**回滚**：读路径切回旧查询即可（汇总表保留不影响资金）。

## 4. 预期收益
- 读路径从 `O(用户历史) + 临时表 + filesort + 3 JOIN` → `O(一页) 索引扫`，预期 **/bets 吞吐提升一个数量级**，且**不再随用户注单增长而劣化**（现状最痛的点）。
- COUNT 变普通索引计数（可再叠 Redis 缓存）。
- 叠加已验证的连接池调大（写侧）与 MySQL 独立扩容，读侧瓶颈基本解除。

## 5. 待评审决策点
1. **cancel/rollback 口径**：冲减+void 标记（推荐）vs 纯 void。
2. **展示字段**：写入时快照（零 JOIN，推荐）vs 只存 gpid/provider_id 读时用缓存解析（省存储、但读侧仍需一次查找）。
3. **COUNT 是否再加 Redis 缓存**（预聚合后 COUNT 已很轻，可后置）。
4. 回填分批策略与执行窗口（生产数据量决定）。
