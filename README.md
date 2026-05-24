# TMA 竞彩平台 — Monorepo

Telegram Mini App（竞彩聚合）MVP 单体部署、逻辑解耦的可扩展架构。

## 仓库结构

```
apps/web-tma      → Vue 3 前端（Telegram WebApp SDK）
apps/bff-node     → Node.js BFF（initData 校验、用户/活动）
apps/core-java    → Spring Boot 核心（账变、聚合商回调、MQ 消费）
infra/docker      → 本地基础设施与初始化脚本
docs/             → 业务与技术架构文档
deploy/           → 单机 / 未来 K8s 部署模板
```

## 快速开始（Docker Only）

**本仓库本地开发与联调统一在 Docker 中运行，不启动本机 Vite / Node / Java 进程。**

```bash
cp .env.example .env
docker compose up -d --build
```

| 服务 | 地址 |
|------|------|
| **BetoGo 客户端** | http://localhost:5173 |
| RabbitMQ 管理台 | http://localhost:15672（`tma` / `tma_dev`） |
| MySQL | `localhost:3306`（`tma` / `tma_dev`，库 `tma`） |
| Redis | `localhost:6379` |
| RabbitMQ AMQP | `localhost:5672` |

**改完前端后重建客户端：**

```bash
docker compose up -d --build web-tma
```

**停止全部：**

```bash
docker compose down
# 或 ./infra/scripts/dev-down.sh
```

后续 `bff-node`、`core-java` 接入后同样加入根目录 `docker compose`，一键 `up` 即可。

详见 [docs/architecture/02-technical-architecture.md](docs/architecture/02-technical-architecture.md)。

## 研发铁律摘要

- **Docker 本地优先**：基础设施与应用进程均在容器中运行。
- **无状态**：Node / Java 进程内不存用户态，Session 与热点数据走 Redis。
- **模块隔离**：抓取、回调、钱包分 package，面向接口编程。
- **MQ 透明替换**：仅通过 `MessageQueueService` 收发消息。
- **回调削峰**：Redis 幂等 → RabbitMQ → 立即 HTTP 200 → 异步账变落库。
