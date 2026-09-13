# 生产降配方案（两阶段）

生产 m8g.xlarge（4C16G）严重过剩，实测只用掉约 1/5。分两阶段降配：

| 阶段 | 机型 | 月成本 | 节省 | 前置条件 | 状态 |
|---|---|---|---|---|---|
| 现状 | m8g.xlarge 4C16G | $163.81 | — | — | — |
| **阶段一** | **t4g.large 2C8G** | **$61.90** | **62%（年省 $1223）** | 无，直接可做 | 待执行 |
| 阶段二 | t4g.medium 2C4G | $30.95 | 81%（年省 $1594） | 必须先归档 + 修风控 | 后续排期 |

阶段一零业务损失、零代码改动、可随时回滚。阶段二再多省 $31/月，但要动提现风控，单独排期。

价格取自 ap-southeast-1 官方价目表（Linux/共享租期/按需，730h/月）。

---

## 实测依据（2026-09-13 采集）

| 指标 | 实测值 | 说明 |
|---|---|---|
| 30 天 CPU 峰值 | 最低 idle 80.7% | 峰值仅用掉 0.77 vCPU，2 核绰绰有余 |
| 日常 CPU | %user 0.37 + %sys 0.13 | 约 0.02 vCPU |
| QPS | 5.4 | MySQL 连接峰值 28（配了 200） |
| HTTP 峰值 | 3405 次/小时 | 约 1 req/s |
| 出网流量 | 0.6 GB/天 | 56 天累计 35.6GB |
| 内存构成 | MySQL 占 94% | 前端三个容器合计 12MB，不是瓶颈 |
| **热工作集** | **约 2.4 GB** | 见下 |

### 热工作集实测 —— 这是决定内存规格的唯一指标

库大小 ≠ 内存需求，InnoDB 只缓存热页。实测 LRU young 区（被反复访问的页）：

```
bg_568win_report_bet   833 MB      bg_bet_order      321 MB
bg_568win_wallet_txn   620 MB      bg_bet_round      185 MB
bg_wallet_ledger       339 MB      bg_turnover_logs  103 MB
                                   betogo 合计 ≈ 2.4 GB
```

这是**上界**不是稳态值：当前 `Free buffers` 常年剩 3.22GB、`evicted without access 0.00/s`，
说明 pool 从未满过、从未淘汰过任何页，young 页只进不出地累积。
真实稳态工作集在 790MB（近 30 天数据量）～2.4GB 之间。

**结论**：8GB 机器给 4G pool 能完全盖住 2.4GB 工作集 → 阶段一不需要归档。
4GB 机器只能给 1280M pool → 阶段二必须先归档把工作集压下去。

### 库体积必须看 .ibd，不能信 information_schema

`information_schema.tables` 对 InnoDB 是估算值且不计碎片，实测差最多 2.8 倍：

```
表                      统计值      真实 .ibd
bg_568win_report_bet    405.7 MB →  1140 MB
bg_568win_wallet_txn    869.1 MB →  1008 MB
bg_bet_order            755.7 MB →   972 MB
bg_wallet_ledger        685.0 MB →   864 MB
bg_bet_round            138.2 MB →   308 MB
bg_turnover_logs        106.8 MB →   140 MB
betogo 目录合计         3041   MB →   4.7 GB
```

另：binlog 保留 30 天占约 12GB，`/var/lib/mysql` 共 17GB，根盘 100GB 用 35GB —— 磁盘不紧张。

---

# 阶段一：→ t4g.large（当前执行）

## 前置检查（不停机）

1. **IAM 权限**：`betogo_IAM_user` 已补齐并实测通过（`DryRunOperation: Request would have succeeded`）：
   `ec2:StopInstances` / `ec2:StartInstances` / `ec2:ModifyInstanceAttribute` / `ec2:CreateSnapshot`
2. **EIP 确认**：`13.213.107.231` = `eipalloc-05e0af3408e0fb4ba`，**停机重启后 IP 不变，DNS 不用动**
3. **实例**：`i-0fcc483b5d6d11a61`，AZ `ap-southeast-1b`，根卷 `vol-0e3f98a7d4fe42545`（gp3 100GB/3000 IOPS）

## 执行（停机约 5–10 分钟，建低峰期）

低峰期参考：**UTC 08:00–09:00**（实测请求量最低，580–728 次/小时）。

