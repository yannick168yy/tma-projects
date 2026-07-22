#!/usr/bin/env bash
# ⚠️⚠️⚠️ 生产环境用户数据清理（betogo.games / AWS）—— 正式对外运营前的一次性清库 ⚠️⚠️⚠️
#
# 作用：清空全部用户及派生数据 + AUTO_INCREMENT 归零 + 清 Redis 用户缓存 + 清 KYC 上传图片
# 保留：admin 账号、后台设置、支付渠道/路由、活动/VIP/任务配置、风控策略黑名单、
#       团队费率/套餐、568Win Agent/Provider/Game 目录、schema_migrations 迁移状态
#
# 【硬前置】执行删除前先做全库 mysqldump 并拉回本地；备份失败立即中止，绝不删数据。
#
# 生产库名固定 betogo，凭证用 MYSQL_BETOGO_*（注意：.env 里第一个 MYSQL_DATABASE=tma 是
# MySQL 镜像初始化的遗留默认库，业务数据实际都在 betogo schema，切勿被它误导）。
#
# 用法（人工交互）：bash scripts/clear-all-user-data.prod.sh
#   需两次确认：先输入 betogo，再输入 CLEAR-BETOGO-PROD
# 用法（自动，跳过交互）：CONFIRM=CLEAR-BETOGO-PROD bash scripts/clear-all-user-data.prod.sh
set -euo pipefail

# ── 生产参数 ────────────────────────────────────────────────
HOST=ubuntu@13.213.107.231
KEY="/Users/yannicky/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ServerAliveInterval=10 -o ServerAliveCountMax=12 -o ConnectTimeout=25"
WORK_DIR=/opt/tma-projects
PODMAN="sudo podman"
MYSQL_CTN=tma-mysql
REDIS_CTN=tma-redis
DB_NAME=betogo                              # 业务库名固定
KYC_IMG_DIR=$WORK_DIR/data/kyc
LOCAL_BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 读取 betogo 密码的远程片段（各步复用）
RCREDS='DB_PASS=$(grep -m1 "^MYSQL_BETOGO_PASSWORD=" '"$WORK_DIR"'/.env | cut -d= -f2- | tr -d "\"'"'"'"); DB_USER=betogo; DB_NAME=betogo'

# ── 二次确认 ────────────────────────────────────────────────
if [ "${CONFIRM:-}" = "CLEAR-BETOGO-PROD" ]; then
  echo "已通过环境变量 CONFIRM 确认，跳过交互。"
else
  echo "════════════════════════════════════════════════════════════"
  echo "  ⚠️  即将清空【生产库 $DB_NAME】($HOST) 的全部用户数据，不可逆。"
  echo "════════════════════════════════════════════════════════════"
  read -r -p "  第 1 次确认，输入目标库名 [betogo]: " c1
  [ "$c1" = "betogo" ] || { echo "已取消。"; exit 1; }
  read -r -p "  第 2 次确认，输入口令 [CLEAR-BETOGO-PROD]: " c2
  [ "$c2" = "CLEAR-BETOGO-PROD" ] || { echo "已取消。"; exit 1; }
fi

# ── [1/5] 全库备份（硬前置，失败即止）─────────────────────────
echo "==> [1/5] 生产全库 mysqldump 备份..."
mkdir -p "$LOCAL_BACKUP_DIR"
# 落到后台备份目录(bff 挂载 /app/data/backups),清库前备份可在后台列表看到/下载
REMOTE_DUMP="$WORK_DIR/backups/betogo-preclean-$STAMP.sql.gz"
$SSH "$HOST" "REMOTE_DUMP='$REMOTE_DUMP' bash -s" <<REMOTE
set -uo pipefail
$RCREDS
mkdir -p "\$(dirname "\$REMOTE_DUMP")"
sudo podman exec -i $MYSQL_CTN sh -c "exec mysql -u\$DB_USER -p'\$DB_PASS' -N -e \"SELECT 1 FROM information_schema.schemata WHERE schema_name='betogo'\"" > /tmp/chk 2>/dev/null
[ -s /tmp/chk ] || { echo "❌ 找不到 betogo schema，中止"; exit 1; }
$PODMAN exec -i $MYSQL_CTN sh -c "exec mysqldump --default-character-set=utf8mb4 --single-transaction --quick --no-tablespaces -u\$DB_USER -p'\$DB_PASS' \$DB_NAME" 2>/tmp/de | gzip > "\$REMOTE_DUMP"
rc=\${PIPESTATUS[0]}
if [ "\$rc" != "0" ]; then echo "❌ mysqldump 失败 rc=\$rc"; grep -vi insecure /tmp/de | head; rm -f "\$REMOTE_DUMP"; exit 1; fi
echo "  远程备份: \$(ls -lh "\$REMOTE_DUMP" | awk '{print \$5}')  表数:\$(gzip -dc "\$REMOTE_DUMP" | grep -c 'CREATE TABLE')"
REMOTE
echo "    拉回本地..."
scp -i "$KEY" -o StrictHostKeyChecking=no "$HOST:$REMOTE_DUMP" "$LOCAL_BACKUP_DIR/"
LOCAL_DUMP="$LOCAL_BACKUP_DIR/betogo-preclean-$STAMP.sql.gz"
[ -s "$LOCAL_DUMP" ] || { echo "❌ 备份为空，中止！未删除任何数据。"; exit 1; }
gzip -t "$LOCAL_DUMP" || { echo "❌ 备份损坏，中止！"; exit 1; }
TBLS=$(gzip -dc "$LOCAL_DUMP" | grep -c 'CREATE TABLE')
[ "$TBLS" -ge 10 ] || { echo "❌ 备份只含 $TBLS 张表，异常，中止！"; exit 1; }
echo "    ✅ 备份完成: $LOCAL_DUMP ($(du -h "$LOCAL_DUMP" | cut -f1), $TBLS 张表)"

