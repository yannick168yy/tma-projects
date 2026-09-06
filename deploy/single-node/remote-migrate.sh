#!/usr/bin/env bash
# 在服务器上执行数据库迁移（平台库 + 各租户库）。测试与生产共用同一份逻辑。
#
# WHY 独立成文件：这段逻辑原先内联在 deploy-fast.sh 的 ssh heredoc 里，
# 里面写死了 `cd /root/workspace/tma-projects` 和裸 `podman`。生产是
# /opt/tma-projects + rootful podman + .env 属 root 600 —— 三处全对不上，
# 等于生产根本跑不了平台库迁移。参数化后两条部署路径引用同一份。
#
# 用法（服务器本地执行，或由部署脚本 ssh 调用）：
#   APP_DIR=/root/workspace/tma-projects bash remote-migrate.sh all        # 测试，root 登录
#   sudo env APP_DIR=/opt/tma-projects bash remote-migrate.sh all          # 生产，需 root 读 .env
#
# 参数：platform（只建平台库并跑其迁移）| tenants（只跑各租户库迁移）| all（默认）
#
# 环境变量：
#   APP_DIR    项目根目录，默认 /root/workspace/tma-projects
#   CTR        容器命令，默认自动探测 podman/docker。root 下 podman 即 rootful，无需写 sudo
#   MYSQL_CTR  MySQL 容器名，默认 tma-mysql
#   PF_DB      平台库名，默认 betogo_platform

APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
CTR="${CTR:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
PF_DB="${PF_DB:-betogo_platform}"
MODE="${1:-all}"

cd "$APP_DIR" || { echo "  [db] 失败：进不去 $APP_DIR" >&2; exit 1; }

# 生产的 .env 是 root:root 600。非 root 运行时 grep 会静默失败、密码取成空串，
# 最后报出一句看不懂的 SQL 错误 —— 这里提前把原因说清楚。
if [ ! -r .env ]; then
  echo "  [db] 失败：读不到 $APP_DIR/.env（生产需以 root 运行本脚本）" >&2
  exit 1
fi

env_val() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d "\"'"; }

DB_USER=$(env_val MYSQL_BETOGO_USER)
DB_USER=${DB_USER:-$(env_val MYSQL_USER)}
DB_PASS=$(env_val MYSQL_BETOGO_PASSWORD)
DB_PASS=${DB_PASS:-$(env_val MYSQL_PASSWORD)}
DB_USER=${DB_USER:-betogo}

# root 密码有两个来源，且生产上它们并不一致：.env 里那份与 MySQL 容器初始化时用的
# 已经对不上（历史手工改过），只信 .env 会直接 Access denied 而看不出原因。
# 两个候选都试一遍，谁连得通用谁 —— 容器自身的环境变量优先，它就是建库时的那把。
resolve_root_pw() {
  local from_ctr from_env cand
  from_ctr=$($CTR inspect "$MYSQL_CTR" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -m1 '^MYSQL_ROOT_PASSWORD=' | cut -d= -f2-)
  from_env=$(env_val MYSQL_ROOT_PASSWORD)
  for cand in "$from_ctr" "$from_env"; do
    [ -n "$cand" ] || continue
    if $CTR exec "$MYSQL_CTR" mysql -uroot -p"$cand" -e "SELECT 1" >/dev/null 2>&1; then
      ROOT_PW="$cand"
      return 0
    fi
  done
  echo "  [db] 警告：容器环境变量与 .env 里的 root 密码都连不上 MySQL" >&2
  ROOT_PW=""
  return 1
}
resolve_root_pw

