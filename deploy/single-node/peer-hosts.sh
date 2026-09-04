#!/usr/bin/env bash
# 容器间互访的固定 IP 与 /etc/hosts 注入（P1-0d：解决 tma-mysql 偶发 ENOTFOUND）
#
# WHY 不能只靠容器 DNS：应用镜像基于 Alpine（musl）。musl 的 resolver 把查询
# **并行**发给 resolv.conf 里的所有 nameserver，谁先回就用谁的应答。容器内是
# [podman dnsmasq 10.89.0.1, 阿里云 VPC DNS 100.100.2.136, 100.100.2.138]，
# 后两个对 tma-mysql 这类容器名返回 NXDOMAIN，且常常比 dnsmasq 先到，
# 于是稳定 3%-10% 的 getaddrinfo 直接 ENOTFOUND（实测 300 并发失败 11 次）。
# 这与 podman 版本无关，跟 aardvark-dns 也无关 —— 本机走的是 CNI dnsname+dnsmasq。
# musl 查 /etc/hosts 先于 DNS，把这几个名字写进 hosts 后该链路完全不走 DNS。
# 实测同样 300 并发：失败 0 次。
#
# 固定 IP 取的就是各容器当前已持有的地址，因此不需要停机重建 MySQL；
# 下次重建时 --ip 会把它钉在原地址，hosts 条目才不会失效。
# 改这里的地址必须同时重建所有相关容器，否则 hosts 会指向错误 IP。

PEER_IP_MYSQL="${PEER_IP_MYSQL:-10.89.0.177}"
PEER_IP_REDIS="${PEER_IP_REDIS:-10.89.0.47}"
PEER_IP_NATS="${PEER_IP_NATS:-10.89.0.48}"
PEER_IP_CORE_NODE="${PEER_IP_CORE_NODE:-10.89.0.75}"
PEER_IP_BFF_NODE="${PEER_IP_BFF_NODE:-10.89.0.84}"

# 以运行中容器的真实 IP 为准，取不到才用上面的固定值。
# 目的是 IP 万一漂移时 hosts 跟着漂，而不是把错误地址钉死 —— 后者比 DNS 抖动更糟。
_peer_live_ip() {
  local name="$1" ctr="${CTR:-podman}"
  "$ctr" inspect "$name" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null | head -1
}

# 用法：peer_host_args <本容器名>，输出可直接展开的 --add-host 参数
# 本容器自己不写进 hosts（重建时它还不存在）
peer_host_args() {
  local self="${1:-}"
  local entry name ip live
  local -a args=()
  for entry in \
    "tma-mysql:$PEER_IP_MYSQL:tma-mysql mysql" \
    "tma-redis:$PEER_IP_REDIS:tma-redis redis" \
    "tma-nats:$PEER_IP_NATS:tma-nats nats" \
    "tma-core-node:$PEER_IP_CORE_NODE:tma-core-node" \
    "tma-bff-node:$PEER_IP_BFF_NODE:tma-bff-node"
  do
    name="${entry%%:*}"
    [[ "$name" == "$self" ]] && continue
    ip="${entry#*:}"; ip="${ip%%:*}"
    live="$(_peer_live_ip "$name")"
    if [[ -n "$live" && "$live" != "$ip" ]]; then
      echo "  ⚠️  ${name} 实际 IP ${live} 与固定值 ${ip} 不一致，按实际值写 hosts（请更新 peer-hosts.sh）" >&2
      ip="$live"
    fi
    local h
    for h in ${entry##*:}; do args+=(--add-host "${h}:${ip}"); done
  done
  printf '%s\n' "${args[@]}"
}
