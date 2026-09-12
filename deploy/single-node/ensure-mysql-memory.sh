#!/usr/bin/env bash
# 保证 MySQL 的内存限额与 buffer pool 达到目标值。幂等，已达标则不动任何东西。
#
# 为什么需要它：
#   容器启动参数里写的是 --innodb_buffer_pool_size=256M，但容器内存限额只有
#   512MB 时，InnoDB 分配不出 256MB，会**静默降级到 128MB** —— 日志里没有告警，
#   只能靠查 @@innodb_buffer_pool_size 才发现。
#   而 `podman update` 改的是 cgroup，容器一重启就回退到创建时的配置。
#
#   两者叠加的结果是：重启一次，buffer pool 悄悄掉回 128MB，演示时翻页开始走
#   磁盘 IO，而没有任何地方会报错。所以用一个幂等脚本定期兜住。
#
# 用法：
#   bash ensure-mysql-memory.sh              # 检查并修正
#   TARGET_MEM=1g TARGET_POOL=384 bash ...   # 自定义目标
#
# 永久生效需要重建容器（改创建时的 --memory）。在那之前由本脚本 + cron 兜底。

set -uo pipefail
export PATH=/usr/bin:/usr/sbin:/bin:/sbin

APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
TARGET_MEM="${TARGET_MEM:-768m}"          # 容器内存限额
TARGET_MEM_SWAP="${TARGET_MEM_SWAP:-1536m}"
TARGET_POOL_MB="${TARGET_POOL_MB:-256}"   # innodb_buffer_pool_size

LOG() { echo "[mysql-mem $(date '+%F %T')] $*"; }

$CTR inspect "$MYSQL_CTR" >/dev/null 2>&1 || { LOG "容器 $MYSQL_CTR 不存在，跳过"; exit 0; }
[ "$($CTR inspect "$MYSQL_CTR" --format '{{.State.Running}}')" = "true" ] || { LOG "容器未运行，跳过"; exit 0; }

# 1) cgroup 内存限额
CUR_LIMIT=$($CTR exec "$MYSQL_CTR" cat /sys/fs/cgroup/memory.max 2>/dev/null \
         || $CTR exec "$MYSQL_CTR" cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
TARGET_BYTES=$(numfmt --from=iec "${TARGET_MEM^^}" 2>/dev/null || echo 805306368)

if [ -n "$CUR_LIMIT" ] && [ "$CUR_LIMIT" != "max" ] && [ "$CUR_LIMIT" -lt "$TARGET_BYTES" ]; then
  LOG "内存限额 $((CUR_LIMIT/1048576))MB 低于目标 $((TARGET_BYTES/1048576))MB，调整中"
  $CTR update --memory "$TARGET_MEM" --memory-swap "$TARGET_MEM_SWAP" "$MYSQL_CTR" >/dev/null \
    && LOG "限额已调整" || LOG "⚠️ 限额调整失败"
else
  LOG "内存限额已达标"
fi

# 2) buffer pool。是动态变量，可在线扩容，不必重启
[ -r "$APP_DIR/.env" ] || { LOG "读不到 $APP_DIR/.env，跳过 buffer pool 检查"; exit 0; }
PW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' "$APP_DIR/.env" | cut -d= -f2- | tr -d "\"'")

CUR_POOL=$($CTR exec "$MYSQL_CTR" mysql -uroot -p"$PW" -sN \
  -e "SELECT @@innodb_buffer_pool_size DIV 1048576" 2>/dev/null)
if [ -z "$CUR_POOL" ]; then LOG "⚠️ 连不上 MySQL，跳过"; exit 0; fi

if [ "$CUR_POOL" -lt "$TARGET_POOL_MB" ]; then
  LOG "buffer pool ${CUR_POOL}MB 低于目标 ${TARGET_POOL_MB}MB，在线扩容中"
  $CTR exec "$MYSQL_CTR" mysql -uroot -p"$PW" \
    -e "SET GLOBAL innodb_buffer_pool_size = $((TARGET_POOL_MB*1048576));" 2>/dev/null
  sleep 3
  NEW=$($CTR exec "$MYSQL_CTR" mysql -uroot -p"$PW" -sN \
    -e "SELECT @@innodb_buffer_pool_size DIV 1048576" 2>/dev/null)
  if [ "${NEW:-0}" -ge "$TARGET_POOL_MB" ]; then
    LOG "buffer pool 已扩到 ${NEW}MB"
  else
    # 没扩上去基本就是内存不够 —— InnoDB 这时不报错，只是维持原值
    LOG "⚠️ buffer pool 仍为 ${NEW}MB，多半是容器内存不足，检查限额与宿主机余量"
  fi
else
  LOG "buffer pool 已达标（${CUR_POOL}MB）"
fi
