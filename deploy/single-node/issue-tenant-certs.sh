#!/usr/bin/env bash
# P1-4 收尾：租户自带域名的 ACME 自动签发（在**宿主机**上跑，由 betogo-cert.timer 定时触发）。
#
# 为什么不在 bff-node 里做：容器碰不到宿主机的 nginx 配置与 certbot，
# 平台后台里放一个「签发」按钮只会得到一个永远失败的按钮。平台库负责「该签哪些」，
# 真正动线上配置的这一步留在宿主机、留在人能看到日志的地方。
#
# 平台子域名不进队列：它们由泛域名证书 *.<平台根域名> 覆盖，开站即可用。
#
# 幂等：证书还够久（>30 天）且 vhost 已存在就跳过；DNS 没指过来就跳过（不去撞 LE 的限流）。
#
#   bash issue-tenant-certs.sh            # 处理全部待签发域名
#   bash issue-tenant-certs.sh --dry-run  # 只打印要做什么
#   bash issue-tenant-certs.sh --domain a.com   # 只处理一个
set -uo pipefail
export PATH=/usr/bin:/usr/sbin:/bin:/sbin

MYSQL_CONTAINER="${MYSQL_CONTAINER:-tma-mysql}"
MYSQL_ROOT_PW="${MYSQL_ROOT_PASSWORD:-root_dev_only}"
PLATFORM_DB="${MYSQL_PLATFORM_DATABASE:-betogo_platform}"
# 宝塔的 vhost 目录；换环境时用环境变量覆盖，别改脚本
VHOST_DIR="${NGINX_VHOST_DIR:-/www/server/panel/vhost/nginx}"
WEBROOT="${ACME_WEBROOT:-/www/wwwroot/acme-challenge}"
ACME_EMAIL="${ACME_EMAIL:-}"
TPL="$(cd "$(dirname "$0")" && pwd)/nginx-tenant-site.conf.tpl"
# 站点与业务后台的 upstream
PORT_SITE="${TENANT_SITE_PORT:-8080}"
PORT_ADMIN="${TENANT_ADMIN_PORT:-8085}"
# 剩余天数少于它才续期，与 domain-cert.service 的 EXPIRING_DAYS 对齐
RENEW_DAYS="${ACME_RENEW_DAYS:-30}"

DRY_RUN=0
ONLY_DOMAIN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --domain)  ONLY_DOMAIN="${2:-}"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

LOG() { echo "[betogo-cert] $*"; }

