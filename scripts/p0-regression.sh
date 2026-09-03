#!/usr/bin/env bash
# P0 租户化改造全站回归。
#
# 在目标服务器上直接探测（无需浏览器/隧道），覆盖：
#   服务健康 / 公开接口 / 鉴权链路 / 回调四路径 / 数据完整性 / 日志错误 / 资源占用
# 只读，不写任何业务数据。
#
# 用法：
#   DEPLOY_HOST=root@47.84.34.139 SSH_IDENTITY_FILE=... bash scripts/p0-regression.sh
set -euo pipefail

HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST}"
SSH_ARGS=()
[[ -n "${SSH_IDENTITY_FILE:-}" ]] && SSH_ARGS+=(-i "${SSH_IDENTITY_FILE/#\~/$HOME}")
[[ -n "${SSH_OPTS:-}" ]] && SSH_ARGS+=($SSH_OPTS)

ssh "${SSH_ARGS[@]}" "$HOST" "bash -s" <<'REMOTE'
set -uo pipefail
cd /root/workspace/tma-projects
RPW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2- | tr -d "\"'")
BFF=http://127.0.0.1:3000
CORE=http://127.0.0.1:4000
SITE=https://www.188facai.com
r() { podman exec tma-mysql mysql --default-character-set=utf8mb4 -uroot -p"$RPW" -sN "$@" 2>/dev/null; }

PASS=0; FAIL=0
ok()  { echo "  [OK] $1"; PASS=$((PASS+1)); }
bad() { echo "  [NG] $1"; FAIL=$((FAIL+1)); }

# probe <名称> <URL> <期望码|alive> [方法]
#   alive = 只要求「存在且不崩」：非 5xx 且非 404。
#   404 不能算通过 —— 路径写错会被 404 掩盖成假通过，这类假绿比红更危险。
probe() {
  local name="$1" url="$2" expect="$3" method="${4:-GET}"
  local code
  if [ "$method" = "POST" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST -H 'Content-Type: application/json' -d '{}' "$url")
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$url")
  fi
  if [ "$code" = "000" ]; then bad "$name：连接失败"; return; fi
  if [ "$expect" = "alive" ]; then
    case "$code" in
      5*)  bad "$name：$code（服务端错误）";;
      404) bad "$name：404（路径不存在，检查探测路径或路由）";;
      *)   ok "$name（$code）";;
    esac
  elif [ "$code" = "$expect" ]; then ok "$name（$code）"
  else bad "$name：期望 $expect，实际 $code"; fi
}

echo "========== P0 全站回归 =========="
echo "时间: $(date -u '+%Y-%m-%d %H:%M:%SZ') UTC"

echo
echo "── 1. 服务健康 ──"
probe "BFF /health"   "$BFF/health" 200
probe "core /health"  "$CORE/health" 200
probe "站点首页"       "$SITE/" alive
probe "站点 site/config" "$SITE/api/v1/site/config" 200

echo
echo "── 2. 公开接口（不得 5xx）──"
probe "首页内容"   "$BFF/api/v1/home/content" alive
probe "公告"       "$BFF/api/v1/announcements" alive
probe "游戏列表"   "$BFF/api/v1/slots/games" alive
probe "投注活跃度" "$BFF/api/v1/slots/betting-activity?tab=latest" alive
probe "支付渠道"   "$BFF/api/v1/payment/channels" alive
probe "VIP 等级"   "$BFF/api/v1/vip/levels" alive

echo
echo "── 3. 鉴权链路（未带 token 必须 401/403，不能 500）──"
for p in /api/v1/user/me /api/v1/wallet/balances /api/v1/bets/ /api/v1/withdrawals/records /api/v1/ledger/records; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$BFF$p")
  case "$code" in
    401|403) ok "受保护 $p（$code）";;
    5*)      bad "受保护 $p 返回 $code（鉴权链路异常）";;
    *)       bad "受保护 $p 返回 $code（应为 401/403）";;
  esac
done

echo
echo "── 4. 回调链路（租户归属）──"
probe "自营站原路径回调"   "$CORE/api/v1/callback/unispay" 401 POST
probe "带租户段回调"       "$CORE/t/betogo/api/v1/callback/unispay" 401 POST
probe "错误租户段必须拒绝" "$CORE/t/nosuch/api/v1/callback/unispay" 503 POST
probe "win568 GetBalance"  "$CORE/GetBalance" alive POST
probe "win568 带租户段"    "$CORE/t/betogo/GetBalance" alive POST

