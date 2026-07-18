#!/usr/bin/env bash
# AWS EC2 m8g.xlarge（4C16G，Graviton4）生产参数。
#
# 用法：
#   source deploy/single-node/env-aws-16g.sh
#   bash deploy/single-node/podman-prod-minimal.sh
#
# 内存预算（宿主 15Gi 可用）：
#   MySQL 10.0G + bff 0.75G + core 0.5G + redis 0.5G + nats 0.25G + web 0.25G = 12.25G
#   宿主 + page cache + 部署构建尖峰余量 ≈ 3G
#
# MySQL 10G/buffer_pool 8G 是本配置的核心：压测中 64MB buffer pool 在写并发 16-20 时
# 触发雪崩（load 51 / MySQL OOM），失效是悬崖型而非缓坡——内存必须盖住热索引集。

export MEM_MYSQL=10g
export MYSQL_BUFFER_POOL=8G
export MYSQL_MAX_CONN=200

export MEM_BFF=768m          # scrypt 每并发 16-32MB，256m 下并发注册有 OOM 实绩
export MEM_CORE=512m
export MEM_REDIS=512m
export REDIS_MAXMEM=384mb
export MEM_NATS=256m
export MEM_WEB=128m
