#!/usr/bin/env bash
# 🔴 一次性脚本，手动执行，不自动部署，不放进 infra/database/ 迁移目录。
#
# 背景：生产 betogo 库的 schema_migrations 表存在但**是空的** —— 生产历来靠手工执行 SQL，
# 从没走过迁移执行器。而 remote-migrate.sh 遇到「有业务表 + 迁移记录为空」的库时，
# 会把全部版本号一次性标记为已执行（这条兜底是为老库准备的，本身没错）。
# 直接对生产跑一次，后果是：
#
#   216 / 217（常规复充赠金，生产确实缺 bg_regular_redep_tier 这张表）
#   219 / 220 / 221（包网新增：首页区块、settlement_mode、底部导航）
#
# 全部会被标记成「已执行」而实际从未执行，之后永远不会再跑 —— 代码上线即缺表缺列。
#
# 本脚本做的是：把**确实已经生效**的版本精确回填进 schema_migrations，
# 把待执行的留空，让后续 remote-migrate.sh 正常增量执行它们。
#
# 用法（在生产服务器上）：
#   sudo env APP_DIR=/opt/tma-projects bash scripts/prod-seed-schema-migrations.sh          # 预览
#   sudo env APP_DIR=/opt/tma-projects APPLY=1 bash scripts/prod-seed-schema-migrations.sh  # 实际写入
#
# 执行前请再确认一次 PENDING 清单：多标一个 = 该迁移永远不会执行；
# 少标一个 = 该迁移会重跑（DDL 重跑通常直接报错中断部署）。

APP_DIR="${APP_DIR:-/opt/tma-projects}"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
DB_NAME="${DB_NAME:-betogo}"

# 确认尚未在生产生效、需要留给迁移执行器去跑的版本。
# 依据：216/217 的 bg_regular_redep_tier 表在生产不存在；219-221 是包网分支新增，从未发布过。
PENDING="${PENDING:-216_regular_redeposit_bonus 217_regular_redeposit_per_tier_turnover 219_home_section_layout 220_settlement_mode 221_bottom_nav}"

cd "$APP_DIR" || { echo "进不去 $APP_DIR" >&2; exit 1; }
[ -r .env ] || { echo "读不到 .env，请用 sudo 运行" >&2; exit 1; }

val() { grep -m1 "^$1=" .env | cut -d= -f2- | tr -d "\"'"; }
BU=$(val MYSQL_BETOGO_USER); BU=${BU:-betogo}
BP=$(val MYSQL_BETOGO_PASSWORD)

q() { $CTR exec "$MYSQL_CTR" mysql -u"$BU" -p"$BP" "$DB_NAME" -sN -e "$1" 2>/dev/null; }
e() { $CTR exec "$MYSQL_CTR" mysql -u"$BU" -p"$BP" "$DB_NAME" -e "$1" 2>/dev/null; }

CUR=$(q "SELECT COUNT(*) FROM schema_migrations")
echo "当前 schema_migrations 行数: ${CUR:-读取失败}"
if [ "${CUR:-0}" -gt 0 ]; then
  echo "🔴 表里已有记录，本脚本只针对「空表」的首次回填。请人工确认后再决定怎么处理。" >&2
  exit 1
fi

VALUES=""; SEEDED=0; SKIPPED=""
for f in $(ls infra/database/betogo/[0-9]*.sql 2>/dev/null | sort); do
  ver=$(basename "$f" .sql)
  case " $PENDING " in
    *" $ver "*) SKIPPED="$SKIPPED $ver"; continue ;;
  esac
  VALUES="${VALUES}('$ver'),"
  SEEDED=$((SEEDED+1))
done

echo "将标记为已执行: $SEEDED 个"
echo "留给迁移执行器去跑:$SKIPPED"

if [ "${APPLY:-}" != 1 ]; then
  echo
  echo "（预览模式，未写入。确认无误后加 APPLY=1 重跑）"
  exit 0
fi

e "INSERT IGNORE INTO schema_migrations (version) VALUES ${VALUES%,}"
echo "回填完成，现有 $(q 'SELECT COUNT(*) FROM schema_migrations') 行"
echo "最后 3 条: $(q 'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3' | tr '\n' ' ')"
