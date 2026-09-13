#!/usr/bin/env bash
# AWS EC2 t4g.large（2C8G，Graviton2）生产参数。
#
# 用法：
#   source deploy/single-node/env-aws-8g.sh
#   bash deploy/single-node/podman-prod-minimal.sh
#
# 这套参数不需要归档，直接用 —— 实测热工作集（LRU young 区）约 2.4GB，
# 4G buffer pool 完全盖得住，还剩 1.6G 给增长（约 1 年）。
# 归档是降到 t4g.medium(4G) 才需要的前提，见 docs/ops/downsize-production.md 阶段二。
#
# 内存预算（宿主 8192MB，内核占用后实际可用约 7800MB）：
#   MySQL 5120 + bff 2×512 + core 256 + redis 256 + nats 128 + web 3×64 = 6976MB
#   宿主 OS + podman + nginx + ssh ≈ 500MB，余量 ≈ 324MB + swap 兜底
#
# MEM_MYSQL(5120) : buffer pool(4096) = 1.25 倍 —— 与现行 16G 生产配置
# (MEM_MYSQL=10g / pool=8G) 同比例，已在生产连续跑 56 天验证。
# 差额留给连接缓冲、排序缓冲和 InnoDB 数据字典。
export MEM_MYSQL=5g
export MYSQL_BUFFER_POOL=4G
export MYSQL_MAX_CONN=120         # 历史峰值 28，120 留足余量又不至于让连接栈吃掉内存

# scrypt 每并发 16-32MB，256m 下并发注册有 OOM 实绩（见 env-aws-16g.sh）。
# 8G 机器不必吝啬，给到 512m。
export MEM_BFF=512m
export MEM_CORE=256m
export MEM_REDIS=256m
export REDIS_MAXMEM=192mb
export MEM_NATS=128m
export MEM_WEB=64m

# 2C 机器上跑完整镜像构建会有内存尖峰，swap 兜底避免触发 OOM killer：
#   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
#   echo '/swapfile none swap sw 0 0' >> /etc/fstab
export REQUIRE_SWAP_MB=2048