mysql_q() { podman exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PW" -N -B "$PLATFORM_DB" -e "$1"; }
# 回写用：单引号内容先转义，别让域名里的怪字符拼坏 SQL
esc() { printf '%s' "$1" | sed "s/'/''/g"; }

command -v certbot >/dev/null || { LOG "没装 certbot：apt install -y certbot"; exit 1; }
[[ -f "$TPL" ]] || { LOG "找不到模板 $TPL"; exit 1; }
[[ -d "$VHOST_DIR" ]] || { LOG "vhost 目录不存在：$VHOST_DIR（用 NGINX_VHOST_DIR 指定）"; exit 1; }
[[ -n "$ACME_EMAIL" ]] || { LOG "缺 ACME_EMAIL：Let's Encrypt 要一个联系邮箱收到期提醒"; exit 1; }
mkdir -p "$WEBROOT/.well-known/acme-challenge"

FILTER="AND d.domain = '$(esc "$ONLY_DOMAIN")'"
[[ -z "$ONLY_DOMAIN" ]] && FILTER=""
ROWS="$(mysql_q "
  SELECT d.domain, d.purpose, t.code
    FROM pf_tenant_domain d JOIN pf_tenant t ON t.id = d.tenant_id
   WHERE d.enabled = 1 AND d.acme_enabled = 1 AND d.domain_type = 'custom'
         AND d.purpose IN ('site','admin') $FILTER
   ORDER BY d.domain")"

[[ -n "$ROWS" ]] || { LOG "没有待签发的自带域名"; exit 0; }

RELOAD_NEEDED=0
while IFS=$'\t' read -r DOMAIN PURPOSE CODE; do
  [[ -n "$DOMAIN" ]] || continue
  LIVE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  VHOST="$VHOST_DIR/tenant-$DOMAIN.conf"

  # 证书还够久且 vhost 在位 → 什么都不做。certbot 自带的 renew timer 会负责续期
  if [[ -f "$LIVE" && -f "$VHOST" ]] && openssl x509 -checkend $((RENEW_DAYS * 86400)) -noout -in "$LIVE" >/dev/null 2>&1; then
    continue
  fi

  # DNS 没指过来就别签：失败的挑战一样计入 Let's Encrypt 的失败限流，
  # 客户 DNS 慢慢配的这几天足够把额度撞光
  RESOLVED="$(dig +short A "$DOMAIN" @8.8.8.8 2>/dev/null | tail -1)"
  MYIP="${SERVER_PUBLIC_IP:-$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null)}"
  if [[ -z "$RESOLVED" ]]; then
    LOG "$DOMAIN 跳过：DNS 未解析"
    [[ $DRY_RUN == 0 ]] && mysql_q "UPDATE pf_tenant_domain SET cert_last_error = 'DNS 未解析' WHERE domain = '$(esc "$DOMAIN")'"
    continue
  fi
  if [[ -n "$MYIP" && "$RESOLVED" != "$MYIP" ]]; then
    LOG "$DOMAIN 跳过：A 记录 $RESOLVED 未指向本机 $MYIP"
    [[ $DRY_RUN == 0 ]] && mysql_q "UPDATE pf_tenant_domain SET cert_last_error = 'A 记录 $RESOLVED 未指向本机' WHERE domain = '$(esc "$DOMAIN")'"
    continue
  fi

  PORT="$PORT_SITE"
  [[ "$PURPOSE" == "admin" ]] && PORT="$PORT_ADMIN"

  if [[ $DRY_RUN == 1 ]]; then
    LOG "[dry-run] 会为 $DOMAIN（$CODE/$PURPOSE，upstream :$PORT）签发并写 $VHOST"
    continue
  fi

  # 先只放一个 80 端口的挑战块：模板里的 443 段引用了还不存在的证书文件，
  # 整份直接落地会让 nginx -t 失败，连带整台机器的 reload 都做不了
  if [[ ! -f "$LIVE" ]]; then
    cat > "$VHOST" <<EOF
# 临时：等待 $DOMAIN 的证书签发，由 issue-tenant-certs.sh 生成
server {
    listen 80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; default_type "text/plain"; }
    location / { return 503; }
}
EOF
    if ! nginx -t >/dev/null 2>&1; then
      LOG "$DOMAIN 失败：写入挑战 vhost 后 nginx -t 不通过，已回滚"
      rm -f "$VHOST"
      mysql_q "UPDATE pf_tenant_domain SET cert_status='failed', cert_last_error='挑战 vhost 使 nginx -t 失败' WHERE domain = '$(esc "$DOMAIN")'"
      continue
    fi
    nginx -s reload
  fi

  LOG "$DOMAIN 签发中…"
  ERR="$(certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
        --non-interactive --agree-tos -m "$ACME_EMAIL" --keep-until-expiring 2>&1)" || {
    LOG "$DOMAIN 签发失败"
    printf '%s\n' "$ERR" | tail -5
    REASON="$(printf '%s' "$ERR" | tr '\n' ' ' | tail -c 200)"
    mysql_q "UPDATE pf_tenant_domain SET cert_status='failed', cert_last_error='$(esc "$REASON")' WHERE domain = '$(esc "$DOMAIN")'"
    continue
  }

  sed -e "s|__DOMAIN__|$DOMAIN|g" \
      -e "s|__TENANT_CODE__|$CODE|g" \
      -e "s|__PURPOSE__|$PURPOSE|g" \
      -e "s|__WEBROOT__|$WEBROOT|g" \
      -e "s|__UPSTREAM_PORT__|$PORT|g" "$TPL" > "$VHOST"

  if ! nginx -t >/dev/null 2>&1; then
    LOG "$DOMAIN 失败：正式 vhost 使 nginx -t 不通过，已回滚（证书已签好，下轮重试写配置）"
    rm -f "$VHOST"
    mysql_q "UPDATE pf_tenant_domain SET cert_status='failed', cert_last_error='vhost 使 nginx -t 失败' WHERE domain = '$(esc "$DOMAIN")'"
    continue
  fi

  NOT_AFTER="$(openssl x509 -enddate -noout -in "$LIVE" 2>/dev/null | cut -d= -f2)"
  EXPIRES="$(date -u -d "$NOT_AFTER" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '')"
  mysql_q "UPDATE pf_tenant_domain
              SET cert_status='issued', cert_issued_at=NOW(3), cert_last_error=NULL,
                  cert_detail=NULL${EXPIRES:+, cert_expires_at='$EXPIRES'}
            WHERE domain = '$(esc "$DOMAIN")'"
  RELOAD_NEEDED=1
  LOG "$DOMAIN 签发完成，到期 ${EXPIRES:-未知}"
done <<< "$ROWS"

[[ $RELOAD_NEEDED == 1 && $DRY_RUN == 0 ]] && { nginx -s reload && LOG "nginx 已 reload"; }
exit 0
