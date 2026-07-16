# 客户端核心业务全面压测方案

> 版本：v1（2026-07-16）
> 目标：对 home / bonuses / team / games / menu / tasks / rebate / vip / 注册登录 / 充值提现历史 / 下注结算 共 11 个业务域做全面压力测试，检查设计、逻辑与效率，找出优化点，并为生产服务器选型给出量化依据。
> 配套 runbook：`scripts/loadtest/README.md`（操作命令）；本文档是**计划 + 范围 + 进度 + 结论**的唯一入口，跨 session 恢复工作先读本文档第 9 节。

---

## 1. 背景与已有基础

已有脚手架（`scripts/loadtest/`，可直接复用）：

| 资产 | 作用 |
|------|------|
| `seed-users.mjs` / `cleanup.mjs` | 种子用户池（LT-i / LTK-i，直写 Redis+MySQL，绕过 captcha） |
| `k6/lib.js` | 鉴权头 + 设备指纹 + small/medium/large 阶梯档位 + 通用阈值（p95<800ms、错误率<1%） |
| `k6/a-balance.js` | 纯 Redis 读天花板 |
| `k6/b-mysql-read.js` | MySQL 读（games 分页 + bets JOIN） |
| `k6/c-mixed.js` | 混合流量（余额40/游戏25/用户15/注单10/任务10） |
| `k6/knee.js` | 定并发逐档拐点探测 |
| `monitor.sh` | 服务器侧 2s 粒度资源采集 CSV（容器 CPU/内存、MySQL threads、Redis 内存） |
| `db-lock-bench(-full).mjs` | 直压 bg_wallet 行锁，复刻 Deduct/Settle 完整写入集（5-6 写/事务） |
| `BFF_DISABLE_RATE_LIMIT=true` | 限流旁路开关（压完必关，用 `recreate-bff-node.sh` 生效） |

已有结论（不必重测，直接进优化清单）：

- `/bets` 旧实现读天花板 ~17 req/s、拐点 <5 并发，根因 group-then-sort 临时表+filesort；**已用 bg_bet_round 预聚合修复**（迁移 149），修复后需复测确认。
- 下注结算写事务为 5-6 写/事务 + bg_wallet `FOR UPDATE` 行锁，db-lock-bench 已量化 DB 层成本（core HTTP 层拐点待测）。

被测环境：阿里云 2C2G 单节点（47.84.34.139，全部容器同机），入口 `https://www.188facai.com`（真实 nginx→bff）。k6 从本地 Mac 发压。**测试机很小，所有场景先 small 档摸底。**

---

## 2. 测试范围矩阵（页面 → 接口 → 存储特征）

> 完整接口清单含义：压测按「接口基线 → 页面首屏 → 混合流量 → 写专项」四层递进（见第 3 节）。
> 存储特征标注：R=Redis、M=MySQL 单表、J=MySQL JOIN、X=外部三方、W=写事务。

### 2.1 全局启动链（每次打开 App 必发，权重最高）

| 接口 | 特征 |
|------|------|
| POST /auth/session | R |
| GET /user/me | R |
| GET /promotions/config | R |
| GET /promotions/new-player-summary | R+M（2 次 EXISTS） |
| GET /wallet/balances | R |

### 2.2 各页面首屏 + 核心交互

