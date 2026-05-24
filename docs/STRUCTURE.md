# 项目目录结构（标准脚手架）

> 原则：Monorepo 逻辑分治；每个 `apps/*` 未来可整目录拷贝为独立 Git 仓库 / 微服务，无需改核心业务代码。

```
tma-projects/
│
├── README.md
├── docker-compose.yml              # 本地 MySQL / Redis / RabbitMQ
├── .env.example
├── .gitignore
│
├── docs/
│   ├── STRUCTURE.md                # 本文件
│   └── architecture/
│       ├── 01-business-architecture.md
│       ├── 02-technical-architecture.md
│       └── 03-data-flow-jingcai-callback.md
│
├── apps/
│   │
│   ├── web-tma/                    # 【前端】Vue 3 + Vite + Tailwind + Pinia
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── api/                # BFF HTTP 客户端
│   │   │   ├── assets/
│   │   │   ├── components/
│   │   │   ├── composables/        # useTelegramWebApp 等
│   │   │   ├── layouts/
│   │   │   ├── router/
│   │   │   ├── stores/             # Pinia modules
│   │   │   ├── styles/
│   │   │   ├── types/
│   │   │   ├── utils/
│   │   │   ├── views/
│   │   │   ├── App.vue
│   │   │   └── main.ts
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── tsconfig.json
│   │   └── .env.example
│   │
│   ├── bff-node/                   # 【BFF】Node.js (Koa)
│   │   ├── src/
│   │   │   ├── app.ts              # 应用入口
│   │   │   ├── config/             # 配置加载（env）
│   │   │   ├── middleware/
│   │   │   │   ├── requestId.ts
│   │   │   │   ├── rateLimit.ts
│   │   │   │   ├── auth.ts         # Redis Session 校验
│   │   │   │   └── errorHandler.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.routes.ts  # initData 登录
│   │   │   │   ├── user.routes.ts
│   │   │   │   ├── game.routes.ts
│   │   │   │   └── affiliate.routes.ts
│   │   │   ├── controllers/
│   │   │   ├── services/           # 业务编排（无状态）
│   │   │   ├── clients/
│   │   │   │   ├── core-java.client.ts
│   │   │   │   └── redis.client.ts
│   │   │   ├── validators/         # initData / DTO 校验
│   │   │   └── types/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── .env.example
│   │
│   └── core-java/                  # 【核心】Spring Boot 3.x
│       ├── pom.xml
│       └── src/
│           ├── main/
│           │   ├── java/com/tma/core/
│           │   │   ├── TmaCoreApplication.java
│           │   │   │
│           │   │   ├── common/
│           │   │   │   ├── config/         # Redis, MySQL, AMQP
│           │   │   │   ├── exception/
│           │   │   │   ├── web/            # 全局异常、TraceId
│           │   │   │   └── util/
│           │   │   │
│           │   │   ├── mq/                 # ★ MQ 透明层
│           │   │   │   ├── MessageQueueService.java
│           │   │   │   ├── WalletLedgerMessage.java
│           │   │   │   └── rabbit/
│           │   │   │       ├── RabbitMQMessageQueueService.java
│           │   │   │       └── RabbitMQConfig.java
│           │   │   │
│           │   │   ├── wallet/             # ★ 钱包领域（未来 wallet-service）
│           │   │   │   ├── domain/
│           │   │   │   ├── service/
│           │   │   │   │   └── WalletLedgerService.java
│           │   │   │   ├── repository/
│           │   │   │   ├── entity/        # Wallet, WalletLog, BetOrder
│           │   │   │   └── lua/             # balance_update.lua
│           │   │   │
│           │   │   ├── callback/           # ★ 聚合商 HTTP 入口（未来 callback-service）
│           │   │   │   ├── controller/
│           │   │   │   │   └── AggregatorCallbackController.java
│           │   │   │   └── service/
│           │   │   │       └── CallbackIngressService.java
│           │   │   │
│           │   │   ├── consumer/           # ★ AMQP 消费者
│           │   │   │   └── WalletLedgerConsumer.java
│           │   │   │
│           │   │   └── integration/        # ★ 外部集成（可独立 adapter/scraper 服务）
│           │   │       ├── aggregator/
│           │   │       │   ├── AggregatorClient.java
│           │   │       │   └── impl/
│           │   │       └── scraper/
│           │   │           ├── ScraperJob.java
│           │   │           └── impl/
│           │   │
│           │   └── resources/
│           │       ├── application.yml
│           │       ├── application-local.yml
│           │       ├── lua/
│           │       │   └── balance_update.lua
│           │       └── db/migration/       # Flyway（后续）
│           │
│           └── test/
│               └── java/com/tma/core/
│
├── packages/                       # 【可选】跨端共享契约
│   └── api-contracts/
│       ├── openapi/
│       │   ├── bff-v1.yaml
│       │   └── core-internal-v1.yaml
│       └── README.md
│
├── infra/
│   ├── docker/
│   │   ├── mysql/init/
│   │   └── rabbitmq/
│   └── scripts/
│       ├── dev-up.sh               # docker compose up
│       └── dev-down.sh
│
└── deploy/
    ├── single-node/                # 当前阶段：单机 compose 叠加应用
    │   └── README.md
    └── k8s/                        # 未来：按服务拆分 manifest（占位）
        └── README.md
```

## 模块边界速查

| 目录 | 可拆服务名 | 禁止依赖 |
|------|------------|----------|
| `apps/web-tma` | — | 不得直连 Java Core |
| `apps/bff-node` | `tg-gateway` | 不得写账变、不得直连 MySQL 账变表 |
| `core-java/wallet` | `wallet-ledger` | 不得依赖 `callback` 控制器 |
| `core-java/callback` | `aggregator-callback` | 不得直接写 MySQL（只入队） |
| `core-java/integration` | `aggregator-adapter` | 不得依赖 wallet 实现 |

## 端口约定（开发）

| 服务 | 端口 |
|------|------|
| web-tma (Docker Nginx) | 5173 |
| bff-node | 3000 |
| core-java | 8080 |
| MySQL | 3306 |
| Redis | 6379 |
| RabbitMQ AMQP | 5672 |
| RabbitMQ Management | 15672 |
