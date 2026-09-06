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
#   测试：DEPLOY_HOST=root@47.84.34.139 SSH_IDENTITY_FILE=... bash scripts/dump-schema-baseline.sh
#   生产：DEPLOY_HOST=ubuntu@13.213.107.231 SSH_IDENTITY_FILE=... \
#         REMOTE_DIR=/opt/tma-projects REMOTE_PREFIX=sudo bash scripts/dump-schema-baseline.sh
#
# 基线必须导自要开站的那台机器：测试库与生产库的结构会漂移，
# 拿测试库的基线去生产开站，开出来的表结构就是错的。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST}"
OUT="$ROOT/infra/database/betogo/schema_baseline.sql"

SSH_ARGS=()
[[ -n "${SSH_IDENTITY_FILE:-}" ]] && SSH_ARGS+=(-i "${SSH_IDENTITY_FILE/#\~/$HOME}")
[[ -n "${SSH_OPTS:-}" ]] && SSH_ARGS+=($SSH_OPTS)

REMOTE_DIR="${REMOTE_DIR:-/root/workspace/tma-projects}"

echo "==> 从 $HOST:$REMOTE_DIR 的 betogo 库导出结构基线..." >&2
# 生产的 .env 是 root:root 600，需要 REMOTE_PREFIX=sudo 才读得到
ssh "${SSH_ARGS[@]}" "$HOST" \
  "${REMOTE_PREFIX:-} env APP_DIR='$REMOTE_DIR' CTR='${REMOTE_CTR:-}' MYSQL_CTR='${MYSQL_CTR:-tma-mysql}' bash -s" \
  > "$OUT" <<'REMOTE'
APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
CTR="${CTR:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
cd "$APP_DIR" || { echo "进不去 $APP_DIR" >&2; exit 1; }

# root 密码：容器自身的环境变量优先。生产上 .env 里那份与容器实际值对不上（历史手工改过），
# 只信 .env 会导出一个空文件，而校验只看表数、报不出真正的原因。
# 诊断一律走 stderr —— stdout 就是基线文件本身，混一行进去就毁了。
RPW=""
for cand in \
  "$($CTR inspect "$MYSQL_CTR" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -m1 '^MYSQL_ROOT_PASSWORD=' | cut -d= -f2-)" \
  "$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")"
do
  [ -n "$cand" ] || continue
  if $CTR exec "$MYSQL_CTR" mysql -uroot -p"$cand" -e "SELECT 1" >/dev/null 2>&1; then RPW="$cand"; break; fi
done
[ -n "$RPW" ] || { echo "拿不到可用的 root 密码" >&2; exit 1; }
echo "-- BetoGo 租户库结构基线（由 scripts/dump-schema-baseline.sh 生成，勿手工编辑）"
echo "-- 仅用于新租户开站建库：只对「零张表的空库」执行；对已有库执行没有意义也不被允许。"
echo "-- 不含 DROP TABLE，即使误执行也不会清空既有数据。"
echo "SET NAMES utf8mb4;"
# --skip-add-drop-table 是硬性要求：带 DROP TABLE 的基线一旦被误对生产库执行就是灾难
$CTR exec "$MYSQL_CTR" mysqldump -uroot -p"$RPW" \
  --no-data --skip-add-drop-table --no-tablespaces --skip-comments \
  --skip-add-locks --single-transaction \
  --default-character-set=utf8mb4 betogo 2>/dev/null
echo "-- 已执行版本：新库据此认为基线内的迁移都已应用，之后的新迁移照常增量执行"
# --skip-add-locks 是硬性要求：带 LOCK TABLES 的基线需要 LOCK TABLES 权限，
# 而开站账号刻意不给这个权限（最小权限原则）。带锁的话开站会以
# 「Access denied to database」失败，且报错完全看不出是缺锁权限。
$CTR exec "$MYSQL_CTR" mysqldump -uroot -p"$RPW" \
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