```bash
R=ap-southeast-1; I=i-0fcc483b5d6d11a61

# 0) 快照兜底（约几分钟，可在停机前异步跑）
aws ec2 create-snapshot --region $R --volume-id vol-0e3f98a7d4fe42545 \
  --description "pre-downsize-t4g-large-$(date +%F)"

# 1) 建 swap（2C 机器构建时有内存尖峰，靠它兜底）
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 2) 停容器 + 停机
cd /opt/tma-projects && sudo podman stop -a
aws ec2 stop-instances --region $R --instance-ids $I
aws ec2 wait instance-stopped --region $R --instance-ids $I

# 3) 改机型
aws ec2 modify-instance-attribute --region $R --instance-id $I --instance-type t4g.large

# 4) 启动
aws ec2 start-instances --region $R --instance-ids $I
aws ec2 wait instance-running --region $R --instance-ids $I

# 5) 用 8G 参数重建容器
cd /opt/tma-projects
source deploy/single-node/env-aws-8g.sh
bash deploy/single-node/podman-prod-minimal.sh

# 6) ⚠️ web-platform 不在 minimal 脚本里，必须单独起，否则平台控制台会挂
bash deploy/single-node/recreate-web-platform.sh
```

### 三个容易踩的坑（实测确认）

1. **`podman-prod-minimal.sh` 不含 `tma-web-platform`**。生产跑 9 个容器，该脚本只起 8 个
   （mysql / redis / nats / core-node / bff-node / bff-node-2 / web-tma / web-admin）。
   漏了第 6 步，平台控制台直接不可用。

2. **`recreate-*.sh` 里的内存是硬编码的，不读环境变量**：
   `recreate-bff-node.sh` 写死 256m、`recreate-core-node.sh` 192m、`recreate-web-platform.sh` 128m。
   这就是为什么生产 bff 实际是 256m 而非 `env-aws-16g.sh` 声称的 768m。
   **重建容器请走 `podman-prod-minimal.sh`**（它读 `MEM_*` 环境变量），
   只有 web-platform 不得不用 recreate 脚本（128m 对它够用，实测占 3.7MB）。

3. **`boot-heal.sh:34` 硬编码 `source env-aws-16g.sh`**。它只用来取 `MEM_NATS`，
   降配后取到 256m 在 8G 机器上无害，**不改也不会出事**；但若日后扩展该脚本读更多
   `MEM_*`，必须同步改成 `env-aws-8g.sh`，否则自愈时会按 16G 预算重建容器。

### 降配前后的容器内存对照

| 容器 | 降配前实测 | 降配后（env-aws-8g.sh） |
|---|---|---|
| tma-mysql | 10240MB (pool 8G) | 5120MB (pool 4G) |
| tma-bff-node ×2 | 256MB each | 512MB each |
| tma-core-node | 192MB | 256MB |
| tma-redis | 512MB | 256MB |
| tma-nats | 256MB | 128MB |
| tma-web-tma | 无限制 | 64MB |
| tma-web-admin | 128MB | 64MB |
| tma-web-platform | 128MB | 128MB（recreate 脚本硬编码） |

bff 从 256m 提到 512m 是有意的：实际占用 176MB 已到 256m 的 69%，
而 scrypt 并发注册在 256m 下有 OOM 实绩（见 `env-aws-16g.sh`）。8G 机器有余量，不必吝啬。

## 起来后必须核对

```bash
free -m                      # 确认 8G，swap 已挂
sudo podman ps               # 9 个容器全 Up

# 🔴 最关键：buffer pool 是否真的是 4096M
sudo podman exec tma-mysql mysql -uroot -p"$PASS" -e "SELECT @@innodb_buffer_pool_size/1048576;"

curl -sf https://betogo.games/api/v1/home/content > /dev/null && echo BFF-OK
curl -sf https://admin.betogo.games/ > /dev/null && echo ADMIN-OK
```

**buffer pool 实际值必须查**：容器内存限额不足时 InnoDB 会**静默降级** pool 且不报任何错
（见 `ensure-mysql-memory.sh` 顶部注释）。查出来不是 4096 就说明 `MEM_MYSQL` 没生效。

同步改掉 `ensure-mysql-memory.sh` 的 cron 目标值，否则它会把 pool「兜底」回 256MB：

```bash
TARGET_MEM=5g TARGET_POOL_MB=4096 bash deploy/single-node/ensure-mysql-memory.sh
```

## 实际执行记录（2026-09-13 完成）

阶段一已执行完毕。实际过程与本手册预案的**五处偏差**，供阶段二参考：

1. **生产已有 4GB swap**（`/swapfile`，已在 fstab），无需新建。`fallocate` 会报
   `Text file busy`。手册原写"建 2G swap"是多余步骤。
