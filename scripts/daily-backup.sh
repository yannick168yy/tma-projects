#!/usr/bin/env bash
# 全库每日备份：平台库 + 所有租户库，各自保留最近 KEEP 份（默认 14）。
# cron 与后台「立即备份」共用。以 root 或普通用户（自动 sudo）均可运行。
#
# 为什么要逐库备份而不是一条 --all-databases：
#   包网后每开一个客户就多一个库，账单纠纷时要能单独把某一家恢复到某一天，
#   而不是把所有租户一起回滚。库清单从 pf_tenant 读，开新站后无需改这个脚本。
#
# 环境变量可覆盖：
#   WORK_DIR  项目根（生产 /opt/tma-projects，测试 /root/workspace/tma-projects）
#   KEEP      每个库保留份数（默认 14）
#   TAG       文件名标签（默认 daily；后台立即备份传 manual）
#
# 用法：bash daily-backup.sh
# 退出码：0 全部成功；非 0 至少一个库失败（失败的库名见日志）
set -uo pipefail

WORK_DIR="${WORK_DIR:-/opt/tma-projects}"
KEEP="${KEEP:-14}"
TAG="${TAG:-daily}"
CTN=tma-mysql
DB_USER=betogo
PLATFORM_DB="${MYSQL_PLATFORM_DATABASE:-betogo_platform}"
BACKUP_DIR="$WORK_DIR/backups"

SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
PODMAN="$SUDO podman"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

DB_PASS=$(grep -m1 '^MYSQL_BETOGO_PASSWORD=' "$WORK_DIR/.env" | cut -d= -f2- | tr -d "\"'")
[ -n "$DB_PASS" ] || { log "读取不到 MYSQL_BETOGO_PASSWORD"; exit 1; }

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)

mysql_q() {  # 无表头查询
  $PODMAN exec -i "$CTN" mysql -N -B -u"$DB_USER" -p"$DB_PASS" -e "$1" 2>/dev/null
}

# 租户库清单从平台库取。读不到就退回只备自营站 —— 平台库挂了不该连带
# 让自营站当天没有备份，那是两件事。
TENANT_DBS=$(mysql_q "SELECT db_name FROM \`$PLATFORM_DB\`.pf_tenant ORDER BY id;")
if [ -z "$TENANT_DBS" ]; then
  log "警告：从 $PLATFORM_DB.pf_tenant 读不到租户库清单，本次只备份 betogo"
  TENANT_DBS="betogo"
fi

DBS=$(printf '%s\n%s\n' "$PLATFORM_DB" "$TENANT_DBS" | awk 'NF && !seen[$0]++')
log "本次备份 $(echo "$DBS" | wc -l | tr -d ' ') 个库: $(echo "$DBS" | tr '\n' ' ')"

FAILED=""
for DB in $DBS; do
  OUT="$BACKUP_DIR/$DB-$TAG-$STAMP.sql.gz"
  TMP="$OUT.part"
  log "开始备份 $DB -> $(basename "$OUT")"

  $PODMAN exec -i "$CTN" mysqldump --default-character-set=utf8mb4 \
    --single-transaction --quick --no-tablespaces \
    -u"$DB_USER" -p"$DB_PASS" "$DB" 2>/tmp/daily-backup-err | gzip > "$TMP"
  rc=${PIPESTATUS[0]}
  if [ "$rc" != "0" ]; then
    log "  mysqldump 失败 rc=$rc: $(grep -vi insecure /tmp/daily-backup-err | head -3 | tr '\n' ' ')"
    rm -f "$TMP"; FAILED="$FAILED $DB"; continue
  fi
  if ! gzip -t "$TMP" 2>/dev/null; then
    log "  gzip 损坏，丢弃"; rm -f "$TMP"; FAILED="$FAILED $DB"; continue
  fi
  TBLS=$(gzip -dc "$TMP" | grep -c 'CREATE TABLE')
  if [ "$TBLS" -lt 10 ]; then
    log "  表数异常($TBLS)，丢弃"; rm -f "$TMP"; FAILED="$FAILED $DB"; continue
  fi
  mv "$TMP" "$OUT"
  log "  完成: $(du -h "$OUT" | cut -f1), $TBLS 张表"

  # 保留策略按库独立：只清理本脚本产出的 daily/manual，preclean 等手动备份不动
  DELN=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rm -f "$f" && DELN=$((DELN+1)) && log "  清理旧备份: $(basename "$f")"
  done < <(ls -1t "$BACKUP_DIR/$DB-daily-"*.sql.gz "$BACKUP_DIR/$DB-manual-"*.sql.gz 2>/dev/null | tail -n +$((KEEP+1)))
  log "  $DB 保留最近 $KEEP 份，本次清理 $DELN 份"
done

if [ -n "$FAILED" ]; then
  log "以下库备份失败:$FAILED"
  exit 1
fi
log "全部完成，共 $(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ') 份备份文件"
