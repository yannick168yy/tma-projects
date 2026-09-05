# single-node 部署

**服务器规格（各场景最低/推荐内存、CPU、磁盘）**：见 [docs/ops/SERVER-SIZING.md](../../docs/ops/SERVER-SIZING.md)。

## 默认：生产栈（2C2G）

| 容器 | 作用 |
|------|------|
| `tma-web-tma` | 静态前端 |
| `tma-bff-node` | API；`BFF_STORAGE=mysql`，Session 在 Redis |
| `tma-redis` | Session |
| `tma-mysql` | **独立** betogo 库（`:13306`，与宝塔 MySQL 无关） |

**不启动**：Nacos、RabbitMQ、core-java。

表结构：`infra/database/betogo/` → `scripts/apply-betogo-schema.sh`（本地/服务器同源）。

```bash
# Podman（阿里云常见）
bash deploy/single-node/podman-prod-minimal.sh

# 或 Compose
docker compose -f deploy/single-node/docker-compose.prod.yml up -d --build
```

配置：服务器 `/opt/tma-projects/.env` 需包含 `MYSQL_BETOGO_PASSWORD`、`TELEGRAM_BOT_TOKEN`、`GOOGLE_*`。

## 全量栈（4G+ 或压测）

```bash
bash deploy/single-node/podman-prod-full.sh
# 或
docker compose -f deploy/single-node/docker-compose.prod.full.yml up -d --build
```

## 本地 Docker

```bash
./scripts/local-deploy.sh
# 可选 MySQL + Nacos:
LOCAL_DEPLOY_FULL=1 ./scripts/local-deploy.sh
# 或
docker compose --profile full up -d --build
```

## 表结构变更流程

1. 修改或新增 `infra/database/betogo/00N_*.sql`  
2. 本地：`./scripts/apply-betogo-schema.sh`  
3. 生产：`CTR=podman ./scripts/apply-betogo-schema.sh` 或重新 `remote-deploy.sh`

## 平台库（包网多租户）

```bash
# 只跑迁移，不构建不重启（平台库 + 租户库）
DEPLOY_HOST=... bash deploy/single-node/deploy-fast.sh db
```

平台库 `betogo_platform` 与租户库分属两套迁移体系，详见 `infra/database/platform/README.md`。

## 租户自带域名的证书自动签发（P1-4）

平台子域名 `<code>.<平台根域名>` 由泛域名证书覆盖，**开站即可用，不需要做任何事**。
客户自带域名要单独签，由宿主机上的定时任务完成：

```bash
# 一次性安装（在服务器上）
apt install -y certbot
mkdir -p /www/wwwroot/acme-challenge
cp deploy/single-node/betogo-cert.{service,timer} /etc/systemd/system/
# 改 betogo-cert.service 里的 ACME_EMAIL / SERVER_PUBLIC_IP
systemctl daemon-reload && systemctl enable --now betogo-cert.timer

# 手动跑一次看看会做什么（不改任何东西）
bash deploy/single-node/issue-tenant-certs.sh --dry-run
```

- 客户把 A 记录指过来后，**最多一小时**自动拿到证书并生成 nginx vhost
- DNS 还没指过来就跳过，不去撞 Let's Encrypt 的失败限流
- 续期交给 certbot 自带的 timer；本脚本只管首签与 vhost 补齐
- 平台控制台「租户详情 → 域名」有「自动签发」开关：证书托管在 Cloudflare 等外部时关掉它，
  平台就不会去动那个域名的证书
- **签发不做在 bff-node 里**：容器碰不到宿主机的 nginx 与 certbot，
  后台放一个「签发」按钮只会是个永远失败的按钮

## 两条踩过的坑（改脚本前先看）

1. **容器 `exec` 查询不要加 `-i`**。`podman/docker exec -i` 会抢占 stdin；
   脚本若通过 `ssh "bash -s" <<'REMOTE'` 喂入，`-i` 会把 heredoc 剩余内容全部吞掉，
   表现为"命令静默不执行"且无报错。只有显式 `< file` 灌数据时才加 `-i`。
2. **脚本运行期间绝对不要编辑它**。bash 按偏移量增量读取脚本文件，
   运行中修改会导致解析错位，出现语法报错甚至执行到错误的分支（曾误重启 core-node）。
   要改先等它跑完。