2. **`/opt/tma-projects` 不是 git 仓库**，代码走 rsync 部署。`git pull` 会失败，
   新脚本要用 `scp` 传。
3. **实例启动后 9 个容器会自动拉起**（`restart=always`），且用的是**创建时的旧配置** ——
   MySQL 带着 `--memory=10240MB --innodb_buffer_pool_size=8G` 在 7.8GB 机器上跑起来了。
   必须立即处理，否则 pool 填充时会 OOM。
4. **止血手段**：MySQL 8 支持在线调整，`SET GLOBAL innodb_buffer_pool_size=4294967296`
   几秒完成、零停机，可先消除 OOM 风险再从容重建容器。
   （注意这只是运行时值，重启回退，必须重建容器才永久生效。）
5. **不需要跑 `podman-prod-minimal.sh` 全栈重建**。只有 MySQL 的限额超出机器规格，
   其余容器（bff 256m×2 / core 192m / redis 512m / nats 256m / web 128m×2）在 8G 上都安全。
   只重建 MySQL 风险小得多 —— 用新增的 `deploy/single-node/recreate-mysql.sh`。

**实测结果**：

```
规格      4C16G → 2C8G (7802MB)
pool      8192MB → 4096MB（永久，容器重建生效）
max_conn  200 → 120
停机      EC2 停止到启动约 5 分钟；MySQL 容器重建仅 4 秒
影响      nginx 日志中仅 4 个 502
数据      用户 2329 一致；订单/流水与降配前对齐
内存      used 1547MB / 7802MB，available 6254MB
验证      bff:3000/3001、core:4000 健康检查均 200
          https://www.betogo.games/ 与 admin 均 200，响应 0.29s
          EIP 13.213.107.231 未变，DNS 无需调整
```

## 观察期

降配后跟踪一周：

```bash
# 命中率应保持接近 100%，evicted 应保持 0
sudo podman exec tma-mysql mysql -uroot -p"$PASS" -e "SHOW ENGINE INNODB STATUS\G" \
  | sed -n '/BUFFER POOL AND MEMORY/,/INDIVIDUAL/p' | grep -E "hit rate|Free buffers|evicted"

sar -u | tail -5     # CPU 积分：t4g.large 基线 30%×2vCPU，日常 0.4% 不可能触发限流
```

**别急着买 Savings Plan**：按需跑 1–2 个月观察稳定了再买，且要买 Compute Savings Plan
（跨机型灵活），不要买 EC2 Instance SP 或标准 RI —— 阶段二还要再换机型。

## 回滚

任何一步不对改回去即可，EIP 和 EBS 都不受影响：

```bash
sudo podman stop -a
aws ec2 stop-instances --region $R --instance-ids $I
aws ec2 wait instance-stopped --region $R --instance-ids $I
aws ec2 modify-instance-attribute --region $R --instance-id $I --instance-type m8g.xlarge
aws ec2 start-instances --region $R --instance-ids $I
cd /opt/tma-projects && source deploy/single-node/env-aws-16g.sh
bash deploy/single-node/podman-prod-minimal.sh
```

---

# 阶段二：→ t4g.medium（后续排期，勿直接执行）

再省 $31/月。**两个前置条件都满足后才能做**。

## 前置条件 1：修掉提现风控的统计失真 🔴

`withdraw-review.service.ts:655`：

```js
const sinceDate = wd?.last_at ? new Date(wd.last_at) : registeredAt
```

风控窗口 = **上次成功提现时间，从未提现过则 = 注册时间**，**没有时间下界**。
归档 30 天前数据后，这类用户的存款额、投注额、盈亏、高倍中奖检测全部只剩 30 天内的。

生产实测受影响规模：

```
总用户                                    2329
注册超 30 天且从未成功提现                1989  (85%)
  其中近 30 天有投注（会真实触发风控）     161  ← 高危
```

后果：这 161 人发起提现时，`large_profit` / 存提比 / `high_multiple_profit`
等规则基于残缺数据判断，**可能放行本该转人工审核的提现**。这是资金安全问题。

补救方案（三选一，需单独排期）：
1. 建用户级风控快照表，归档前把历史存款/投注/盈亏固化进去，风控改读快照 + 近期明细
2. 给 `bg_bet_order` / `bg_wallet_ledger` 保留按用户聚合的汇总行，只删明细行
3. 把风控窗口改成有下界（需业务确认风控口径能否接受）

