#!/usr/bin/env bash
# AWS EC2 t4g.medium（2C4G，Graviton2）生产参数。
#
# 用法：
#   source deploy/single-node/env-aws-4g.sh
#   bash deploy/single-node/podman-prod-minimal.sh
#
# ⚠️ 前置条件（不满足时不要用这套参数）：
#   betogo 库必须已归档到 2GB 以内。未归档的 3GB 库配 1280M buffer pool，
#   命中率会掉到 60% 以下，后台报表查询开始走磁盘。
#   归档见 scripts/archive/archive-cold-data.sh，**必须在降配前跑完**。
#
# 内存预算（宿主 4096MB，内核占用后实际可用约 3800MB）：
#   MySQL 2048 + bff 2×320 + core 192 + redis 128 + nats 64 + web 3×64 = 3264MB
#   宿主 OS + podman + nginx + ssh ≈ 450MB，余量 ≈ 86MB → 靠 swap 兜底
#
# 为什么 MEM_MYSQL(2048) 要比 buffer pool(1280) 大 1.6 倍：
#   见 ensure-mysql-memory.sh —— 容器内存限额不足时 InnoDB 会**静默降级**
#   buffer pool 且不报错。1.25 倍（16g 方案的 10g/8g）在小机器上余量不够，
#   连接缓冲 + 排序缓冲 + InnoDB 字典会把差额吃掉。
export MEM_MYSQL=2g
export MYSQL_BUFFER_POOL=1280M
export MYSQL_MAX_CONN=80          # 历史峰值 28。4G 机器上 200 连接的栈开销是灾难

# scrypt 每并发 16-32MB，256m 下并发注册有 OOM 实绩（见 env-aws-16g.sh）。
# 320m 是实测安全下限，不要再往下压。
export MEM_BFF=320m
export MEM_CORE=192m
export MEM_REDIS=128m
export REDIS_MAXMEM=96mb
export MEM_NATS=64m
export MEM_WEB=64m

# 4G 机器必须有 swap 兜底：部署构建尖峰 + mysqldump 会短时超出预算。
# 没有 swap 时这些尖峰直接触发 OOM killer。由 server-init 或手工建立：
#   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
#   echo '/swapfile none swap sw 0 0' >> /etc/fstab
export REQUIRE_SWAP_MB=2048
