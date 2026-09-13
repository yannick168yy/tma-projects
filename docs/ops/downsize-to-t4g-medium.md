# 生产降配方案：m8g.xlarge → t4g.medium

目标：把生产从 4C16G 降到 2C4G，月成本 **$163.81 → $30.95（省 81%，年省 $1594）**。

前提是先归档。**归档和降配的顺序不能反**：3GB 的库配 1280M buffer pool 会让命中率掉到 60% 以下。

---

## 一、为什么 t4g.medium 够用（实测依据）

| 指标 | 实测值 | 说明 |
|---|---|---|
| 30 天 CPU 峰值 | 最低 idle 80.7% | 峰值仅用掉 0.77 vCPU，2 核绰绰有余 |
| 日常 CPU | %user 0.37 + %sys 0.13 | 约 0.02 vCPU |
| QPS | 5.4 | MySQL 连接峰值 28（配了 200） |
| HTTP 峰值 | 3405 次/小时 | 约 1 req/s |
| 内存占用构成 | MySQL 94% | 前端三个容器合计 12MB，不是瓶颈 |

**唯一的约束是数据库体积**，而它可以靠归档锁死。

T 系列积分：t4g.medium 基线 = 20% × 2 vCPU = 0.4 vCPU，日常用量 0.02 vCPU，积分只进不出。
唯一会烧积分的是服务器上跑完整镜像构建，每次几分钟，可忽略。

---

## 二、归档方案

### 保留窗口：30 天

实测确认 30 天安全：

- **风控不受影响**：`withdraw-review.service.ts` 的 `INTERVAL 30 DAY` 关联账号查询用的是
  `bg_login_log`（4.7MB），**不在归档清单内**，永不归档。
- **报表不受影响**：`bi_daily_platform` / `bi_daily_game` / `bi_daily_user` / `bi_daily_provider`
  / `bi_daily_active` 等 BI 日汇总表从 2026-07-19 起持续填充至今，明细归档后报表仍有数据源。
### 归档的业务影响（逐个接口实测确认）

**A. 不受影响 —— 已有增量维护的累计列或日汇总表**

| 业务 | 为什么安全 |
|---|---|
| VIP 等级 | 读 `bg_user_vip_state.turnover_total`，由 core 写侧事务内增量维护（迁移 151），不 SUM 明细 |
| 返水累计 | 同上，读累加列 |
| 打码量 / 提现门槛 | `bg_turnover_requirements.completed_amount` 独立累计，写侧维护 |
| 团队流水 | 历史读 `bg_team_turnover_daily`，只有当天才读 `bg_bet_order` |
| 代理佣金 | `bg_agent_ggr_monthly` |
| 全部 BI 报表 | `bi_daily_platform/game/user/provider/active`，7/19 起持续填充 |

`vip.service.ts` 里那处 `SUM(bg_turnover_logs) GROUP BY user_id` 也安全 ——
它是 `INSERT IGNORE` 建行语句，已有行不会被覆盖（代码注释也标了它很可能已是死代码）。

**B. 明细查询 —— 查不到 30 天前，这是预期内的功能损失**

- 后台「投注订单」`admin/bet-orders.routes.ts`
- 后台「流水明细」`admin/ledger.routes.ts`
- 后台「用户详情 → 投注/流水」`admin/users.routes.ts`
- 后台「代理报表明细」`admin/agent.routes.ts`
- 用户端「投注记录」`bets.routes.ts`
- 用户端「流水」`ledger.routes.ts`（本来就只返回 7 天，无影响）

需要时从 `archives/*.sql.gz` 离线恢复。

**C. 🔴 提现风控统计失真 —— 必须先解决，否则不能归档**

`withdraw-review.service.ts:655`：

```js
const sinceDate = wd?.last_at ? new Date(wd.last_at) : registeredAt
```

风控窗口 = **上次成功提现时间，从未提现过则 = 注册时间**，**没有时间下界**。
归档 30 天前数据后，这类用户的存款额、投注额、盈亏、高倍中奖检测全部只剩 30 天内的数据。

生产实测受影响规模：

```
总用户                                    2329
注册超 30 天且从未成功提现                1989  (85%)
  其中近 30 天有投注（会真实触发风控）     161  ← 高危
```

后果：这 161 人发起提现时，`large_profit` / 存提比 / `high_multiple_profit`
等规则基于残缺数据判断，**可能放行本该转人工审核的提现**。这是资金安全问题，不是体验问题。

**归档前必须先做的补救**（三选一）：
1. 建用户级风控快照表，归档前把历史存款/投注/盈亏固化进去，风控改读快照 + 近期明细
2. 给 `bg_bet_order` / `bg_wallet_ledger` 保留按用户聚合的汇总行，只删明细行
3. 放弃归档，改用 t4g.large（8GB）—— 工作集 2.4GB 完全装得下，这些问题全部不存在

