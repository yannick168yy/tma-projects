#!/usr/bin/env bash
# 从自营站库导出「结构基线」，供新租户开站建库使用。
#
# 为什么需要基线：历史迁移链已经无法从 001 重放（008 起就依赖了后续才补上的列），
# 新库不可能靠重放迁移建出来。这里用「结构快照 + 已执行版本表」作为新库起点，
# 之后的新迁移照常增量执行 —— 与 Rails schema.rb / Django squash 是同一思路。
#
# 输出：infra/database/betogo/schema_baseline.sql
#   1) 全部表结构（不含数据，且不含 DROP TABLE —— 防止误对已有库执行时清空数据）
#   2) schema_migrations 表的数据（基线自带「截止到哪个版本」的信息）
#
# 用法：
#   DEPLOY_HOST=root@47.84.34.139 SSH_IDENTITY_FILE=... bash scripts/dump-schema-baseline.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST}"
OUT="$ROOT/infra/database/betogo/schema_baseline.sql"

SSH_ARGS=()
[[ -n "${SSH_IDENTITY_FILE:-}" ]] && SSH_ARGS+=(-i "${SSH_IDENTITY_FILE/#\~/$HOME}")
[[ -n "${SSH_OPTS:-}" ]] && SSH_ARGS+=($SSH_OPTS)

echo "==> 从 $HOST 的 betogo 库导出结构基线..."
ssh "${SSH_ARGS[@]}" "$HOST" "bash -s" > "$OUT" <<'REMOTE'
cd /root/workspace/tma-projects
RPW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2- | tr -d "\"'")
CTR=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)
echo "-- BetoGo 租户库结构基线（由 scripts/dump-schema-baseline.sh 生成，勿手工编辑）"
echo "-- 仅用于新租户开站建库：只对「零张表的空库」执行；对已有库执行没有意义也不被允许。"
echo "-- 不含 DROP TABLE，即使误执行也不会清空既有数据。"
echo "SET NAMES utf8mb4;"
# --skip-add-drop-table 是硬性要求：带 DROP TABLE 的基线一旦被误对生产库执行就是灾难
$CTR exec tma-mysql mysqldump -uroot -p"$RPW" \
  --no-data --skip-add-drop-table --no-tablespaces --skip-comments \
  --skip-add-locks --single-transaction \
  --default-character-set=utf8mb4 betogo 2>/dev/null
echo "-- 已执行版本：新库据此认为基线内的迁移都已应用，之后的新迁移照常增量执行"
# --skip-add-locks 是硬性要求：带 LOCK TABLES 的基线需要 LOCK TABLES 权限，
# 而开站账号刻意不给这个权限（最小权限原则）。带锁的话开站会以
# 「Access denied to database」失败，且报错完全看不出是缺锁权限。
$CTR exec tma-mysql mysqldump -uroot -p"$RPW" \
  --no-create-info --skip-add-drop-table --no-tablespaces --skip-comments \
  --skip-add-locks --single-transaction \
  --default-character-set=utf8mb4 betogo schema_migrations 2>/dev/null
REMOTE

TABLES=$(grep -c '^CREATE TABLE' "$OUT" || true)
echo "==> 已写入 $OUT（$TABLES 张表，$(wc -l < "$OUT") 行）"
[ "$TABLES" -lt 50 ] && { echo "表数异常偏少，导出可能失败" >&2; exit 1; }
if grep -v '^--' "$OUT" | grep -q 'LOCK TABLES'; then
  echo "基线里出现 LOCK TABLES，开站账号无此权限会失败" >&2
  exit 1
fi
if grep -v '^--' "$OUT" | grep -qE 'DROP TABLE|CREATE DATABASE|^USE '; then
  echo "基线里出现 DROP TABLE / CREATE DATABASE / USE，可能误对已有库执行" >&2
  exit 1
fi
exit 0
