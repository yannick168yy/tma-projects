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
