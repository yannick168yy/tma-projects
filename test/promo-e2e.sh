#!/usr/bin/env bash
# promo-e2e.sh — 三个活动端到端测试
# 在服务器内网对 localhost:3000 运行，需要 BFF_DEV_SKIP_TELEGRAM_AUTH=true

set -euo pipefail

API="http://localhost:3000/api/v1"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0
FAILURES=""

# ── 断言工具 ─────────────────────────────────────────────
ok() {
  local name=$1 expected=$2 actual=$3
  if [[ "$actual" == "$expected" ]]; then
    printf "${GREEN}PASS${NC} %s\n" "$name"
    ((PASS++)) || true
  else
    printf "${RED}FAIL${NC} %s\n" "$name"
    printf "  期望: %s\n  实际: %s\n" "$expected" "$actual"
    ((FAIL++)) || true
    FAILURES="${FAILURES}\n  ✗ ${name} (期望=${expected} 实际=${actual})"
  fi
}

skip() {
  printf "${YELLOW}SKIP${NC} %s\n" "$1"
  ((SKIP++)) || true
}

# ── 登录（dev bypass）────────────────────────────────────
echo "► 登录（dev bypass）..."
LOGIN=$(curl -sf -X POST "${API}/auth/telegram" \
  -H "Content-Type: application/json" -d '{}' 2>&1) || true

if echo "$LOGIN" | grep -q '"token"'; then
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
  USER_ID=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['user']['id'])")
  printf "  已登录 userId=%s\n" "$USER_ID"
else
  printf "${RED}ERROR${NC} 登录失败（dev bypass 未启用或服务不可达）\n"
  echo "响应: $LOGIN"
  exit 1
fi

AUTH="Authorization: Bearer ${TOKEN}"

# ── Redis 重置 dev 用户状态 ──────────────────────────────
echo "► 重置 dev 用户活动状态..."
# 读取当前用户 JSON，清除所有 claim 标志
RESET_SCRIPT=$(cat <<'PY'
import sys, json, redis as r
rc = r.Redis(host='127.0.0.1', port=6379, db=0)
# 尝试读取 dev 用户
user_id_b = rc.get('tma:user:tg:999000001')
if not user_id_b:
    print("DEV_USER_NOT_FOUND")
    sys.exit(0)
user_id = user_id_b.decode()
raw = rc.get(f'tma:user:{user_id}')
if not raw:
    print("DEV_USER_DATA_NOT_FOUND")
    sys.exit(0)
user = json.loads(raw)
user['trialClaimed'] = False
user['referralClaimed'] = False
user['firstDepClaimed'] = False
user['referralReady'] = False
user['firstDepReady'] = False
rc.set(f'tma:user:{user_id}', json.dumps(user))
print("RESET_OK")
PY
)
# 用 redis-cli 直接操作（避免 python 依赖）
USER_KEY_RAW=$(redis-cli get "tma:user:tg:999000001" 2>/dev/null || echo "")
if [[ -n "$USER_KEY_RAW" && "$USER_KEY_RAW" != "(nil)" ]]; then
  DEV_USER_ID="$USER_KEY_RAW"
  UKEY="tma:user:${DEV_USER_ID}"
  UJSON=$(redis-cli get "$UKEY" 2>/dev/null || echo "")
  if [[ -n "$UJSON" && "$UJSON" != "(nil)" ]]; then
    RESET_JSON=$(echo "$UJSON" | python3 -c "
import sys, json
u = json.load(sys.stdin)
u['trialClaimed'] = False
u['referralClaimed'] = False
u['firstDepClaimed'] = False
u['referralReady'] = False
u['firstDepReady'] = False
print(json.dumps(u))
")
    redis-cli set "$UKEY" "$RESET_JSON" > /dev/null
    printf "  重置完成 (userId=%s)\n" "$DEV_USER_ID"
  else
    printf "${YELLOW}  warn: 未找到用户 JSON，跳过重置\n${NC}"
  fi
else
  printf "${YELLOW}  warn: 未找到 tma:user:tg:999000001，首次运行无需重置\n${NC}"
fi

# ── 工具函数 ─────────────────────────────────────────────
get_field() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$2)" 2>/dev/null || echo "ERROR"
}
status_of() {
  # $1=方法 $2=路径 $3=body(可选)
  local method=$1 path=$2 body=${3:-}
  if [[ -n "$body" ]]; then
    curl -sf -o /dev/null -w "%{http_code}" -X "$method" "${API}${path}" \
      -H "$AUTH" -H "Content-Type: application/json" -d "$body" 2>/dev/null || echo "000"
  else
    curl -sf -o /dev/null -w "%{http_code}" -X "$method" "${API}${path}" \
      -H "$AUTH" 2>/dev/null || echo "000"
  fi
}
call() {
  local method=$1 path=$2 body=${3:-}
  if [[ -n "$body" ]]; then
    curl -sf -X "$method" "${API}${path}" \
      -H "$AUTH" -H "Content-Type: application/json" -d "$body" 2>/dev/null || echo '{}'
  else
    curl -sf -X "$method" "${API}${path}" -H "$AUTH" 2>/dev/null || echo '{}'
  fi
}

