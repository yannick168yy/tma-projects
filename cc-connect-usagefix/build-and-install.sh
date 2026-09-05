#!/bin/bash
# 重新构建 cc-connect（含 /usage 超时修复）并替换已安装的二进制。
# 需要 Go 1.25+。脚本会自动找一个够新的 go。
set -euo pipefail
cd "$(dirname "$0")"

TARGET="/usr/local/Cellar/node/25.8.0/lib/node_modules/cc-connect/bin/cc-connect"

# --- 找一个 >= 1.25 的 go ---------------------------------------------------
ver_ok() {
  local v
  v="$("$1" version 2>/dev/null | awk '{print $3}' | sed 's/^go//')" || return 1
  [ -n "$v" ] || return 1
  local maj min
  maj="${v%%.*}"; min="${v#*.}"; min="${min%%.*}"
  [ "$maj" -gt 1 ] 2>/dev/null && return 0
  [ "$maj" -eq 1 ] 2>/dev/null && [ "$min" -ge 25 ] 2>/dev/null && return 0
  return 1
}

GO=""
for cand in "${GOBIN_OVERRIDE:-}" "$(command -v go || true)" \
            /usr/local/go/bin/go /opt/homebrew/bin/go /usr/local/bin/go \
            /usr/local/opt/go/bin/go "$HOME/go/bin/go" "$HOME/sdk"/go1.2*/bin/go; do
  [ -n "$cand" ] && [ -x "$cand" ] || continue
  if ver_ok "$cand"; then GO="$cand"; break; fi
done

if [ -z "$GO" ]; then
  echo "!! 没找到 Go 1.25+（当前 $(go version 2>/dev/null || echo '未安装')）"
  echo
  echo "   装一个新的，二选一："
  echo "     brew install go        # 已装过就用 brew upgrade go"
  echo "     # 或者用旧 go 拉指定版本："
  echo "     go install golang.org/dl/go1.25.0@latest && \\"
  echo "       ~/go/bin/go1.25.0 download && GOBIN_OVERRIDE=\$(command -v go1.25.0) ./build-and-install.sh"
  echo
  echo "   装完重新跑本脚本即可。"
  exit 1
fi

echo "==> using: $($GO version)  ($GO)"
export CGO_ENABLED=0
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
echo "==> building (no web UI)…"
"$GO" build -tags 'no_web goolm' \
  -ldflags "-s -w -X main.version=v1.5.0 -X main.commit=usagefix -X main.buildTime=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  -o ./cc-connect ./cmd/cc-connect

./cc-connect --version

if [ -f "$TARGET" ] && [ ! -f "$TARGET.orig" ]; then
  cp "$TARGET" "$TARGET.orig"
  echo "==> 原二进制已备份到 $TARGET.orig"
fi
cp ./cc-connect "$TARGET"
chmod +x "$TARGET"
xattr -d com.apple.quarantine "$TARGET" 2>/dev/null || true

echo "==> 重启 cc-connect"
cc-connect daemon restart || echo "!! 自动重启失败，请手动重启 cc-connect"
echo "==> 完成。到 Telegram 里发 /usage 试试。"
