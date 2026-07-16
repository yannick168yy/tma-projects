# 压力测试 Runbook

目标：摸清测试机（2 vCPU / 1.8 GB，单节点跑全部容器）的容量拐点与瓶颈层，为生产选型提供换算基准。

被测入口：`https://www.188facai.com`（走真实 nginx → bff-node，最贴近生产）。
k6 从**本地 Mac** 发压（服务器太小，压测工具不能和被测服务抢 CPU）。

## 前置：临时开启限流旁路（压完必关）

代码已支持 `BFF_DISABLE_RATE_LIMIT=true` 旁路全局限流。改 bff env 必须用 recreate 脚本（不能用 podman-compose）：

```bash
# 在服务器上，给 bff 加环境变量后重建
ssh -i ~/TMA_FILES/aliyun.pem root@47.84.34.139
# 编辑 bff 的 env 文件加一行 BFF_DISABLE_RATE_LIMIT=true，然后：
bash /root/workspace/tma-projects/deploy/single-node/recreate-bff-node.sh
```

## 步骤 1：造用户池（种子直接写 Redis，绕过 captcha/登录）

```bash
cd scripts/loadtest
ssh -i ~/TMA_FILES/aliyun.pem root@47.84.34.139 \
  'podman exec -i -e LT_COUNT=200 -e LT_BALANCE=100000000 -e LT_TTL=14400 \
   tma-bff-node node --input-type=module' < seed-users.mjs > tokens.json
# tokens.json = [{userId, token}] × 200，供 k6 读取
```

## 步骤 2：开采集器（服务器后台）

```bash
ssh -i ~/TMA_FILES/aliyun.pem root@47.84.34.139 \
  'bash -s' < monitor.sh > loadtest-metrics.csv &
# 或登陆服务器把 monitor.sh 落地后 nohup 后台跑，产出 CSV
```

## 步骤 3：分场景阶梯加压（先 small，安全再 medium/large）

```bash
# A 纯 Redis 读（Node 吞吐天花板）
k6 run -e PROFILE=small k6/a-balance.js
# B MySQL 读（分页 + 最重 JOIN）
k6 run -e PROFILE=small k6/b-mysql-read.js
# C 混合真实流量（系统级拐点）
k6 run -e PROFILE=small k6/c-mixed.js
```

档位：`PROFILE=small`（10→40 VU，保护小机）/ `medium`（20→150）/ `large`（50→500）。
盯 `podman stats`：内存逼近红线（swap 猛涨 / 容器被 OOM）立即停，别把测试环境打挂。

判读：k6 输出的 `http_req_duration p95/p99`、`http_req_failed rate`，与 CSV 里同时刻的 CPU%/内存/MySQL threads 对齐——**p95 开始劣化或错误率破 1% 的那档 VU 即拐点**，记录此时瓶颈在哪层。

## 步骤 4（可选）：写压测

- 领取类事务：`/promotions/*/claim` 等，需不同用户并发（种子池已满足），注意 promo 桶原限流 10/60s（旁路后无限制）。
- 568Win 钱包行锁（core-node `/Deduct`+`/Settle`）：最能压 MySQL 行锁，但需在 MySQL `bg_wallet` 给测试 username 建行 + 合法 CompanyKey/TransferCode，setup 较重，摸完读场景再决定是否做。

## 步骤 5：收尾

```bash
# 清理种子数据
ssh -i ~/TMA_FILES/aliyun.pem root@47.84.34.139 \
  'podman exec -i tma-bff-node node --input-type=module' < cleanup.mjs
# 关闭限流旁路：删掉 BFF_DISABLE_RATE_LIMIT 后再 recreate-bff-node.sh
# 停掉 monitor.sh
```

## 已知局限

- LT 用户无历史注单，`/bets` 的 JOIN 在空结果集下成本偏低；要压真实 JOIN，需给部分用户灌注单历史（`bg_568win_wallet_txn` 等），或改用有历史的真实账号做只读并发。
- k6 跑在 Mac、走公网到阿里云：绝对延迟含跨网 RTT，但 RPS 拐点由服务器决定，判读拐点不受影响。
