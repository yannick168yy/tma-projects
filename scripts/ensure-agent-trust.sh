#!/usr/bin/env bash
# 确保 cursor-agent 已信任当前工作区（cc-connect / Telegram bot 非交互 -p 依赖此项）
#
# 用法：
#   bash scripts/ensure-agent-trust.sh              # 默认 tma-projects 根目录
#   bash scripts/ensure-agent-trust.sh /path/to/dir   # 指定 work_dir（如 tma-cursor）
#
# cc-connect / LaunchAgent 可在启动前调用；agent 自动更新后若 bot 无回复，重跑本脚本即可。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="${1:-$ROOT}"
AGENT="${CURSOR_AGENT_BIN:-$HOME/.local/bin/agent}"
CHECK_PROMPT='reply exactly: TRUST_CHECK_OK'

if [[ ! -d "$WORK_DIR" ]]; then
  echo "工作目录不存在: $WORK_DIR" >&2
  exit 1
fi

if [[ ! -x "$AGENT" ]]; then
  echo "找不到 cursor-agent: $AGENT" >&2
  exit 1
fi

cd "$WORK_DIR"

run_check() {
  "$AGENT" -p "$CHECK_PROMPT" 2>&1 | tail -1
}

echo "==> 检查 workspace trust: $WORK_DIR"
OUT="$(run_check || true)"

if [[ "$OUT" == "TRUST_CHECK_OK" ]]; then
  echo "==> 已信任，无需操作"
  exit 0
fi

if echo "$OUT" | grep -qi 'workspace trust'; then
  echo "==> 未信任（$OUT），执行 agent --trust ..."
else
  echo "==> 探测失败（输出: ${OUT:-空}），尝试 agent --trust ..."
fi

"$AGENT" --trust -p ok >/dev/null

OUT="$(run_check || true)"
if [[ "$OUT" == "TRUST_CHECK_OK" ]]; then
  echo "==> 信任已建立"
  exit 0
fi

echo "信任后仍异常，最后输出: ${OUT:-空}" >&2
exit 1