**D. 撤单回滚的边缘情况**

`turnover.service.ts:reverseBetTurnover` 需要 JOIN `bg_bet_order` + `bg_turnover_logs`
找原始记录来回退打码量。30 天后才发生的撤单会找不到记录，打码量无法回滚。
实际极罕见，但如果上游厂商有长周期对账撤单，需要确认。

### 归档范围与实测量（2026-09-13 预演结果）

| 表 | 待归档行数 | 当前体积 | 删除策略 |
|---|---|---|---|
| bg_bet_order | 1,331,621 | 755.7 MB | id (bigint 自增) |
| bg_wallet_ledger | 1,383,505 | 685.0 MB | **time**（id 是 varchar(40) 非自增） |
| bg_568win_wallet_txn | 737,180 | 869.1 MB | id |
| bg_568win_report_bet | 738,902 | 405.7 MB | id (order_time) |
| bg_bet_round | 638,236 | 138.2 MB | id (first_at) |
| bg_turnover_logs | 638,311 | 106.8 MB | id |
| bg_turnover_allocations | 328,989 | 10.5 MB | log_id（跟随 logs） |
| **合计** | **5,796,744 行（全库 74%）** | 2970.9 MB | |

**归档后预估：betogo 约 1.2–1.5 GB**（OPTIMIZE 回收碎片后）。

> ⚠️ 体积必须看真实 .ibd 文件，不能信 `information_schema.tables` 的统计值 ——
> 实测两者差最多 2.8 倍（`bg_568win_report_bet` 统计 405.7MB，实际 1140MB），
> 因为该统计对 InnoDB 是估算值且不计碎片。betogo 目录实际 **4.7GB**，不是 3041MB。
> 好消息是碎片这么多，说明 OPTIMIZE 的回收收益很大。

```
表                      统计值      真实 .ibd
bg_568win_report_bet    405.7 MB →  1140 MB
bg_568win_wallet_txn    869.1 MB →  1008 MB
bg_bet_order            755.7 MB →   972 MB
bg_wallet_ledger        685.0 MB →   864 MB
bg_bet_round            138.2 MB →   308 MB
bg_turnover_logs        106.8 MB →   140 MB
```

### 热工作集实测（决定 buffer pool 该给多大）

库大小不等于内存需求 —— InnoDB 只缓存热页。实测 LRU young 区（被反复访问的页）：

```
bg_568win_report_bet   833 MB      bg_bet_order      321 MB
bg_568win_wallet_txn   620 MB      bg_bet_round      185 MB
bg_wallet_ledger       339 MB      bg_turnover_logs  103 MB
betogo 合计 ≈ 2.4 GB
```

注意这是**上界**不是稳态值：当前 `Free buffers` 常年剩 3.22GB、
`evicted without access 0.00/s`，说明 pool 从未满过、从未淘汰过任何页，
young 页只进不出地累积。真实稳态工作集在 790MB（近 30 天数据量）～2.4GB 之间，
不制造淘汰压力无法精确测定。

**这就是必须归档的真正理由**：不是"库装不进内存"，而是 2.4GB 的工作集上界
明显超过 t4g.medium 能给的 1280M pool。归档把冷数据移走后，工作集随之落到
1GB 以内，1280M 才站得住。

### 为什么分两种删除策略

`bg_wallet_ledger.id` 是 `varchar(40)`（形如 `VG_1786656384040_bb1603`），不是自增整数，
按 id 范围比较没有意义 —— 它有单列 `idx_created`，直接按时间删走 range scan。
其余六张表 id 是 `bigint` 自增，先用时间求出 cutoff id 再按主键删最快
（`bg_bet_round`/`bg_turnover_logs` 的时间列只有复合索引，直接按时间删会退化成 skip scan）。

### 脚本

`scripts/archive/archive-cold-data.sh` —— **手动执行，不在迁移目录，不随部署运行**。

```bash
bash scripts/archive/archive-cold-data.sh                  # 预演
bash scripts/archive/archive-cold-data.sh --apply --optimize   # 执行 + 回收空间
```

内置保护：执行前强制全量备份；先 `mysqldump` 导出 `.sql.gz` 并 `gzip -t` 校验通过才删；
分批 2000 行 + 200ms 间隔，避免撑爆 undo log 和 binlog。

---

## 三、执行步骤

### 阶段 0：前置（不停机）

1. **补 IAM 权限**（当前 `betogo_IAM_user` 缺 `ec2:StopInstances` / `ec2:StartInstances` /
   `ec2:ModifyInstanceAttribute` / `ec2:CreateSnapshot`），或全程在控制台手动操作。
2. 确认 EIP：`13.213.107.231` = `eipalloc-05e0af3408e0fb4ba`，**停机重启后 IP 不变，DNS 不用动**。
3. 打 EBS 快照兜底：卷 `vol-0e3f98a7d4fe42545`。

