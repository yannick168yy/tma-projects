#!/usr/bin/env bash
# 服务端资源采集 —— 压测期间在服务器上后台运行，每 2s 采一行 CSV，与 k6 时间轴对齐
# 用法（在服务器上）：  bash monitor.sh > /root/loadtest-$(date +%H%M).csv 2>/dev/null &
# 采：时间戳 / 系统负载 / bff·core·mysql·redis 各容器 CPU% 内存 / MySQL 活跃连接 / Redis used_memory
set -u
echo "ts,load1,bff_cpu,bff_mem,core_cpu,core_mem,mysql_cpu,mysql_mem,redis_cpu,redis_mem,mysql_threads,redis_mem_h"
while true; do
  ts=$(date +%H:%M:%S)
  load1=$(awk '{print $1}' /proc/loadavg)
  stats=$(podman stats --no-stream --format "{{.Name}} {{.CPU}} {{.MemUsage}}" 2>/dev/null)
  get() { echo "$stats" | awk -v n="$1" '$1==n{print $2","$3}'; }
  bff=$(get tma-bff-node); core=$(get tma-core-node); my=$(get tma-mysql); rd=$(get tma-redis)
  threads=$(podman exec tma-mysql mysqladmin -uroot status 2>/dev/null | grep -oE 'Threads: [0-9]+' | awk '{print $2}')
  redis_mem=$(podman exec tma-redis redis-cli info memory 2>/dev/null | grep -oE 'used_memory_human:[^ ]+' | cut -d: -f2 | tr -d '\r')
  echo "$ts,$load1,$bff,$core,$my,$rd,${threads:-0},${redis_mem:-NA}"
  sleep 2
done
