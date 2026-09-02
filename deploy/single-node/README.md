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

## 两条踩过的坑（改脚本前先看）

1. **容器 `exec` 查询不要加 `-i`**。`podman/docker exec -i` 会抢占 stdin；
   脚本若通过 `ssh "bash -s" <<'REMOTE'` 喂入，`-i` 会把 heredoc 剩余内容全部吞掉，
   表现为"命令静默不执行"且无报错。只有显式 `< file` 灌数据时才加 `-i`。
2. **脚本运行期间绝对不要编辑它**。bash 按偏移量增量读取脚本文件，
   运行中修改会导致解析错位，出现语法报错甚至执行到错误的分支（曾误重启 core-node）。
   要改先等它跑完。