echo
echo "── 5. 数据完整性（只读快照）──"
U=$(r betogo -e "SELECT COUNT(*) FROM bg_user")
W=$(r betogo -e "SELECT CONCAT(COALESCE(SUM(available),0),'/',COALESCE(SUM(frozen),0)) FROM bg_wallet")
L=$(r betogo -e "SELECT COUNT(*) FROM bg_wallet_ledger")
B=$(r betogo -e "SELECT COUNT(*) FROM bg_bet_order")
M=$(r betogo -e "SELECT COUNT(*) FROM schema_migrations")
if [ -z "$U" ] || [ -z "$W" ] || [ -z "$L" ] || [ -z "$M" ]; then
  bad "数据快照查询失败（空值会让断言假通过，直接判失败）"
else
  ok "用户 $U / 钱包(可用/冻结) $W / 账变 $L / 注单 ${B:-N/A} / 迁移 $M"
fi
T=$(r betogo_platform -e "SELECT COUNT(*) FROM pf_tenant")
D=$(r betogo_platform -e "SELECT COUNT(*) FROM pf_tenant_domain")
if [ "${T:-0}" -ge 1 ] && [ "${D:-0}" -ge 1 ]; then ok "平台库租户 $T 个 / 域名 $D 条"; else bad "平台库数据异常：租户 ${T:-空} 域名 ${D:-空}"; fi
# 断言的是「自营站键名没被污染」，不是「不存在租户键」——
# 有了真实租户之后 t<id>: 键是正常产物，只有不属于任何已知租户的才是残留。
KNOWN=$(r betogo_platform -e "SELECT GROUP_CONCAT(CONCAT('t',id,':')) FROM pf_tenant WHERE self_operated=0")
STRAY=0
for k in $(podman exec tma-redis redis-cli --scan --pattern 't[0-9]*:*' 2>/dev/null | sed 's/\(t[0-9]*:\).*/\1/' | sort -u); do
  case ",$KNOWN," in *",$k,"*|*"$k"*) ;; *) STRAY=$((STRAY+1)); echo "     未知前缀: $k";; esac
done
SELF_PREFIXED=$(podman exec tma-redis redis-cli --scan --pattern 't1:*' 2>/dev/null | wc -l)
if [ "${STRAY:-0}" -eq 0 ] && [ "${SELF_PREFIXED:-0}" -eq 0 ]; then
  ok "自营站键名未被污染，租户键前缀均属已知租户（$KNOWN）"
else
  bad "残留未知前缀 $STRAY 个 / 自营站被加前缀的键 $SELF_PREFIXED 个"
fi

echo
echo "── 6. 日志错误扫描（最近 200 行）──"
for c in tma-bff-node tma-core-node; do
  # 排除本脚本探测 /t/nosuch/ 触发的「正确拒绝」，那是预期行为不是故障
  E=$(podman logs --tail 200 "$c" 2>&1 | grep '"level":"error"\|"level":50' | grep -vc '无法确定租户，拒绝处理' || true)
  W2=$(podman logs --tail 200 "$c" 2>&1 | grep -c '无租户上下文\|租户任务执行失败' || true)
  if [ "${E:-0}" -eq 0 ]; then ok "$c 无非预期 error 级日志"; else
    bad "$c 有 $E 条非预期 error 级日志"
    podman logs --tail 200 "$c" 2>&1 | grep '"level":"error"\|"level":50' | grep -v '无法确定租户，拒绝处理' | tail -2 | cut -c1-220 | sed 's/^/       /'
  fi
  if [ "${W2:-0}" -eq 0 ]; then ok "$c 无租户上下文缺失/任务失败告警"; else bad "$c 有 $W2 条租户相关告警"; fi
done

echo
echo "── 7. 资源占用 ──"
podman ps --format "{{.Names}}\t{{.Status}}" | grep -E "bff|core|mysql|redis|nats" | sed 's/^/  /'
CONN=$(r -e "SELECT COUNT(*) FROM information_schema.PROCESSLIST")
MAXC=$(r -e "SHOW VARIABLES LIKE 'max_connections'" | awk '{print $2}')
echo "  MySQL 连接 $CONN / 上限 $MAXC"
if [ "${CONN:-999}" -lt "${MAXC:-1}" ]; then ok "连接数在上限内"; else bad "连接数触顶"; fi

echo
echo "========== 结果：通过 $PASS，失败 $FAIL =========="
[ "$FAIL" -eq 0 ] || exit 1
REMOTE