# ── [2/5] 同步清理 SQL 到服务器 ──────────────────────────────
echo "==> [2/5] 上传清理 SQL..."
scp -i "$KEY" -o StrictHostKeyChecking=no \
  "$SCRIPT_DIR/clear-all-user-data.sql" \
  "$SCRIPT_DIR/reset-autoinc.prod.sql" \
  "$HOST:$WORK_DIR/scripts/"

# ── [3/5] 执行清理 + AUTO_INCREMENT 归零 ─────────────────────
echo "==> [3/5] 清空用户数据并归零自增..."
$SSH "$HOST" "bash -s" <<REMOTE
set -uo pipefail
$RCREDS
echo "  -- 清空用户数据 --"
$PODMAN exec -i $MYSQL_CTN sh -c "exec mysql --default-character-set=utf8mb4 -u\$DB_USER -p'\$DB_PASS' \$DB_NAME" < $WORK_DIR/scripts/clear-all-user-data.sql 2>&1 | grep -vi insecure || true
echo "  -- AUTO_INCREMENT 归零 --"
$PODMAN exec -i $MYSQL_CTN sh -c "exec mysql --default-character-set=utf8mb4 -u\$DB_USER -p'\$DB_PASS' \$DB_NAME" < $WORK_DIR/scripts/reset-autoinc.prod.sql 2>&1 | grep -vi insecure || true
REMOTE

# ── [4/5] 清 Redis 用户缓存 ──────────────────────────────────
echo "==> [4/5] 清 Redis 用户缓存..."
$SSH "$HOST" "bash -s" <<REMOTE
for pattern in \
  'tma:user:*' 'tma:identity:*' 'tma:identities:user:*' 'tma:invite:*' 'tma:session:*' \
  'tma:wallet:*' 'tma:deposit:*' 'tma:deposits:user:*' 'tma:withdraw:*' 'tma:withdrawals:user:*' 'tma:ledger:user:*' \
  'tma:kyc:*' 'kyc:otp:*' 'kyc:otp:sent:*' 'kyc:otp:lock:*' 'kyc:rl:*' 'kyc:idlock:*' 'kyc:fail:*' \
  'auth:forgot:*' 'auth:login:*' 'withdraw:lock:*' 'sms:daily:*'; do
  $PODMAN exec $REDIS_CTN sh -c "n=0; for k in \\\$(redis-cli --scan --pattern '\$pattern'); do redis-cli del \"\\\$k\" >/dev/null; n=\\\$((n+1)); done; echo \"  Redis \$pattern: \\\$n\""
done
REMOTE

# ── [5/5] 清 KYC 上传图片 ────────────────────────────────────
echo "==> [5/5] 清 KYC 上传图片..."
$SSH "$HOST" "bash -s" <<REMOTE
if [ -d "$KYC_IMG_DIR" ]; then
  # 保留 covers/(游戏封面),只清 KYC 用户上传件
  find "$KYC_IMG_DIR" -mindepth 1 -maxdepth 1 ! -name covers -exec rm -rf {} + 2>/dev/null || true
  echo "  已清 $KYC_IMG_DIR（保留 covers/）"
else
  echo "  目录不存在，跳过: $KYC_IMG_DIR"
fi
REMOTE

echo "════════════════════════════════════════════════════════════"
echo "  ✅ 完成。备份留底: $LOCAL_DUMP"
echo "════════════════════════════════════════════════════════════"
