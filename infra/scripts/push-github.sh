#!/usr/bin/env bash
# 登录 GitHub 后执行：创建远程仓库并推送 main 分支
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

GH="${GH:-/usr/local/bin/gh}"
GIT="${GIT:-/usr/bin/git}"

if ! "$GH" auth status >/dev/null 2>&1; then
  echo "请先登录: gh auth login -h github.com -p https -w"
  exit 1
fi

REPO_NAME="${1:-tma-projects}"
VISIBILITY="${2:-public}"

if "$GIT" remote get-url origin >/dev/null 2>&1; then
  echo "已有 origin，直接推送..."
  "$GIT" push -u origin main
else
  echo "创建仓库 yannick168/${REPO_NAME} 并推送..."
  "$GH" repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push
fi

echo ""
echo "完成: https://github.com/$("$GH" api user -q .login)/${REPO_NAME}"
