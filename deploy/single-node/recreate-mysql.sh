#!/usr/bin/env bash
# 按当前机器规格重建 tma-mysql 容器（数据在 volume，不会丢）。
#
# 为什么需要它：容器的 --memory 和 --innodb_buffer_pool_size 是创建时固定的，
# 换机器规格后必须重建容器才能永久生效。podman update 只改 cgroup，重启就回退；
# SET GLOBAL 只改运行时值，重启也回退。
#
# 用法：
#   source deploy/single-node/env-aws-8g.sh && bash deploy/single-node/recreate-mysql.sh
#   MEM_MYSQL=5g MYSQL_BUFFER_POOL=4G MYSQL_MAX_CONN=120 bash deploy/single-node/recreate-mysql.sh
set -euo pipefail

CTR="${CTR:-podman}"
NET="${TMA_PODMAN_NETWORK:-tma-prod}"
MEM_MYSQL="${MEM_MYSQL:?必须指定 MEM_MYSQL，例如 5g}"
MYSQL_BUFFER_POOL="${MYSQL_BUFFER_POOL:?必须指定 MYSQL_BUFFER_POOL，例如 4G}"
MYSQL_MAX_CONN="${MYSQL_MAX_CONN:-120}"

SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"
P="$SUDO $CTR"
log() { echo "[$(date '+%F %T')] $*"; }

# 凭证从运行中的容器取，避免落到命令行或临时文件
RP=$($P exec tma-mysql printenv MYSQL_ROOT_PASSWORD)
MD=$($P exec tma-mysql printenv MYSQL_DATABASE 2>/dev/null || echo betogo)
[ -n "$RP" ] || { log "取不到 MYSQL_ROOT_PASSWORD，中止"; exit 1; }
log "目标：memory=$MEM_MYSQL buffer_pool=$MYSQL_BUFFER_POOL max_conn=$MYSQL_MAX_CONN"

log "优雅停止（最多 120s 等 InnoDB flush）"
$P stop -t 120 tma-mysql

log "删除容器（volume tma-mysql-data 保留）"
$P rm tma-mysql

log "重建"
$P run -d --name tma-mysql --network "$NET" --network-alias mysql --restart=always \
  --memory="$MEM_MYSQL" --memory-swap="$MEM_MYSQL" \
  -p 127.0.0.1:13306:3306 \
  -v tma-mysql-data:/var/lib/mysql:Z \
  -e MYSQL_ROOT_PASSWORD="$RP" \
  -e MYSQL_DATABASE="$MD" \
  -e TZ=UTC \
  docker.io/library/mysql:8.0 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci \
  --default-authentication-plugin=mysql_native_password \
  --max_connections="$MYSQL_MAX_CONN" \
  --innodb_buffer_pool_size="$MYSQL_BUFFER_POOL" \
  --performance_schema=OFF \
  --table_open_cache=200 > /dev/null

log "等待就绪…"
for i in $(seq 1 60); do
  if $P exec tma-mysql mysqladmin -uroot -p"$RP" ping 2>/dev/null | grep -q alive; then
    log "MySQL 就绪（第 ${i}0 秒内）"
    ACTUAL=$($P exec tma-mysql mysql -uroot -p"$RP" -N -e "SELECT @@innodb_buffer_pool_size/1048576;" 2>/dev/null)
    CONN=$($P exec tma-mysql mysql -uroot -p"$RP" -N -e "SELECT @@max_connections;" 2>/dev/null)
    log "实际 buffer_pool=${ACTUAL}MB  max_connections=${CONN}"
    exit 0
  fi
  sleep 1
done
log "✗ 60 秒内未就绪，请检查 $CTR logs tma-mysql"
exit 1
