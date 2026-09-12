# MySQL root 密码解析。被 01/04/reset 三个脚本 source。
#
# 为什么不能只读 .env：生产上 .env 里的 MYSQL_ROOT_PASSWORD 与 MySQL 容器初始化
# 时用的那把已经对不上（历史手工改过），只信 .env 会直接 Access denied，而且
# 报错信息看不出是密码来源的问题。容器环境变量里那把才是建库时用的，优先试它。
# 与 remote-migrate.sh 的 resolve_root_pw 同源。
#
# 需要调用方先设好 CTR / MYSQL_CTR，并且 cd 到含 .env 的目录。
# 成功时把密码写进 PW。
resolve_mysql_pw() {
  local from_ctr from_env cand
  from_ctr=$($CTR inspect "$MYSQL_CTR" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -m1 '^MYSQL_ROOT_PASSWORD=' | cut -d= -f2-)
  from_env=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
  for cand in "$from_ctr" "$from_env"; do
    [ -n "$cand" ] || continue
    if $CTR exec "$MYSQL_CTR" mysql -uroot -p"$cand" -e 'SELECT 1' >/dev/null 2>&1; then
      PW="$cand"
      return 0
    fi
  done
  echo "🔴 容器环境变量与 .env 里的 root 密码都连不上 MySQL" >&2
  return 1
}
