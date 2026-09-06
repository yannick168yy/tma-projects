#!/usr/bin/env bash
# 生产包网升级的收尾三件事，一条命令跑完。在本地仓库根目录执行：
#
#   bash scripts/prod-finish-setup.sh
#
# 做什么：
#   1. 回填 betogo 库的 schema_migrations（先给你看清单，确认后才写）
#   2. 补登记 origin.betogo.games 到平台库
#   3. 建一键开站账号 provision
#
# 全部幂等：重复跑不会重复写，已完成的步骤会显示「已就绪，跳过」。
# 不碰任何业务数据，不重启任何容器，不动 nginx。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROD_HOST="${PROD_HOST:-ubuntu@13.213.107.231}"
PROD_DIR="${PROD_DIR:-/opt/tma-projects}"
KEY="${PROD_SSH_KEY:-/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem}"

SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no)
RSH="ssh -i $KEY -o StrictHostKeyChecking=no"
remote() { "${SSH[@]}" "$PROD_HOST" "$@"; }

echo "🔴 目标生产：$PROD_HOST:$PROD_DIR"
echo

# ── 步骤 1：核对迁移记录 ───────────────────────────────────────────
# 只读核对，不写。生产的 schema_migrations 一直是正常维护的（244 行），
# 待执行的只有包网新增的 219/220/221 —— 它们随代码发布时由 deploy-prod.sh db 执行。
echo "━━ 1/3 核对迁移记录 ━━"
remote "sudo bash -c 'cd $PROD_DIR; BU=\$(grep -m1 ^MYSQL_BETOGO_USER= .env | cut -d= -f2-); BP=\$(grep -m1 ^MYSQL_BETOGO_PASSWORD= .env | cut -d= -f2-);
echo \"   已执行迁移: \$(podman exec tma-mysql mysql -u\$BU -p\$BP betogo -sN -e \"SELECT COUNT(*) FROM schema_migrations\" 2>/dev/null) 条\";
echo \"   最近一条:   \$(podman exec tma-mysql mysql -u\$BU -p\$BP betogo -sN -e \"SELECT CONCAT(version, ' @ ' , executed_at) FROM schema_migrations ORDER BY executed_at DESC LIMIT 1\" 2>/dev/null)\"'"
echo

# ── 步骤 2：补登记 origin.betogo.games ────────────────────────────
echo "━━ 2/3 登记 origin.betogo.games ━━"
remote "sudo bash -c 'cd $PROD_DIR; BU=\$(grep -m1 ^MYSQL_BETOGO_USER= .env | cut -d= -f2-); BP=\$(grep -m1 ^MYSQL_BETOGO_PASSWORD= .env | cut -d= -f2-); podman exec tma-mysql mysql -u\$BU -p\$BP betogo_platform -e \"
INSERT INTO pf_tenant_domain (tenant_id, domain, market, purpose, app_market, app_priority)
VALUES (1, \\\"origin.betogo.games\\\", \\\"PH\\\", \\\"site\\\", NULL, 100)
ON DUPLICATE KEY UPDATE market=VALUES(market), purpose=VALUES(purpose)\" 2>/dev/null'"
echo "   完成"
echo

# ── 步骤 3：一键开站账号 ──────────────────────────────────────────
echo "━━ 3/3 一键开站账号 ━━"
DEPLOY_HOST="$PROD_HOST" \
SSH_IDENTITY_FILE="$KEY" \
SSH_OPTS="-o StrictHostKeyChecking=no" \
REMOTE_DIR="$PROD_DIR" \
REMOTE_PREFIX=sudo \
bash "$ROOT/scripts/setup-provision-account.sh" | sed 's/^/   /'
echo

# ── 汇总 ──────────────────────────────────────────────────────────
echo "━━ 结果核对 ━━"
remote "sudo bash -c 'cd $PROD_DIR; BU=\$(grep -m1 ^MYSQL_BETOGO_USER= .env | cut -d= -f2-); BP=\$(grep -m1 ^MYSQL_BETOGO_PASSWORD= .env | cut -d= -f2-);
echo \"   平台库租户数: \$(podman exec tma-mysql mysql -u\$BU -p\$BP betogo_platform -sN -e \"SELECT COUNT(*) FROM pf_tenant\" 2>/dev/null)\";
echo \"   已登记域名数: \$(podman exec tma-mysql mysql -u\$BU -p\$BP betogo_platform -sN -e \"SELECT COUNT(*) FROM pf_tenant_domain\" 2>/dev/null)\";
echo \"   origin 域名:  \$(podman exec tma-mysql mysql -u\$BU -p\$BP betogo_platform -sN -e \"SELECT domain FROM pf_tenant_domain WHERE domain=\\\"origin.betogo.games\\\"\" 2>/dev/null)\";
echo \"   迁移记录行数: \$(podman exec tma-mysql mysql -u\$BU -p\$BP betogo -sN -e \"SELECT COUNT(*) FROM schema_migrations\" 2>/dev/null)\";
echo \"   开站账号:     \$(grep -m1 ^MYSQL_PROVISION_USER= .env | cut -d= -f2-)\"'"
echo
echo "✅ 收尾完成。剩下的是平台控制台上线，需要你在域名商与服务器上做："
echo "   1. platform.betogo.games 的 A 记录指向 13.213.107.231"
echo "   2. sudo certbot certonly --nginx -d platform.betogo.games"
echo "   3. 把 deploy/single-node/nginx-platform-prod.conf 里的 deny all 换成你的出口 IP 后启用"