另有边缘情况：`turnover.service.ts:reverseBetTurnover` 需要 JOIN 原始 `bg_bet_order`
回退打码量，30 天后才发生的撤单会回滚不了。极罕见，但若上游厂商有长周期对账撤单需确认。

## 前置条件 2：归档把工作集压到 1280M 以内

### 保留窗口 30 天，其余业务实测安全

**A. 不受影响 —— 已有增量维护的累计列或日汇总表**

| 业务 | 为什么安全 |
|---|---|
| VIP 等级 | 读 `bg_user_vip_state.turnover_total`，core 写侧事务内增量维护（迁移 151） |
| 返水累计 | 同上，读累加列 |
| 打码量 / 提现门槛 | `bg_turnover_requirements.completed_amount` 独立累计 |
| 团队流水 | 历史读 `bg_team_turnover_daily`，只有当天才读 `bg_bet_order` |
| 代理佣金 | `bg_agent_ggr_monthly` |
| 全部 BI 报表 | `bi_daily_platform/game/user/provider/active`，7/19 起持续填充 |
| 风控关联账号 | 查 `bg_login_log`（4.7MB），**不在归档清单内** |

`vip.service.ts` 那处 `SUM(bg_turnover_logs) GROUP BY user_id` 也安全 ——
它是 `INSERT IGNORE` 建行语句，已有行不会被覆盖。

**B. 明细查询查不到 30 天前（预期内的功能损失）**

后台「投注订单」「流水明细」「用户详情→投注/流水」「代理报表明细」、用户端「投注记录」。
用户端「流水」本来就只返回 7 天，无影响。需要时从 `archives/*.sql.gz` 离线恢复。

### 归档范围与实测量（2026-09-13 预演）

| 表 | 待归档行数 | 删除策略 |
|---|---|---|
| bg_bet_order | 1,331,621 | id (bigint 自增) |
| bg_wallet_ledger | 1,383,505 | **time**（id 是 varchar(40) 非自增） |
| bg_568win_wallet_txn | 737,180 | id |
| bg_568win_report_bet | 738,902 | id (order_time) |
| bg_bet_round | 638,236 | id (first_at) |
| bg_turnover_logs | 638,311 | id |
| bg_turnover_allocations | 328,989 | log_id（跟随 logs） |
| **合计** | **5,796,744 行（全库 74%）** | |

归档 + OPTIMIZE 后 betogo 预估 **1.2–1.5 GB**。

**两种删除策略不能统一**：`bg_wallet_ledger.id` 是 `varchar(40)`（形如
`VG_1786656384040_bb1603`）非自增，按 id 比较无意义，它有单列 `idx_created` 直接按时间删；
其余六张表 id 是 `bigint` 自增，先用时间求出 cutoff id 再按主键删
（`bg_bet_round`/`bg_turnover_logs` 的时间列只有复合索引，直接按时间删会退化成 skip scan）。

### 脚本

`scripts/archive/archive-cold-data.sh` —— **手动执行，不在迁移目录，不随部署运行**。

```bash
bash scripts/archive/archive-cold-data.sh                       # 预演
bash scripts/archive/archive-cold-data.sh --apply --optimize    # 执行 + 回收空间
```

内置保护：执行前强制全量备份；先 `mysqldump` 导出 `.sql.gz` 并 `gzip -t` 校验通过才删；
分批 2000 行 + 200ms 间隔。

**归档必须在降配前、在大机器上做** —— 删 580 万行 + OPTIMIZE 4.7GB 数据，
在 2C4G 上会非常痛苦。

## 阶段二执行

前置条件满足后：归档 → 验证库 <1.5GB、工作集 <1.2GB → 按阶段一同样的步骤改机型为
`t4g.medium`，参数换成 `deploy/single-node/env-aws-4g.sh`。

### 长效维护

降配到 medium 后必须持续归档，否则库以约 **57 MB/天（1.7 GB/月）** 涨回去：

```cron
0 9 * * 0 cd /opt/tma-projects && KEEP_DAYS=30 bash scripts/archive/archive-cold-data.sh --apply >> /var/log/archive.log 2>&1
```

`--optimize` 不要放进 cron（重建表代价高），每季度手工跑一次即可。

---

## 附：待办的独立优化（与降配无关）

- **binlog 保留 30 天 → 7 天**：当前 11 个文件占 12GB，调整省约 8GB 磁盘。磁盘目前不紧张。
- **demo 库挪出生产**：`betogo_demo` + `betogo_demo_stage` 占 539MB 磁盘、约 140MB buffer pool。
  挪走能直接腾出工作集，对阶段二有帮助。需确认演示站是否必须跑在生产机。