### 阶段 1：归档（在现有 16G 机器上做，不停机，约 1–1.5 小时）

在大机器上归档，CPU 和内存都宽裕；降到 2C4G 再删 580 万行会很痛苦。

```bash
cd /opt/tma-projects
bash scripts/archive/archive-cold-data.sh                    # 先预演，核对行数
bash scripts/archive/archive-cold-data.sh --apply --optimize # 低峰期执行
```

低峰期参考：UTC 08:00–09:00（实测请求量最低，580–728 次/小时）。

### 阶段 2：验证归档结果（不停机）

```bash
# 库必须 < 1GB，否则不要继续降配
sudo podman exec tma-mysql mysql -uroot -p"$PASS" -e \
  "SELECT round(sum(data_length+index_length)/1048576,1) MB
   FROM information_schema.tables WHERE table_schema='betogo';"
```

同时人工验收：后台能正常出报表、能查近 30 天流水、提现风控复核页面正常。
把 `archives/*.sql.gz` 下载到本地留存。

### 阶段 3：降配（停机约 5–10 分钟）

```bash
# 1) 建 swap（4G 机器必须有，部署构建和 mysqldump 尖峰靠它兜底）
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 2) 停容器 + 停机
cd /opt/tma-projects && sudo podman stop -a
aws ec2 stop-instances --region ap-southeast-1 --instance-ids i-0fcc483b5d6d11a61
aws ec2 wait instance-stopped --region ap-southeast-1 --instance-ids i-0fcc483b5d6d11a61

# 3) 改机型
aws ec2 modify-instance-attribute --region ap-southeast-1 \
  --instance-id i-0fcc483b5d6d11a61 --instance-type t4g.medium

# 4) 启动
aws ec2 start-instances --region ap-southeast-1 --instance-ids i-0fcc483b5d6d11a61
aws ec2 wait instance-running --region ap-southeast-1 --instance-ids i-0fcc483b5d6d11a61

# 5) 用 4G 参数重建容器
cd /opt/tma-projects
source deploy/single-node/env-aws-4g.sh
bash deploy/single-node/podman-prod-minimal.sh
```

### 阶段 4：起来后必须核对

```bash
free -m                      # 确认 4G，swap 已挂
sudo podman ps               # 9 个容器全 Up
# 🔴 最关键的一条：buffer pool 是否真的是 1280M
sudo podman exec tma-mysql mysql -uroot -p"$PASS" -e "SELECT @@innodb_buffer_pool_size/1048576;"
curl -sf https://betogo.games/api/v1/home/content > /dev/null && echo BFF-OK
curl -sf https://admin.betogo.games/ > /dev/null && echo ADMIN-OK
```

**必须检查 buffer pool 实际值**：容器内存限额不足时 InnoDB 会**静默降级** buffer pool 且不报任何错
（见 `ensure-mysql-memory.sh` 顶部注释）。查出来不是 1280 就说明 `MEM_MYSQL` 没生效。

同时把 `ensure-mysql-memory.sh` 的 cron 目标值同步改掉，否则它会把 pool「兜底」回 256MB：

```bash
TARGET_MEM=2g TARGET_POOL_MB=1280 bash deploy/single-node/ensure-mysql-memory.sh
```

---

## 四、回滚

任何一步不对，改回去即可，EIP 和 EBS 都不受影响：

```bash
sudo podman stop -a
aws ec2 stop-instances --region ap-southeast-1 --instance-ids i-0fcc483b5d6d11a61
aws ec2 wait instance-stopped --region ap-southeast-1 --instance-ids i-0fcc483b5d6d11a61
aws ec2 modify-instance-attribute --region ap-southeast-1 \
  --instance-id i-0fcc483b5d6d11a61 --instance-type m8g.xlarge
aws ec2 start-instances --region ap-southeast-1 --instance-ids i-0fcc483b5d6d11a61
cd /opt/tma-projects && source deploy/single-node/env-aws-16g.sh
bash deploy/single-node/podman-prod-minimal.sh
```

归档的数据要恢复：`gzip -dc archives/bg_bet_order-before-*.sql.gz | mysql -uroot -p betogo`

---

## 五、长效维护

降配后必须持续归档，否则库以约 **57 MB/天（1.7 GB/月）** 重新涨回去，4G 机器撑不到半年。

加一条 cron（低峰期，每周一次即可）：

```cron
0 9 * * 0 cd /opt/tma-projects && KEEP_DAYS=30 bash scripts/archive/archive-cold-data.sh --apply >> /var/log/archive.log 2>&1
```

`--optimize` 不要放进 cron —— OPTIMIZE 会重建表，每周跑一次代价太高。
每季度手工跑一次回收空间即可。

**别急着买 Savings Plan**：降配后按需跑 1–2 个月观察稳定了再买，而且要买
Compute Savings Plan（跨机型灵活），不要买 EC2 Instance SP 或标准 RI。
