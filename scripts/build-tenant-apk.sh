#!/usr/bin/env bash
# P1-15 租户 App 出包：平台库读参数 → 生成图标 → gradle 出包
#
#   bash scripts/build-tenant-apk.sh <租户代号> [--market PH] [--icon <png|url>] [--debug]
#
# 参数默认从**服务器上的平台库**读（走 DEPLOY_HOST/SSH_IDENTITY_FILE，与部署脚本同一套变量）；
# 本机跑着平台库时加 APP_BUILD_LOCAL=1 直接查本地容器。
#
# 🔴 签名密钥不在这条流水线里：平台库只存 keystore_ref，密钥文件与密码要事先放在
# apps/android-shell/android/keystore-<ref>.properties（已 gitignore）。密钥丢了就再也
# 无法更新已发布的 App，它只能留在人手里。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$ROOT/apps/android-shell"
cd "$ROOT"

TENANT_CODE="${1:-}"
[[ -n "$TENANT_CODE" ]] || { echo "用法: bash scripts/build-tenant-apk.sh <租户代号> [--market PH] [--icon <png|url>] [--debug]" >&2; exit 1; }
shift

MARKET=""
ICON=""
BUILD_TYPE="Release"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --market) MARKET="${2:-}"; shift 2 ;;
    --icon)   ICON="${2:-}"; shift 2 ;;
    --debug)  BUILD_TYPE="Debug"; shift ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }

PLATFORM_DB="${MYSQL_PLATFORM_DATABASE:-betogo_platform}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-tma-mysql}"
ROOT_PW="${MYSQL_ROOT_PASSWORD:-root_dev_only}"

# 查平台库。远程走 ssh + 容器 exec；不带 -i，容器 exec 带 -i 会抢 stdin
query_platform() {
  local sql="$1"
  if [[ "${APP_BUILD_LOCAL:-}" == "1" ]]; then
    docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" -N -B "$PLATFORM_DB" -e "$sql"
  else
    : "${DEPLOY_HOST:?远程取参数需要 DEPLOY_HOST（或用 APP_BUILD_LOCAL=1 查本机）}"
    # shellcheck disable=SC2086
    ssh ${SSH_IDENTITY_FILE:+-i "$SSH_IDENTITY_FILE"} ${SSH_OPTS:-} "$DEPLOY_HOST" \
      "podman exec ${MYSQL_CONTAINER} mysql -uroot -p'${ROOT_PW}' -N -B ${PLATFORM_DB} -e \"${sql//\"/\\\"}\""
  fi
}

MARKET_FILTER=""
[[ -n "$MARKET" ]] && MARKET_FILTER="AND a.app_market = '$MARKET'"
ROW="$(query_platform "SELECT a.package_name, a.app_label, a.app_market, a.route_domains, a.tg_recovery_channel, a.splash_background, a.keystore_ref, a.version_code, a.version_name, IFNULL(b.app_icon_key,'') FROM pf_tenant_app a JOIN pf_tenant t ON t.id = a.tenant_id LEFT JOIN pf_tenant_brand b ON b.tenant_id = a.tenant_id WHERE t.code = '$TENANT_CODE' $MARKET_FILTER;")"

[[ -n "$ROW" ]] || { echo "平台库里没有租户 $TENANT_CODE 的出包参数（pf_tenant_app），先在平台控制台配置" >&2; exit 1; }
[[ "$(printf '%s\n' "$ROW" | wc -l | tr -d ' ')" == "1" ]] || {
  echo "租户 $TENANT_CODE 有多个市场的出包参数，用 --market 指定：" >&2
  printf '%s\n' "$ROW" | awk -F'\t' '{print "  " $3 " -> " $1}' >&2
  exit 1
}

IFS=$'\t' read -r PACKAGE_NAME APP_LABEL APP_MARKET ROUTE_DOMAINS TG_CHANNEL SPLASH_BG KEYSTORE_REF VERSION_CODE VERSION_NAME ICON_KEY <<< "$ROW"
[[ -n "$ROUTE_DOMAINS" ]] || { echo "租户 $TENANT_CODE 的 route_domains 为空：内置线路表为空的包起不来" >&2; exit 1; }

