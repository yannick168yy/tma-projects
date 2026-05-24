# single-node 部署

## 默认：最小栈（2C2G 推荐）

| 容器 | 作用 |
|------|------|
| `tma-web-tma` | 静态前端 |
| `tma-bff-node` | API；`BFF_STORAGE=redis` 时用户/钱包在 Redis |
| `tma-redis` | Session + 业务缓存 |

**不启动**：Nacos、Podman MySQL、RabbitMQ、core-java（省约 1.1GiB 内存上限）。

```bash
# Podman（阿里云常见）
bash deploy/single-node/podman-prod-minimal.sh

# 或 Compose
docker compose -f deploy/single-node/docker-compose.prod.yml up -d --build
```

配置：服务器 `/opt/tma-projects/.env`（`TELEGRAM_BOT_TOKEN`、`GOOGLE_*` 等），**无需 Nacos**。

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

## 后续接宝塔 MySQL

1. 在宝塔为 `betogo@10.88.%` 授权  
2. BFF 增加 `MYSQL_HOST=host.containers.internal`、`BFF_STORAGE=mysql`  
3. **仍不必** 启动 Podman MySQL / Nacos
