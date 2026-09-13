#!/usr/bin/env bash
# 交易明细冷数据归档：导出为 .sql.gz 后从库中删除，把 betogo 压到 t4g.medium 装得下的体积。
#
# 🔴 手动执行，**绝不可**放进 infra/database/betogo/ 迁移目录。
#    迁移文件每次部署都会跑，历史上 037/031/044 就是这样静默清空线上数据的。
#
# 用法（在生产机 /opt/tma-projects 下）：
#   bash scripts/archive/archive-cold-data.sh                  # 预演，只报告不删
#   bash scripts/archive/archive-cold-data.sh --apply          # 真的归档
#   bash scripts/archive/archive-cold-data.sh --apply --optimize   # 归档并回收磁盘
#   KEEP_DAYS=45 bash scripts/archive/archive-cold-data.sh --apply
#
# 两种删除策略，按表的主键类型选（实测确认，不要想当然统一）：
#   id   —— 主键是 bigint 自增。先用时间求出 cutoff id，再按主键分批删，走 PRIMARY 最快。
#           bg_bet_round(first_at) / bg_turnover_logs(created_at) 只有复合索引，
#           直接按时间删会退化成 skip scan，所以这两张也走 id。
#   time —— bg_wallet_ledger 的 id 是 varchar(40) 非自增（形如 VG_1786656384040_bb1603），
#           按 id 比较没有意义；它有单列 idx_created，直接按时间删走 range scan。
set -uo pipefail

WORK_DIR="${WORK_DIR:-/opt/tma-projects}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BATCH="${BATCH:-2000}"
SLEEP_MS="${SLEEP_MS:-200}"
DB="${DB:-betogo}"
CTN=tma-mysql
ARCHIVE_DIR="$WORK_DIR/archives"

APPLY=0; OPTIMIZE=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --optimize) OPTIMIZE=1 ;;
    *) echo "未知参数: $a" >&2; exit 2 ;;
  esac
done

SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"
PODMAN="$SUDO podman"
log() { echo "[$(date '+%F %T')] $*"; }

PASS=$($PODMAN exec "$CTN" printenv MYSQL_ROOT_PASSWORD 2>/dev/null)
[ -n "$PASS" ] || { log "取不到 MySQL root 密码"; exit 1; }
q() { $PODMAN exec -i "$CTN" mysql -uroot -p"$PASS" -N -B -e "$1" 2>/dev/null; }

# 表名:时间列:策略。顺序即删除顺序 —— 子表(allocations)必须在父表(logs)之前。
TABLES=(
  "bg_turnover_allocations::child"
  "bg_turnover_logs:created_at:id"
  "bg_568win_report_bet:order_time:id"
  "bg_568win_wallet_txn:created_at:id"
  "bg_bet_order:created_at:id"
  "bg_bet_round:first_at:id"
  "bg_wallet_ledger:created_at:time"
)

CUTOFF=$(q "SELECT DATE_SUB(NOW(), INTERVAL $KEEP_DAYS DAY);")
[ -n "$CUTOFF" ] || { log "取不到 cutoff 时间，中止"; exit 1; }
log "保留窗口：$KEEP_DAYS 天（早于 $CUTOFF 的记录将被归档）"
log "模式：$([ $APPLY = 1 ] && echo '真实执行' || echo '预演（不删任何东西）')"

SIZE_BEFORE=$(q "SELECT round(sum(data_length+index_length)/1048576,1) FROM information_schema.tables WHERE table_schema='$DB';")
log "当前 $DB 库大小：${SIZE_BEFORE} MB"

# bg_login_log 被风控的 30 天关联账号查询依赖（withdraw-review.service.ts），
# 故意不在归档清单里；这里只做体积提示，避免它日后悄悄长大。
LOGIN_MB=$(q "SELECT round((data_length+index_length)/1048576,1) FROM information_schema.tables WHERE table_schema='$DB' AND table_name='bg_login_log';")
log "（参考）bg_login_log ${LOGIN_MB:-0} MB —— 风控依赖，不归档"

mkdir -p "$ARCHIVE_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
TOTAL_ROWS=0
LOG_CUTOFF_ID=0

if [ $APPLY = 1 ]; then
  log "归档前强制全量备份…"
  TAG=pre-archive WORK_DIR="$WORK_DIR" bash "$WORK_DIR/scripts/daily-backup.sh" \
    || { log "备份失败，中止归档"; exit 1; }
  log "备份完成"
fi