echo ""
echo "══════════════════════════════════════════"
echo " 1. 首席体验官 (trial)"
echo "══════════════════════════════════════════"

# GET trial-play — 未领取
R=$(call GET /promotions/trial-play)
ok "trial-play 未领取 → claimed=false" "False" "$(get_field "$R" "['data']['claimed']")"
ok "trial-play amountPhp=88" "88" "$(get_field "$R" "['data']['amountPhp']")"

# 首次领取
R=$(call POST /promotions/trial-play/claim)
ok "trial-play/claim 首次领取 → code=0" "0" "$(get_field "$R" "['code']")"
ok "trial-play/claim 返回 amountPhp=88" "88" "$(get_field "$R" "['data']['amountPhp']")"

# GET trial-play — 已领取
R=$(call GET /promotions/trial-play)
ok "trial-play 已领取 → claimed=true" "True" "$(get_field "$R" "['data']['claimed']")"

# 重复领取 → 400
S=$(status_of POST /promotions/trial-play/claim)
ok "trial-play/claim 重复领取 → HTTP400" "400" "$S"

# 改活动金额（通过后台）
echo ""
echo "  [配置测试] trial 金额改为 120..."
ADMIN_LOGIN=$(curl -sf -X POST "${API}/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"aa888888"}' 2>/dev/null || echo '{}')
ADMIN_TOKEN=$(get_field "$ADMIN_LOGIN" "['data']['token']")
if [[ "$ADMIN_TOKEN" != "ERROR" && -n "$ADMIN_TOKEN" ]]; then
  ADMIN_AUTH="Authorization: Bearer ${ADMIN_TOKEN}"
  CFG_BEFORE=$(call GET /admin/promotions/config)
  ok "admin GET config → trial.amount=88" "88" "$(get_field "$CFG_BEFORE" "['data']['trial']['amount']")"

  R=$(curl -sf -X PUT "${API}/admin/promotions/config" \
    -H "$ADMIN_AUTH" -H "Content-Type: application/json" \
    -d '{"trial":{"amount":120}}' 2>/dev/null || echo '{}')
  ok "admin PUT config trial.amount=120 → code=0" "0" "$(get_field "$R" "['code']")"
  ok "admin PUT config → 返回新金额120" "120" "$(get_field "$R" "['data']['trial']['amount']")"

  # 校验：金额超出范围
  R=$(curl -sf -X PUT "${API}/admin/promotions/config" \
    -H "$ADMIN_AUTH" -H "Content-Type: application/json" \
    -d '{"trial":{"amount":99999}}' 2>/dev/null || echo '{}')
  ok "admin PUT config trial.amount=99999 → 返回 400错误" "400" "$(get_field "$R" "['code']")"

  # 恢复原始金额
  curl -sf -X PUT "${API}/admin/promotions/config" \
    -H "$ADMIN_AUTH" -H "Content-Type: application/json" \
    -d '{"trial":{"amount":88}}' > /dev/null 2>&1 || true
  printf "  [配置] 已恢复 trial.amount=88\n"
else
  skip "admin API 不可用（token 获取失败），跳过配置测试"
fi

echo ""
echo "══════════════════════════════════════════"
echo " 2. 邀请共赢 (referral)"
echo "══════════════════════════════════════════"

# GET referral
R=$(call GET /promotions/referral)
ok "referral — 返回 inviteCode" "0" "$(get_field "$R" "['code']")"
INVITE_CODE=$(get_field "$R" "['data']['inviteCode']")
printf "  inviteCode: %s\n" "$INVITE_CODE"

# GET referral/link
R=$(call GET /promotions/referral/link)
ok "referral/link — 返回 deepLink" "0" "$(get_field "$R" "['code']")"
DEEP_LINK=$(get_field "$R" "['data']['deepLink']")
ok "referral/link 包含 inviteCode" "True" "$(python3 -c "print('$INVITE_CODE' in '$DEEP_LINK')" 2>/dev/null || echo 'False')"

# 未就绪时领取 → 400
S=$(status_of POST /promotions/referral/claim)
ok "referral/claim 未就绪 → HTTP400" "400" "$S"

# 手动设置 referralReady=true (通过 redis-cli)
if [[ -n "$DEV_USER_ID" ]]; then
  UKEY="tma:user:${DEV_USER_ID}"
  UJSON=$(redis-cli get "$UKEY" 2>/dev/null || echo "")
  if [[ -n "$UJSON" && "$UJSON" != "(nil)" ]]; then
    READY_JSON=$(echo "$UJSON" | python3 -c "
import sys, json
u = json.load(sys.stdin)
u['referralReady'] = True
print(json.dumps(u))
")
    redis-cli set "$UKEY" "$READY_JSON" > /dev/null
    printf "  已设置 referralReady=true\n"

    R=$(call POST /promotions/referral/claim)
    ok "referral/claim 就绪时领取 → code=0" "0" "$(get_field "$R" "['code']")"
    ok "referral/claim 返回 amountPhp=50" "50" "$(get_field "$R" "['data']['amountPhp']")"

    # 重复领取
    S=$(status_of POST /promotions/referral/claim)
    ok "referral/claim 重复领取 → HTTP400" "400" "$S"
  else
    skip "Redis 读取失败，跳过 referral ready 测试"
  fi
else
  skip "DEV_USER_ID 未知，跳过 referral ready 测试"
fi

echo ""
echo "══════════════════════════════════════════"
echo " 3. 首充嘉年华 (firstdep)"
echo "══════════════════════════════════════════"

# 未就绪时领取 → 400
S=$(status_of POST /promotions/firstdep/claim)
ok "firstdep/claim 未就绪 → HTTP400" "400" "$S"

# 手动设置 firstDepReady=true
if [[ -n "$DEV_USER_ID" ]]; then
  UKEY="tma:user:${DEV_USER_ID}"
  UJSON=$(redis-cli get "$UKEY" 2>/dev/null || echo "")
  if [[ -n "$UJSON" && "$UJSON" != "(nil)" ]]; then
    READY_JSON=$(echo "$UJSON" | python3 -c "
import sys, json
u = json.load(sys.stdin)
u['firstDepReady'] = True
print(json.dumps(u))
")
    redis-cli set "$UKEY" "$READY_JSON" > /dev/null
    printf "  已设置 firstDepReady=true\n"

    R=$(call POST /promotions/firstdep/claim)
    ok "firstdep/claim 就绪时领取 → code=0" "0" "$(get_field "$R" "['code']")"
    ok "firstdep/claim 返回 amountPhp=1000" "1000" "$(get_field "$R" "['data']['amountPhp']")"

    # 重复领取
    S=$(status_of POST /promotions/firstdep/claim)
    ok "firstdep/claim 重复领取 → HTTP400" "400" "$S"
  else
    skip "Redis 读取失败，跳过 firstdep ready 测试"
  fi
else
  skip "DEV_USER_ID 未知，跳过 firstdep ready 测试"
fi

echo ""
echo "══════════════════════════════════════════"
echo " 4. 活动关闭测试（通过后台 disable）"
echo "══════════════════════════════════════════"

if [[ -n "${ADMIN_TOKEN:-}" && "$ADMIN_TOKEN" != "ERROR" ]]; then
  # 重置 dev 用户（以便可以再次领取）
  UKEY="tma:user:${DEV_USER_ID}"
  UJSON=$(redis-cli get "$UKEY" 2>/dev/null || echo "")
  if [[ -n "$UJSON" && "$UJSON" != "(nil)" ]]; then
    RESET_JSON=$(echo "$UJSON" | python3 -c "
import sys, json
u = json.load(sys.stdin)
u['trialClaimed'] = False
print(json.dumps(u))
")
    redis-cli set "$UKEY" "$RESET_JSON" > /dev/null

    # 关闭 trial 活动
    curl -sf -X PUT "${API}/admin/promotions/config" \
      -H "$ADMIN_AUTH" -H "Content-Type: application/json" \
      -d '{"trial":{"enabled":false}}' > /dev/null 2>&1

    S=$(status_of POST /promotions/trial-play/claim)
    ok "trial 活动关闭后领取 → HTTP400" "400" "$S"

    # 恢复 trial 活动
    curl -sf -X PUT "${API}/admin/promotions/config" \
      -H "$ADMIN_AUTH" -H "Content-Type: application/json" \
      -d '{"trial":{"enabled":true}}' > /dev/null 2>&1
    printf "  [配置] 已恢复 trial.enabled=true\n"
  fi
else
  skip "admin token 不可用，跳过活动关闭测试"
fi

# ── 汇总 ──────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
printf " 结果：${GREEN}%d PASS${NC}  ${RED}%d FAIL${NC}  ${YELLOW}%d SKIP${NC}\n" "$PASS" "$FAIL" "$SKIP"
echo "══════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  printf "\n失败项目：%b\n" "$FAILURES"
  exit 1
fi

exit 0
