#!/usr/bin/env bash
# betogo 全库每日备份，保留最近 KEEP 份（默认 14）。
# cron 与后台「立即备份」共用。以 root 或普通用户（自动 sudo）均可运行。
#
# 环境变量可覆盖：
#   WORK_DIR  项目根（生产 /opt/tma-projects，测试 /root/workspace/tma-projects）
#   KEEP      保留份数（默认 14）
#   TAG       文件名标签（默认 daily；后台立即备份传 manual）
#
# 用法：bash daily-backup.sh
# 退出码：0 成功；非 0 失败
set -uo pipefail

WORK_DIR="${WORK_DIR:-/opt/tma-projects}"
KEEP="${KEEP:-14}"
TAG="${TAG:-daily}"
CTN=tma-mysql
DB_USER=betogo
DB_NAME=betogo
BACKUP_DIR="$WORK_DIR/backups"

SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
PODMAN="$SUDO podman"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

DB_PASS=$(grep -m1 '^MYSQL_BETOGO_PASSWORD=' "$WORK_DIR/.env" | cut -d= -f2- | tr -d "\"'")
[ -n "$DB_PASS" ] || { log "读取不到 MYSQL_BETOGO_PASSWORD"; exit 1; }

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/betogo-$TAG-$STAMP.sql.gz"
TMP="$OUT.part"

log "开始备份 -> $OUT"
$PODMAN exec -i "$CTN" mysqldump --default-character-set=utf8mb4 \
  --single-transaction --quick --no-tablespaces \
  -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" 2>/tmp/daily-backup-err | gzip > "$TMP"
rc=${PIPESTATUS[0]}
if [ "$rc" != "0" ]; then
  log "mysqldump 失败 rc=$rc: $(grep -vi insecure /tmp/daily-backup-err | head -3 | tr '\n' ' ')"
  rm -f "$TMP"; exit 1
fi

if ! gzip -t "$TMP" 2>/dev/null; then log "备份 gzip 损坏"; rm -f "$TMP"; exit 1; fi
TBLS=$(gzip -dc "$TMP" | grep -c 'CREATE TABLE')
if [ "$TBLS" -lt 10 ]; then log "表数异常($TBLS)，丢弃"; rm -f "$TMP"; exit 1; fi
mv "$TMP" "$OUT"
log "备份完成: $(du -h "$OUT" | cut -f1), $TBLS 张表"

# 保留策略：仅清理本脚本产出的 daily/manual 备份，preclean 手动备份不动
DELN=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rm -f "$f" && DELN=$((DELN+1)) && log "  清理旧备份: $(basename "$f")"
done < <(ls -1t "$BACKUP_DIR"/betogo-daily-*.sql.gz "$BACKUP_DIR"/betogo-manual-*.sql.gz 2>/dev/null | tail -n +$((KEEP+1)))
log "保留最近 $KEEP 份，本次清理 $DELN 份，当前共 $(ls -1 "$BACKUP_DIR"/betogo-*.sql.gz 2>/dev/null | wc -l | tr -d ' ') 份"
