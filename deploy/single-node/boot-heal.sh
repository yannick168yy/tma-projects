#!/usr/bin/env bash
# 开机自愈：podman-restart 起完容器后，修复 aardvark-dns 偶发丢失的 nats 网络别名。
#
# 根因（见 memory reference_deploy_dns）：容器分批/并发启动时，nats 容器的 --network-alias
# 偶发注册失败，导致 core-node 报 `getaddrinfo ENOTFOUND nats` 而 crash-loop（实测 318 次）。
# 本脚本由 betogo-heal.service 在开机后触发，检测到别名丢失就重建 nats + 重启 core/bff。
#
# 幂等：别名正常时直接退出、不动任何容器。
set -uo pipefail
export PATH=/usr/bin:/usr/sbin:/bin:/sbin
NET=tma-prod
DIR=/opt/tma-projects
LOG() { echo "[betogo-heal +$(cut -d. -f1 /proc/uptime)s] $*"; }

# 1. 等关键容器进入 running（最多 ~120s）
for _ in $(seq 1 60); do
  ok=1
  for c in tma-mysql tma-redis tma-nats tma-bff-node; do
    podman inspect "$c" --format '{{.State.Running}}' 2>/dev/null | grep -q true || ok=0
  done
  [ "$ok" = 1 ] && break
  sleep 2
done

# 2. 从 bff 容器验证 nats 别名可解析
if podman exec tma-bff-node getent hosts nats >/dev/null 2>&1; then
  LOG "nats 别名正常，无需修复"
  exit 0
fi

# 3. 别名丢失 → 重建 nats（数据在 volume 不丢）
LOG "nats 别名解析失败，重建 tma-nats"
# shellcheck disable=SC1091
source "$DIR/deploy/single-node/env-aws-16g.sh" 2>/dev/null || true
MEM_NATS="${MEM_NATS:-256m}"
podman rm -f tma-nats >/dev/null 2>&1 || true
podman run -d --name tma-nats --network "$NET" --network-alias nats --restart=always \
  --memory="$MEM_NATS" --memory-swap="$MEM_NATS" \
  -p 127.0.0.1:4222:4222 -v tma-nats-data:/data:Z \
  nats:2.10-alpine -js --store_dir=/data >/dev/null
sleep 5

# 4. 复验 + 重启依赖 nats 的 core/bff
if podman exec tma-bff-node getent hosts nats >/dev/null 2>&1; then
  LOG "别名恢复，重启 core/bff"
  podman restart tma-core-node tma-bff-node >/dev/null 2>&1 || true
  LOG "完成"
  exit 0
fi
LOG "警告：重建后 nats 别名仍解析失败，需人工介入"
exit 1
