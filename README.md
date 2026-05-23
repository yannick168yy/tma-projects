# TMA Betting Platform — Monorepo

Telegram Mini App（博彩聚合）MVP 单体部署、逻辑解耦的可扩展架构。

## 仓库结构

```
apps/web-tma      → Vue 3 前端（Telegram WebApp SDK）
apps/bff-node     → Node.js BFF（initData 校验、用户/分销）
apps/core-java    → Spring Boot 核心（账变、聚合商回调、MQ 消费）
infra/docker      → 本地基础设施与初始化脚本
docs/             → 业务与技术架构文档
deploy/           → 单机 / 未来 K8s 部署模板
```

## 快速开始

**基础设施**

```bash
cp .env.example .env
docker compose up -d
```

**客户端静态首页（Figma Make 设计稿）**

```bash
cd apps/web-tma && npm install && npm run dev
```

浏览器打开 http://localhost:5173（建议手机宽度 430px 预览）。

详见 [docs/architecture/02-technical-architecture.md](docs/architecture/02-technical-architecture.md)。

## 研发铁律摘要

- **无状态**：Node / Java 进程内不存用户态，Session 与热点数据走 Redis。
- **模块隔离**：抓取、回调、钱包分 package，面向接口编程。
- **MQ 透明替换**：仅通过 `MessageQueueService` 收发消息。
- **回调削峰**：Redis 幂等 → RabbitMQ → 立即 HTTP 200 → 异步账变落库。