run_platform() {
  if [ -z "$ROOT_PW" ]; then
    echo "  [db] 拿不到可用的 root 密码，无法建平台库（建库与授权只能用 root）" >&2
    exit 1
  fi

  # root 建库并给应用账号授权（应用账号同时要访问平台库与租户库）
  # 注意：不能加 -i，否则 docker/podman exec 会吞掉后续脚本
  $CTR exec "$MYSQL_CTR" mysql -uroot -p"$ROOT_PW" -e "
CREATE DATABASE IF NOT EXISTS \`$PF_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON \`$PF_DB\`.* TO '$DB_USER'@'%';
FLUSH PRIVILEGES;" 2>/dev/null

  pq() { $CTR exec "$MYSQL_CTR" mysql -uroot -p"$ROOT_PW" "$PF_DB" -sN -e "$1" 2>/dev/null; }
  pe() { $CTR exec "$MYSQL_CTR" mysql -uroot -p"$ROOT_PW" "$PF_DB" -e "$1" 2>/dev/null; }

  pe "CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(64) NOT NULL,
  executed_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
)"

  # 平台库是新库，不做"已有库标记全部已执行"的兜底 —— 必须从 001 老老实实跑
  # 已执行版本一次性取回本地比对：每文件一次 SQL 往返在多租户下会放大成上万次，部署要跑几小时
  PF_APPLIED=$(pq "SELECT version FROM schema_migrations")
  PF_SKIP=0
  for f in $(ls infra/database/platform/[0-9]*.sql 2>/dev/null | sort); do
    [ -f "$f" ] || continue
    ver=$(basename "$f" .sql)
    if echo "$PF_APPLIED" | grep -qx "$ver"; then
      PF_SKIP=$((PF_SKIP+1))
      continue
    fi
    OUT=$($CTR exec -i "$MYSQL_CTR" \
      mysql --default-character-set=utf8mb4 -uroot -p"$ROOT_PW" "$PF_DB" < "$f" 2>&1)
    if [ $? -eq 0 ]; then
      pe "INSERT INTO schema_migrations (version) VALUES ('$ver')"
      echo "  ran(platform): $f"
    else
      echo "  failed(platform): $f — $(echo "$OUT" | grep -v Warning)" >&2
      exit 1
    fi
  done
  [ "$PF_SKIP" -gt 0 ] && echo "  [db] 平台库跳过 $PF_SKIP 个已执行迁移"
  echo "  [db] 平台库租户数: $(pq 'SELECT COUNT(*) FROM pf_tenant')"
}

run_tenants() {
  # 租户库清单来自平台库。读不到就退回只打 betogo —— 宁可少打一个新租户库，
  # 也不能因为平台库一时不可用把自营站的迁移也跳过。
  TENANT_DBS=$($CTR exec "$MYSQL_CTR" mysql -uroot -p"$ROOT_PW" "$PF_DB" -sN \
    -e "SELECT db_name FROM pf_tenant WHERE status <> 'closed' ORDER BY id" 2>/dev/null)
  if [ -z "$TENANT_DBS" ]; then
    echo "  [db] 警告：读不到平台库租户清单，本次只对 betogo 执行迁移" >&2
    TENANT_DBS=betogo
  fi
  echo "  [db] 目标库: $(echo $TENANT_DBS | tr '\n' ' ')"

  TOTAL_RAN=0
  for DB_NAME in $TENANT_DBS; do
    # 辅助：静默查询/执行（屏蔽密码警告）。注意不能加 -i，否则 exec 会吞掉后续脚本
    mq() { $CTR exec "$MYSQL_CTR" mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -sN -e "$1" 2>/dev/null; }
    me() { $CTR exec "$MYSQL_CTR" mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "$1" 2>/dev/null; }

    if [ -z "$(mq 'SELECT 1')" ]; then
      echo "  [db] 失败：库 $DB_NAME 不可访问（不存在或无权限）" >&2
      exit 1
    fi

    # 空库 = 新开的租户库：用结构基线建表，而不是重放迁移。
    # 历史迁移链已无法从 001 重放（008 起就依赖后续才补上的列），只能走基线。
    # 基线自带 schema_migrations 数据，之后的新迁移照常增量执行。
    TBLCOUNT=$(mq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()")
    if [ "${TBLCOUNT:-0}" -eq 0 ]; then
      if [ ! -f infra/database/betogo/schema_baseline.sql ]; then
        echo "  [db][$DB_NAME] 失败：空库但找不到 schema_baseline.sql" >&2
        exit 1
      fi
      echo "  [db][$DB_NAME] 空库，应用结构基线..."
      OUT=$($CTR exec -i "$MYSQL_CTR" \
        mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
        < infra/database/betogo/schema_baseline.sql 2>&1)
      if [ $? -ne 0 ]; then
        echo "  [db][$DB_NAME] 基线应用失败 — $(echo "$OUT" | grep -v Warning)" >&2
        exit 1
      fi
      echo "  [db][$DB_NAME] 基线已应用，建表 $(mq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()") 张"
    fi

    me "CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(64) NOT NULL,
    executed_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
  )"

    # 只有「已有业务表但没有迁移记录」的老库才批量标记为已执行。
    # 新开的空库必须从 001 老老实实跑完，否则开出来的站是个没有表的空壳。
    MC=$(mq "SELECT COUNT(*) FROM schema_migrations")
    BG=$(mq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_user'")
    if [ "${MC:-0}" -eq 0 ] && [ "${BG:-0}" -gt 0 ]; then
      echo "  [db][$DB_NAME] 已有数据库，初始化迁移版本记录..."
      MARK_VALUES=""
      for f in $(ls infra/database/betogo/[0-9]*.sql 2>/dev/null | sort); do
        ver=$(basename "$f" .sql)
        MARK_VALUES="${MARK_VALUES}('$ver'),"
      done
      [ -n "$MARK_VALUES" ] && me "INSERT IGNORE INTO schema_migrations (version) VALUES ${MARK_VALUES%,}"
      echo "  [db][$DB_NAME] 已标记 $(mq 'SELECT COUNT(*) FROM schema_migrations') 个迁移为已执行"
    fi

    # 已执行版本一次性取回本地比对：每文件一次 SQL 往返在多租户下会放大成上万次
    APPLIED=$(mq "SELECT version FROM schema_migrations")
    SKIP=0
    RAN=0
    for f in $(ls infra/database/betogo/[0-9]*.sql 2>/dev/null | sort); do
      [ -f "$f" ] || continue
      ver=$(basename "$f" .sql)
      if echo "$APPLIED" | grep -qx "$ver"; then
        SKIP=$((SKIP+1))
        continue
      fi
      OUT=$($CTR exec -i "$MYSQL_CTR" \
        mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$f" 2>&1)
      RC=$?
      if [ $RC -eq 0 ]; then
        me "INSERT INTO schema_migrations (version) VALUES ('$ver')"
        echo "  ran[$DB_NAME]: $f"
        RAN=$((RAN+1))
      else
        # 中止整个部署并指明是哪个租户库，不允许跳过继续
        echo "  failed[$DB_NAME]: $f — $(echo "$OUT" | grep -v Warning)" >&2
        exit 1
      fi
    done
    TOTAL_RAN=$((TOTAL_RAN+RAN))
    echo "  [db][$DB_NAME] 执行 $RAN，跳过 $SKIP"
  done
  echo "  [db] 全部租户库完成，共执行 $TOTAL_RAN 个迁移"
}

case "$MODE" in
  platform) run_platform ;;
  tenants)  run_tenants ;;
  all)      run_platform && run_tenants ;;
  *) echo "未知参数: $MODE（可选: platform | tenants | all）" >&2; exit 1 ;;
esac