# 导出 + 分批删除。$1=表名 $2=WHERE 条件（不含 WHERE 关键字）
archive_table() {
  local T="$1" WHERE="$2" ROWS="$3"
  local OUT="$ARCHIVE_DIR/${T}-before-${STAMP}.sql.gz"
  log "  导出 → $(basename "$OUT")"
  $PODMAN exec -i "$CTN" mysqldump -uroot -p"$PASS" \
      --single-transaction --quick --no-create-info --skip-lock-tables \
      --where="$WHERE" "$DB" "$T" 2>/dev/null | gzip -c > "$OUT"
  if ! gzip -t "$OUT" 2>/dev/null || [ ! -s "$OUT" ]; then
    log "  ✗ 导出文件损坏或为空，跳过删除：$OUT"
    return 1
  fi
  log "  导出校验通过（$(du -h "$OUT" | cut -f1)）"

  log "  分批删除（每批 $BATCH 行）…"
  local DELETED=0 N
  while :; do
    N=$(q "DELETE FROM \`$DB\`.\`$T\` WHERE $WHERE LIMIT $BATCH; SELECT ROW_COUNT();")
    N="${N:-0}"
    [ "$N" -le 0 ] 2>/dev/null && break
    DELETED=$((DELETED + N))
    printf '\r    已删 %s / %s' "$DELETED" "$ROWS"
    [ "$SLEEP_MS" -gt 0 ] && sleep "$(awk "BEGIN{print $SLEEP_MS/1000}")"
  done
  echo
  log "  ✓ $T 完成，删除 $DELETED 行"
}

for entry in "${TABLES[@]}"; do
  IFS=: read -r T COL STRATEGY <<< "$entry"
  [ "$STRATEGY" = "child" ] && continue    # allocations 在循环后单独处理

  MB=$(q "SELECT round((data_length+index_length)/1048576,1) FROM information_schema.tables WHERE table_schema='$DB' AND table_name='$T';")

  if [ "$STRATEGY" = "id" ]; then
    CUT_ID=$(q "SELECT IFNULL(MAX(id),0) FROM \`$DB\`.\`$T\` WHERE $COL < '$CUTOFF';")
    CUT_ID="${CUT_ID:-0}"
    [ "$T" = "bg_turnover_logs" ] && LOG_CUTOFF_ID="$CUT_ID"
    WHERE="id <= $CUT_ID"
    ROWS=$(q "SELECT COUNT(*) FROM \`$DB\`.\`$T\` WHERE id <= $CUT_ID;")
  else
    WHERE="$COL < '$CUTOFF'"
    ROWS=$(q "SELECT COUNT(*) FROM \`$DB\`.\`$T\` WHERE $COL < '$CUTOFF';")
  fi

  ROWS="${ROWS:-0}"
  if [ "$ROWS" -eq 0 ] 2>/dev/null; then
    log "$T: 无冷数据可归档（表 ${MB}MB）"
    continue
  fi
  log "$T: 待归档 $ROWS 行 [$STRATEGY: $WHERE]，当前表 ${MB}MB"
  TOTAL_ROWS=$((TOTAL_ROWS + ROWS))
  [ $APPLY = 1 ] && archive_table "$T" "$WHERE" "$ROWS"
done

# bg_turnover_allocations 没有时间列，靠 log_id(bigint, 有索引) 跟随 bg_turnover_logs。
if [ "$LOG_CUTOFF_ID" -gt 0 ] 2>/dev/null; then
  T=bg_turnover_allocations
  WHERE="log_id <= $LOG_CUTOFF_ID"
  ROWS=$(q "SELECT COUNT(*) FROM \`$DB\`.\`$T\` WHERE $WHERE;")
  ROWS="${ROWS:-0}"
  log "$T: 待归档 $ROWS 行 [child: $WHERE]"
  TOTAL_ROWS=$((TOTAL_ROWS + ROWS))
  [ $APPLY = 1 ] && [ "$ROWS" -gt 0 ] && archive_table "$T" "$WHERE" "$ROWS"
fi

# DELETE 只把页标记为可复用，.ibd 文件不会缩小 —— 而降配要的正是更小的物理体积
# 和热数据集，所以必须 OPTIMIZE。它会重建表，请在低峰期跑。
if [ $OPTIMIZE = 1 ] && [ $APPLY = 1 ]; then
  log "OPTIMIZE TABLE 回收空间（重建表，耗时较长）…"
  for entry in "${TABLES[@]}"; do
    T="${entry%%:*}"
    log "  optimize $T"
    q "OPTIMIZE TABLE \`$DB\`.\`$T\`;" >/dev/null
  done
fi

SIZE_AFTER=$(q "SELECT round(sum(data_length+index_length)/1048576,1) FROM information_schema.tables WHERE table_schema='$DB';")
log "----------------------------------------"
if [ $APPLY = 1 ]; then
  log "归档完成：${SIZE_BEFORE}MB → ${SIZE_AFTER}MB"
  log "归档文件在 $ARCHIVE_DIR（请下载留存后再清理）"
  [ $OPTIMIZE = 1 ] || log "⚠️ 未跑 OPTIMIZE，.ibd 体积尚未回收，降配前请补跑 --apply --optimize"
else
  log "预演结束：共 $TOTAL_ROWS 行可归档，未改动任何数据"
  log "确认无误后加 --apply 执行"
fi