log "租户 $TENANT_CODE / 市场 $APP_MARKET"
log "  包名     $PACKAGE_NAME"
log "  名称     $APP_LABEL"
log "  线路组   $ROUTE_DOMAINS"
log "  版本     $VERSION_NAME ($VERSION_CODE)"
log "  签名     ${KEYSTORE_REF:-<未配置>}"

# ── 图标：品牌包给的是 storage key，取图这一步不做自动猜测，交由 --icon 明确传入 ──
RES_DIR="$SHELL_DIR/android/app/build/tenant-res/$TENANT_CODE"
GRADLE_RES_ARG=()
if [[ -n "$ICON" ]]; then
  command -v sips >/dev/null || { echo "生成图标需要 macOS 的 sips" >&2; exit 1; }
  SRC="$ICON"
  if [[ "$ICON" == http* ]]; then
    SRC="$(mktemp -t tenant-icon).png"
    curl -fsSL "$ICON" -o "$SRC"
  fi
  rm -rf "$RES_DIR"
  # ic_launcher / ic_launcher_round 用同一张方图；自适应图标的前景层按 108dp 基准放大
  for entry in "mdpi 48 108" "hdpi 72 162" "xhdpi 96 216" "xxhdpi 144 324" "xxxhdpi 192 432"; do
    read -r dpi size fg <<< "$entry"
    mkdir -p "$RES_DIR/mipmap-$dpi"
    sips -s format png -z "$size" "$size" "$SRC" --out "$RES_DIR/mipmap-$dpi/ic_launcher.png" >/dev/null
    cp "$RES_DIR/mipmap-$dpi/ic_launcher.png" "$RES_DIR/mipmap-$dpi/ic_launcher_round.png"
    sips -s format png -z "$fg" "$fg" "$SRC" --out "$RES_DIR/mipmap-$dpi/ic_launcher_foreground.png" >/dev/null
  done
  GRADLE_RES_ARG=(-PtenantResDir="$RES_DIR")
  log "图标已生成：$RES_DIR"
elif [[ -n "$ICON_KEY" ]]; then
  log "⚠️ 未传 --icon，本次沿用默认图标。该租户品牌包里的 App 图标是：$ICON_KEY"
else
  log "⚠️ 未传 --icon 且品牌包没有 App 图标，本次沿用默认图标"
fi

# ── capacitor sync：allowNavigation 要带上通配子域，否则子域跳转会被踢去系统浏览器 ──
ALLOWED="$(printf '%s' "$ROUTE_DOMAINS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | awk 'NF{print $0 "," "*." $0}' | paste -sd, -)"
log "capacitor sync"
( cd "$SHELL_DIR" && CAP_APP_ID="$PACKAGE_NAME" CAP_APP_NAME="$APP_LABEL" \
    CAP_ALLOWED_DOMAINS="$ALLOWED" CAP_BACKGROUND="$SPLASH_BG" npx cap sync android )

# ── gradle：公钥与旁路频道是平台级配置，从 gradle.properties 或环境变量来 ──
GRADLE_ARGS=(
  "assembleTenant${BUILD_TYPE}"
  -PtenantPackage="$PACKAGE_NAME"
  -PtenantMarket="$APP_MARKET"
  -PtenantDomains="$ROUTE_DOMAINS"
  -PtenantKeystore="$KEYSTORE_REF"
  -PappLabel="$APP_LABEL"
  -PappVersionCode="$VERSION_CODE"
  -PappVersionName="$VERSION_NAME"
  -PsplashBackground="$SPLASH_BG"
  "${GRADLE_RES_ARG[@]}"
)
[[ -n "$TG_CHANNEL" ]] && GRADLE_ARGS+=(-PtgRecoveryChannel="$TG_CHANNEL")
[[ -n "${APP_ROUTE_PUBLIC_KEY:-}" ]] && GRADLE_ARGS+=(-PappRoutePublicKey="$APP_ROUTE_PUBLIC_KEY")

log "gradle assembleTenant${BUILD_TYPE}"
( cd "$SHELL_DIR/android" && ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}" ./gradlew "${GRADLE_ARGS[@]}" )

APK="$SHELL_DIR/android/app/build/outputs/apk/tenant/$(echo "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]')/app-tenant-$(echo "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]').apk"
[[ -f "$APK" ]] && log "出包完成：$APK" || log "构建结束，但没找到预期的 APK 路径：$APK"