| 页面 | 读接口（首屏） | 写接口（交互） |
|------|----------------|----------------|
| home | GET /home/content、/slots/homepage(30min缓存)、/wallet/balances、/slots/betting-activity | POST /slots/init（X，mock 或跳过） |
| bonuses | GET /promotions、/promotions/app-download、/promotions/red-packets、/promotions/checkin/status | POST /promotions/{app-download,trial-play,firstdep,checkin}/claim（W） |
| team | GET /promotions/team/status、/team/tree（J）、/team/downlines（J）、/team/commissions、/team/wallet、/team/withdrawals | POST /team/enable、/team/withdraw（W） |
| games | GET /slots/games（M 分页）、/slots/providers、/slots/history | POST /slots/init（X） |
| menu | GET /vip/progress、/kyc/status（+全局 balances/me） | — |
| tasks | GET /tasks、/vip/progress、/rebate/progress | POST /tasks/:id/claim、/tasks/social/:key/claim（W） |
| rebate | GET /rebate/config、/rebate/progress（流水聚合）、/rebate/summary | POST /rebate/claim（W） |
| vip | GET /vip/progress、/vip/levels、/vip/rewards、/vip/loss-rebate-status | POST /vip/claim（W） |
| 注册登录 | GET /auth/session、POST /auth/refresh | POST /auth/register（W+Turnstile）、/auth/login（失败限流）、/auth/telegram |
| 充值提现历史 | GET /deposits、/withdrawals、/ledger（bg_wallet_ledger）、/payment/*/orders、/turnover | POST /deposits、/withdrawals（W+X，只测到落单不打真三方） |
| 下注结算 | GET /bets（预聚合后复测） | core-node POST /Deduct、/Settle、/ReturnStake、/Rollback、/Cancel（W，行锁热点） |

### 2.3 外部依赖（一律 mock 或跳过，不打真三方）

`POST /slots/init`（568win 启动）、`/auth/google`、`/auth/telegram-oidc`、`/auth/forgot-password/send-otp`、所有三方支付下单/查询（payment/yfpay）。core 回调压测由我们自造合法 CompanyKey 请求，不依赖 568win 真回调。

### 2.4 压测障碍与对策

| 障碍 | 对策 |
|------|------|
| 全局限流 | `BFF_DISABLE_RATE_LIMIT=true` 旁路，压完必关 |
| /auth/register 强制 Turnstile | 测试环境置空 `TURNSTILE_SECRET_KEY`，压完恢复 |
| /auth/login 失败锁定（ip+identifier） | 种子池预置正确密码账号，只测成功路径；错误路径单独小并发验证限流本身有效 |
| LT 用户无历史数据 | P0 灌数：给部分 LT 用户造注单/账变/团队关系（见 3.1） |
| core-node 4000 不对公网 | 服务器上跑发压脚本（podman exec / 落地 autocannon），或 ssh 隧道转发到本地 k6 |

---

## 3. 分阶段执行计划

### P0 准备（半天）

1. 种子池 500 用户（LT-1..500），并给其中 3 组灌数据：
   - **重历史组**（LT-1..50）：每人 3000 局注单（bg_bet_order/bg_568win_wallet_txn/bg_bet_round）+ 5000 条 ledger —— 压 /bets、/ledger 的真实数据量成本；
   - **团队组**（LT-51..80）：3 级下线各 50/20/10 人 + 佣金记录 —— 压 team/tree、downlines JOIN；
   - **轻用户组**（其余）：仅钱包+余额，模拟新用户。
   - 产出灌数脚本 `scripts/loadtest/seed-history.mjs`（幂等、可 cleanup）。
2. 开限流旁路、置空 Turnstile、起 monitor.sh。
3. 基线记录：空载时各容器 CPU/内存、MySQL buffer pool 命中率。

### P1 读接口逐项基线（1 天）——「哪个接口最先倒」

用 `knee.js` 模式对下列接口**逐个**定并发扫描（VUS=5/10/20/40，each 60s），记录拐点：

- 优先级 ①（JOIN/聚合重查询）：`/bets`（重历史组用户）、`/promotions/team/tree`、`/team/downlines`、`/rebate/progress`、`/ledger`
- 优先级 ②（高频单表/Redis）：`/wallet/balances`、`/user/me`、`/slots/games`、`/tasks`、`/vip/progress`、`/promotions/checkin/status`、`/deposits`、`/withdrawals`
- 优先级 ③（低频配置类）：`/home/content`、`/slots/homepage`、`/vip/levels`、`/rebate/config`、`/promotions/config`

产出：每接口一行的基线表（见 5.1 模板）。**p95 劣化或错误率>1% 的档位即拐点；拐点异常低（如旧 /bets 的 17rps）→ 进优化清单。**

### P2 页面级首屏场景（半天）——「用户打开一个页面的真实成本」

为每个页面写一个 k6 场景：一次迭代 = 该页首屏全部请求并发发出（http.batch），模拟真实打开页面。新增 `k6/page-<name>.js` × 11。记录：单页首屏 P95 总耗时、每秒可支撑「页面打开次数」。

### P3 混合真实流量（半天）——「系统级拐点，服务器选型主依据」

扩展 `c-mixed.js` 权重覆盖全部页面（按真实用户行为估计：启动链 30% / home 15% / games 15% / 钱包历史 10% / bonuses 8% / tasks 7% / vip 5% / team 4% / rebate 3% / bets 3%），small→medium 阶梯，配合 monitor.sh 定位瓶颈层（bff CPU vs MySQL CPU vs 内存）。

### P4 写事务专项（1 天）——「钱高频路径的正确性 + 吞吐」

| 场景 | 方法 | 关注点 |
|------|------|--------|
| 下注+结算（核心） | 服务器侧直压 core `POST /Deduct`→`/Settle`（合法 CompanyKey，多用户并发 + 单用户串行两种） | bg_wallet 行锁等待、事务吞吐、与 db-lock-bench 的 DB 层数据对比得出 HTTP 层开销；**并发下余额一致性**（压完对账：ledger 求和 == 余额变化） |
| 领奖类 claim | 多用户并发打 checkin/tasks/rebate/vip claim | 防重（同用户并发 10 请求只成功 1 次）、锁竞争 |
| 注册 | 并发 /auth/register（Turnstile 已置空） | 建号事务吞吐、唯一键冲突处理 |
| 登录 | 种子账号并发 /auth/login | bcrypt/argon CPU 成本（预计是 CPU 大户） |
| 充值/提现落单 | POST /deposits、/withdrawals（不真打三方，观察到落单/被拒即可） | 防重锁、风控校验成本 |

写专项每个场景跑完必须**对账**：余额/ledger/订单计数一致才算通过——压测同时是并发正确性测试。

### P5 数据量敏感性（半天）——「半年后还快吗」

把重历史组数据翻 3 倍（1 万局/人），复跑 P1 优先级①接口，观察 p95 是否随数据量线性/超线性劣化。超线性 → 缺索引或查询设计问题，进优化清单。

### 收尾（每轮压完）

cleanup.mjs 清种子 → 关限流旁路 + 恢复 Turnstile → recreate-bff-node.sh → 停 monitor.sh → 结果回填本文档第 5/6 节 → commit。

---

## 4. 判读标准

- **拐点定义**：p95 > 800ms 或错误率 > 1% 的最低并发档。
- **瓶颈层判定**：拐点时刻对齐 monitor CSV —— bff CPU 饱和=Node 层；MySQL CPU/threads 飙升=查询层；内存逼近 limit/swap 涨=容量层；均不饱和但 p95 高=锁等待或外部依赖。
- **红线（保护 2C2G 测试机）**：swap 猛涨或任一容器逼近内存 limit 立即停；单场景最长 5 分钟；medium 档以上需前一档完全健康才升。

## 5. 结果记录（跨 session 回填区）

### 5.1 P1 接口基线表 ✅（2026-07-16 服务器本机压测，原始数据 `scripts/loadtest/results/p1-server-2026-07-16.csv`）

**⚠️ 方法论修正（重要，复用必读）**：从 Mac 外部发压的第一轮数据（`results/p1-mac-wan-2026-07-16.csv`）已作废——测试机公网仅 ~2.5Mbps，>2KB 响应的接口先撞带宽墙（homepage 未压缩 67KB 时中位被压到 7.2s，本机实测仅 14ms）。修正两点：①k6 必须带 `Accept-Encoding: gzip`（真实浏览器行为，67KB→7.6KB）②量服务器容量必须本机发压（`LOCAL=1` 钉 127.0.0.1，走本地 nginx 完整链路）。本机压有探针效应（k6 与服务共享 2 核），数字略保守，作选型下限安全。Mac 端数据保留作"带宽瓶颈"证据。

结果（全部 0 错误率；"容量"=吞吐平台值；p95@40 = VU40 时的 p95）：

| 接口 | 数据形态 | 容量(rps) | p95@40 | 梯队 | 结论 | 状态 |
|------|----------|-----------|--------|------|------|------|
| GET /tasks | 任务进度 | **45** | **1.06s ❌破线** | 聚合 | 全场最低，唯一破线 → 优化#1 | ✅ |
| GET /promotions/team/tree | 3级80下线 | 73 | 644ms | 聚合 | 最重读之一，观察 | ✅ |
| GET /vip/progress | 有流水 | 76 | 608ms | 聚合 | 观察 | ✅ |
| GET /vip/levels | 配置 | 116 | 212ms@20 | 明细 | 正常 | ✅ |
| GET /bets | 3000局/人 | 120 | 406ms | 明细 | **预聚合改造验证通过**（改前~17rps） | ✅ |
| GET /promotions/team/downlines | 3级80下线 | 160 | 300ms | 明细 | 正常 | ✅ |
| GET /promotions/checkin/status | — | 185 | 264ms | 明细 | 正常 | ✅ |
| GET /rebate/progress | 15万打码流水 | 188 | 272ms | 明细 | 意外健康，索引有效 | ✅ |
| GET /rebate/config | 配置 | 245 | 119ms@20 | 明细 | Mac轮86%错误=MySQL崩溃窗口殃及，本身正常 | ✅ |
| GET /ledger | 6000条/人 | 245 | 225ms | 明细 | 正常 | ✅ |
| GET /withdrawals | 30单/人 | 300 | 189ms | 明细 | 正常 | ✅ |
| GET /slots/homepage | 11分类全量 | 306 | 91ms@20 | 缓存 | Redis缓存有效，Mac端7.2s纯属带宽假象 | ✅ |
| GET /deposits | 100单/人 | 350 | 162ms | 明细 | 正常 | ✅ |
| GET /user/me | — | 440 | 135ms | 缓存 | 正常 | ✅ |
| GET /slots/games | 全量目录 | 505 | 114ms | 缓存 | 内存缓存有效 | ✅ |
| GET /wallet/balances | — | 500 | 118ms | 缓存 | 正常 | ✅ |
| GET /promotions/config | 配置 | 604 | 57ms@20 | 缓存 | 正常 | ✅ |
| GET /home/content | 配置 | 946 | 36ms@20 | 缓存 | 全场最快 | ✅ |

**读侧三梯队结论**：缓存/单键读 300-950 rps；索引明细读 120-350 rps；多查询聚合 45-80 rps。曲线均为"吞吐平台化+延迟随并发线性涨"= 2 核 CPU 共享是统一的顶，无病态查询（/tasks 待查证）。
**事故记录**：Mac 轮压测尾段（16:57）MySQL 容器 OOM 崩溃自动重启（RestartCount 3→4），2C2G 全容器同机持续读压即可打崩 MySQL——生产 DB 必须独立部署/加内存的直接证据。

### 5.2 P2 页面首屏表 ✅（2026-07-16 服务器本机，`results/p2-server-2026-07-16.csv`；打开/秒=iterations rate，P95=整页打开耗时@VU20）

| 页面 | 首屏请求数 | 打开/秒 | 打开P95 | 评价 |
|------|-----------|---------|---------|------|
| games | 3 | 261 | 111ms | 🟢 全缓存 |
| home | 4 | 134 | 204ms | 🟢 |
| bets | 1 | 121 | 209ms | 🟢 |
| startup 启动链 | 5 | 105 | 249ms | ✅ |
| rebate | 3 | 80 | 324ms | ✅ |
| wallet-history | 4 | 54 | 510ms | ✅ |
| menu | 4 | 45 | 511ms | ✅ |
| bonuses | 5 | 39 | 600ms | 🟡 5个促销接口偏重 |
| team | 5 | 26 | 891ms | 🔴 tree+downlines+commissions同屏 |
| tasks | 3 | 24 | 929ms | 🔴 被/tasks(45rps)拖累 |
| vip | 5 | 22 | 992ms | 🔴 vip/progress+rebate/progress+rewards 3聚合同屏 |

**结论**：单接口都不破线，但**页面组合放大聚合接口成本**——vip/tasks/team 三页在 VU20 时整页 P95 逼近 1 秒，是体验上最先变卡的页面；三页的公共病因都是"一屏多个聚合查询"（优化清单#2/#5 的页面级证据）。全部 0 错误。

### 5.3 P3 混合流量系统拐点 ✅（2026-07-16，权重=startup30/home15/games15/钱包历史10/bonuses8/tasks7/vip5/team4/rebate3/bets3）

**服务器本机**（`results/p3-server-2026-07-16.csv`，量服务器容量）：

| VU | 页面打开/s | req/s | 整页P95 | 错误率 | load |
|----|-----------|-------|---------|--------|------|
| 10 | 61.7 | 254 | 379ms | 0 | 9.2 |
| 20 | 60.3 | 249 | **850ms ⚠️拐点** | 0 | 10.2 |
| 40 | 60.5 | 248 | 1.82s | 0 | 10.2 |
| 60 | 57.4 | 236 | 2.97s | 0 | 10.1 |

**Mac 走公网**（`results/p3-mac-wan-2026-07-16.csv`，量带宽墙，gzip 已开）：

| VU | 页面打开/s | req/s | 整页P95 |
|----|-----------|-------|---------|
| 5 | 26.0 | 107 | 676ms |
| 10 | 25.7 | 106 | 1.40s ⚠️ |
| 20 | 21.4 | 90 | 2.92s |

**结论**：
- 服务器容量 = **~60 页面打开/s（≈250 req/s）**，拐点 VU15-20；饱和后吞吐平、延迟线性涨、0 错误、内存稳——纯 CPU 顶（且含 k6 探针 20-30% 挤占，真实容量更高）。换算：活跃用户每 10s 翻一页 → **≈600 同时活跃用户**。
- 公网带宽墙 = **~26 打开/s（≈107 req/s，2.5-3Mbps 打满）**，只有服务器容量的 43%——**当前测试机对外服务能力由带宽决定，不是算力**。
- 生产带宽估算：混合流量 gzip 后 ≈25-30KB/次页面打开；目标 N 打开/s → 带宽 ≈ N×0.25Mbps。如目标 200 打开/s（≈2000 同时活跃）→ **≥50Mbps 出口或前置 CDN**。

### 5.4 P4 写事务表（进行中，工具=`p4-bet-settle-bench.mjs` 对账版）

| 场景 | 并发 | TPS | p95 | 对账结果 | 防重结果 | 状态 |
|------|------|-----|-----|----------|----------|------|
| Deduct+Settle 多用户 | CONC10/池10 | **266下注/s** | 49ms | **200用户0差错** ✅ | — | ✅ |
| Deduct+Settle 多用户 | CONC12/池10 | 271下注/s | 59ms | 0差错 ✅（21错=0.4%瞬时锁等待） | — | ✅ |
| Deduct+Settle 多用户 | CONC15/池10 | 271下注/s | 71ms | 0差错 ✅ 0错误 | — | ✅ |
| Deduct+Settle 多用户 | CONC20/池10 | **系统雪崩**🔴 | — | — | — | ✅(边界已定) |
| Deduct+Settle 单用户热点 | CONC5→10 | **~75下注/s 平** | 79→147ms | 0差错 ✅ | — | ✅ |
| claim 并发防重 ×4 | 同用户10并发 | — | — | 钱包/ledger 恰1次 ✅ | **4场景全部恰1成功** ✅ | ✅ |
| 注册（修#8后） | CONC5→10 | **~24注册/s 平** | 264→518ms | 顺序取号无孤儿 ✅ | 同名10并发恰1成功+8×409 ✅ | ✅ |
| 登录 | CONC5→10 | **~27登录/s 平** | 245→492ms | — | — | ✅ |
| 提现落单（tg_wallet） | 同用户10并发 | — | — | 恰1单/恰扣1次/ledger恰1条 ✅ | Redis NX 锁 1放行+9×duplicateWithdraw ✅ | ✅ |
| 充值落单 | — | — | — | — | — | ⏭️跳过：落单即真调 Telegram 造 invoice（外部三方），DB 侧仅 1 行 INSERT 无压测价值 |

**P4c 注册/登录（2026-07-16 晚，工具 `p4-auth-bench.mjs`，Turnstile 临时置空已恢复）**：注册 ~24/s、登录 ~27/s，CONC5→10 吞吐都不涨、延迟翻倍 = **scrypt 打满 2 核是统一的顶**（预判"登录是 CPU 大户"证实）。过程发现并修复 3 个问题：①**注册 id 生成高危缺陷**（优化#8，同名 10 并发全 200 且合并进同一账号 → 迁移 150 序列表取号，60500d5）②REPLACE 取号在 InnoDB 并发死锁 3.8% → 改单行 UPDATE+LAST_INSERT_ID（a656d44）③同名竞态落败方留孤儿账号+500 → 回收孤儿+映射 409。修复后同名 10 并发 = 恰 1 成功 + 8×409 + 1 死锁重试级错误，id 顺序取号（BG-10008…）。
**P4d 提现防重（工具 `p4-withdraw-bench.mjs`，KYC 用 approved 直插造状态）**：同用户 10 并发 → **恰 1 单落库、钱包恰扣 100 一次、9 个 duplicateWithdraw**；单次审核 = 17 条规则日志（风控引擎成本实测）。转人工告警真发运营群（本轮 ≤3 条，已知会刷屏故吞吐档按用户拍板跳过）。
**⚠️ 压测执行教训（新增两条）**：①**别在 bff 容器内跑发压脚本**——10 并发 scrypt + 脚本本身把 bff 的 256MB cgroup 直接打 OOM 重启（教训已写进脚本头注释；从 core 容器发压）；②**podman aardvark-dns 间歇失败**不止影响 bff 启动，容器间 HTTP（fetch failed）和 exec 脚本连 MySQL 都会随机 ENOTFOUND——发压/清理脚本一律先 `podman inspect` 取容器 IP 直连。

**悬崖收窄（2026-07-16 晚二段）**：吞吐从 CONC10 起即平在 ~270 下注/s（连接池 10 封顶，多余 worker 池外排队），CONC15 仍 0 错误完全健康 → **写并发安全区 ≤15、悬崖在 16-20 之间**；按雪崩教训不再用 CONC18 逼近。
**单用户热点结论**：CONC5→10 吞吐不变（73.5→75/s）、延迟翻倍（66→132ms p50）= 单钱包行 `FOR UPDATE` 完全串行化，**热点账户上限 ~75 下注/s**，加并发只加排队；对比 spread 266/s，行锁热点是单账户维度的天花板（生产上单个高频账户超此频率需热账户队列，与第 6 节第 3 条一致）。
**claim 防重（工具 `p4-claim-bench.mjs`，checkin/tasks/rebate/vip 各同用户 10 并发）**：4 场景全部恰 1 成功 + DB 恰 1 条 + 钱包恰 1 次入账（rebate +8 / vip +8.88），两种防重模式（INSERT IGNORE 唯一键闸门 / FOR UPDATE+status 复核）资金层面全部可靠。**发现并已修 bug**：checkin 竞态窗口内落败请求 500 崩溃（RR 快照看不到赢家已提交行，`row` undefined 读 `.track`）→ 补 `!row` 判定返 409（commit 7ea6c62，复跑验证 9×409 干净）。

**⚠️ 2026-07-16 晚事故记录（选型关键证据）**：CONC20 直压（灌入 90 万行历史后）触发负载雪崩——load 冲到 51、SSH 不可入、约 25 分钟后 MySQL OOM 自动重启才解开（RestartCount+1）；期间仅完成 ~30 个周期即卡死。同机同脚本 CONC10 完全健康（266/s、对账零差错）。结论：**写侧失效是悬崖型**（读侧过载只是缓坡变慢、P3 VU60 仍 0 错误）——根因=数据体量超出 64MB buffer pool 后写事务的随机索引 IO 放大，写并发一旦超过 IO 消化能力即连锁失稳。生产要求：①MySQL 内存必须覆盖热索引集 ②写路径连接池上限当硬闸门（勿盲目放大，与上轮 POOLMAX30 反而压垮的结论互证）③测试机上写压测档位间必须回读 load 确认归零再升档。恢复后已核验：p4 残留=0、种子数据完好（15 万局+500 钱包）。

### 5.5 P5 数据量敏感性 ✅（2026-07-16 晚，重历史组 3000→9000 局/人=3 倍，`results/p5-server-2026-07-16.csv`，team 系列当对照组）

| 接口 | P1 容量→P5 容量 | P1 p95@40→P5 | 判定 |
|------|----------------|--------------|------|
| /bets | 120→111（-8%） | 406→415ms | 🟢 **预聚合改造经受住 3 倍数据**（bg_bet_round 设计验证成功） |
| /ledger | 245→200（-18%） | 225→247ms | 🟢 亚线性，索引分页健康 |
| /rebate/progress | 188→**84（-55%）** | 272→554ms | 🔴 **超线性劣化**，容量腰斩 |
| /vip/progress | 76→53（-30%） | 608→**866ms 破线** | 🔴 同病根 |
| team/tree（对照，数据未变） | 73→73 | 644→672ms | ✓ 无环境漂移，对比有效 |
| downlines（对照） | 160→174 | 300→269ms | ✓ |

**结论**：/bets、/ledger 的"预聚合+索引扫一页"路径扛住了数据增长；**rebate/vip 共用的总流水聚合（`getUserTotalTurnover` 对 bg_turnover_logs 全量 SUM）随数据线性放大成本**——数据再涨（半年真实运营）这两个接口会继续腰斩，方向=流水累计预聚合（进优化清单#11）。
**瞬态事故记录**：灌数（+180 万行）后立即压测，rebate VU10/20 两档出现 100% 60 秒超时窗口，复跑四档全平 0 错误不可复现 → 根因=MySQL 灌后 purge/change buffer 后台 IO 未消化完。**教训：大批量灌数/迁移后必须等后台 IO 归零再压测/放量**（生产数据迁移后同理）。

### 5.6 优化落地前后对比 ✅（2026-07-16 晚，同 P1/P5 服务器本机 LOCAL=1 口径）

| 接口 | 优化前 | 优化后 | 提升 | 手法 |
|------|--------|--------|------|------|
| /rebate/progress | P1 188 / P5(3×数据) 84 rps | **450 rps** | 2.4× vs P1、5.4× vs P5，且**不再随数据量变化** | #11 总流水累计列（bg_user_vip_state.turnover_total 写侧增量维护，读侧单行主键查替代全量 SUM） |
| /vip/progress | P1 76 / P5 53 rps，p95@40 866ms❌ | **~100 rps，p95@40 447ms** ✅ | 破线转健康 | 同#11（共用 getUserTotalTurnover） |
| /tasks | 45 rps，p95@40 1.06s❌ | **208 rps，p95@40 272ms** ✅ | 4.6×，破线转健康 | #2 20s 用户级短缓存（claim 主动失效） |

**⚠️#2 走过的弯路（重要教训）**：先试"把单请求内十余次串行查询改 Promise.all 并行"——**在池 10 + 2 核小机上实测 45→15rps 反向劣化**。根因=单请求并行 fire 多查询各占一条池连接，几个并发请求就把 10 连接池打空、互相头阻塞。**结论：小连接池下减查询次数（缓存/合并 SQL）才是正解，并行化只在大池+多核才收益**（与生产场景 E"连接池读 30 写 10-15"档位互证）。已回退并行、改短缓存。

### 5.7 优化点清单（随测随记）

| # | 发现 | 影响 | 建议 | 状态 |
|---|------|------|------|------|
| 1 | /bets group-then-sort（已修） | 读天花板17rps | bg_bet_round 预聚合（已上线） | ✅复测通过(120rps) |
| 2 | /tasks 容量仅45rps，VU40 p95 1.06s破线 | tasks页+首页浮窗高频接口 | 20s 用户级短缓存+claim 主动失效（并行化尝试反劣化已回退，见5.6） | ✅已修，复测 208rps/p95 272ms |
| 3 | 测试机公网带宽~2.5Mbps是外部访问第一瓶颈 | 真实用户体验直接受限 | **生产采购必含带宽/CDN**：按gzip后首页链路~15KB/打开、峰值100打开/s → 出口≥12Mbps起步；静态与游戏列表走CDN | ⬜选型输入 |
| 4 | MySQL 容器在持续读压下OOM崩溃(重启+3) | 全站不可用~1分钟/次 | 生产：DB独立部署+buffer pool≥数据集；测试机勿再全容器同机高压 | ⬜选型输入 |
| 5 | team/tree(73rps)与vip/progress(76rps)聚合偏重 | 高并发下最先劣化的第二梯队 | vip/progress 已随#11 解决(→100rps)；team/tree 暂不动，生产加核后复测，若仍<150rps再优化 | 🟡team仍观察 |
| 6 | bff MySQL 连接池=10（上轮结论沿用） | 读写吞吐上限因素 | 生产按核数调大(30+)，写重场景压测验证 | ⬜选型输入 |
| 7 | checkin claim 并发竞态落败请求 500 崩溃（RR 快照下 row undefined） | 仅体验/告警噪音，无资金风险 | 补 `!row`→409（P4b 发现即修） | ✅已修(7ea6c62) |
| 8 | **注册 id 生成两重缺陷（P4c 同名并发测试挖出，🔴高危）**：①`nextUserId`=全表 `MAX(CAST(SUBSTRING(id,4) AS UNSIGNED))+1`，遇到非 `BG-<n>` 格式 id（如压测 LTD-* 下线号）负数回绕到 2^64，之后**所有注册都算出同一 id**；②即使 id 全合法，MAX+1 无锁竞态下两个同瞬注册算出同一 id，`saveUser` 的 `ON DUPLICATE KEY UPDATE` **静默合并两个陌生人到同一账号/钱包**。测试实证：10 并发同名注册全部 200 返回同一 uid，两轮不同用户名绑进同一账号（坏账号已清理） | 生产并发注册可发生账号合并=资金互通，属正确性红线 | 迁移150 单行序列表取号（UPDATE+LAST_INSERT_ID，REPLACE 版并发死锁已二次修正）+ 同名落败回收孤儿账号映射 409 | ✅已修(60500d5+a656d44)，同名10并发复测恰1成功 |
| 9 | bff 容器 256MB 内存 limit 对注册路径偏紧：并发 scrypt 每个可占 16-32MB，10 并发注册+容器内其他负载有 OOM 风险（实测容器内跑发压脚本时打爆过一次） | 注册高峰可能 OOM 重启 bff（约 10s 不可用） | 生产 bff 内存 limit ≥512MB，或注册限流单独收紧（bcrypt/scrypt 类接口天然要限流防 CPU 打满） | ⬜选型输入 |
| 10 | `fail(ctx, 429/500, msg)` 3 参调用 HTTP 状态统一落 400，语义码只在 body.code | 客户端/监控按 HTTP 状态判断会误判 | fail() status 缺省跟随 code（4xx/5xx 自动同步 HTTP 状态），一处修全局193处 | ✅已修 |
| 11 | **rebate/vip 共用的总流水聚合随数据量超线性劣化（P5 实证）**：`getUserTotalTurnover` 每请求对 bg_turnover_logs 全量 SUM，3 倍数据下 /rebate/progress 容量 188→84（-55%）、/vip/progress p95@40 866ms 破线 | 等级/费率/进度是 vip/rebate/tasks 页高频依赖 | 迁移151：bg_user_vip_state.turnover_total 累计列，core 写侧事务内增量维护，读侧单行主键查 | ✅已修，复测 450rps（不再随数据量变化） |
| 12 | 注册/登录 scrypt 密码哈希 24-27/s 即打满 2 核 | 最便宜的 CPU-DoS 攻击面 | auth-credential 限流规则 15/分/IP（register/login/reset），比通用 auth 30/分更严 | ✅已修（收尾关旁路后生效） |

## 6. 生产服务器选型换算（P3/P4 完成后回填）

方法：

1. 流量模型：目标 DAU → 峰值同时在线 ≈ DAU×10%~15% → 峰值 RPS ≈ 在线数 × 0.3~0.5 req/s/人（含启动链+轮询+页面切换，用 P3 权重复核）。
2. 容量换算：2C2G 实测系统拐点 RPS 为基准，Node/MySQL 均近似随核数线性（同架构放大），得出目标 RPS 所需核数；内存按 SERVER-SIZING.md 场景 C 公式（容器 limit×1.3 + 宿主 + 余量）。
3. 写热点单列：下注结算 TPS 上限由 bg_wallet 行锁决定，**不随加核线性扩展**（单用户串行部分）；若 P4 实测 TPS 低于目标（峰值下注 TPS ≈ 在线人数×每人每分钟下注数/60），优化方向按序：事务内写合并/异步化 → 热账户内存队列 → 分库分表。
4. 结论落到 `docs/ops/SERVER-SIZING.md` 新增「场景 E：实测数据版生产选型」章节。

预期产出（回填）：

- [x] 推荐生产起步配置（vCPU/内存/盘/带宽 + 是否拆库）→ **SERVER-SIZING.md 场景 E**（2026-07-16）：App 4C8G + DB 独立 4C16G（buffer pool 10G）+ 30Mbps/CDN
- [x] 各配置档支撑的 DAU 区间 → 起步档 ≤8k DAU、成长档 8k-30k（2×4C8G+SLB / DB 8C32G+从库）、>30k 按读写分离→分区→分表顺序演进
- [x] 扩容触发指标 → 场景 E.3（整页 p95>800ms+CPU>70% 加 App；MySQL CPU>70% 或命中率<99% 升 DB/加从库；带宽>60% 扩 CDN；单账户近 75 下注/s 上热账户队列）
- 备注：换算基准=每 2 核 ≈70 打开/s ≈700 同时活跃；P5 数据量敏感性结果若显示聚合读超线性劣化，起步档读冗余按 6 折复核

## 7. 交付物清单

- [ ] `scripts/loadtest/seed-history.mjs`（历史数据灌注+清理）
- [ ] `scripts/loadtest/k6/page-*.js` × 11（页面首屏场景）
- [ ] `scripts/loadtest/k6/c-mixed.js` 权重扩展版
- [ ] `scripts/loadtest/core-write-bench.mjs`（core 回调 HTTP 层写压测）
- [ ] 本文档 5/6 节全部回填 + SERVER-SIZING.md 场景 E
- [ ] 优化点清单（5.5）逐条转化为修复 commit 或 backlog

## 8. 里程碑

| 阶段 | 预估 | 前置 |
|------|------|------|
| P0 准备+灌数 | 0.5 天 | 方案确认 |
| P1 读基线 | 1 天 | P0 |
| P2 页面首屏 | 0.5 天 | P0 |
| P3 混合拐点 | 0.5 天 | P1 |
| P4 写专项 | 1 天 | P0（可与 P1 并行推进） |
| P5 数据量敏感性 | 0.5 天 | P1 |
| 选型报告 | 0.5 天 | P3+P4 |

合计约 4.5 天（跨多个 session 分批执行，每完成一项回填本文档并 commit）。

## 9. 跨 session 恢复指引

新 session 继续本工作时：

1. 读本文档（`docs/testing/loadtest-plan.md`）→ 看第 5 节各表的 ⬜/✅ 状态，找到第一个未完成项；
2. 读 `scripts/loadtest/README.md` 拿操作命令（种子/旁路/监控/收尾）；
3. 压测前检查：限流旁路是否残留开启、种子数据是否残留（有则先 cleanup）；
4. 每完成一个场景：回填对应表格 → 发现的优化点记入 5.6 → commit（消息带「压测:」前缀）。

生产升级后复用：同一套脚本改 `BASE_URL` 指向生产域名即可复跑 P1-P3 只读部分做验收（写专项 P4 仅在测试环境跑）；对照 5.x 历史数据即得新旧配置容量对比。
