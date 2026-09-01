# Claude Code 行为准则（本项目）

## 语言
- **所有对话、解释、注释、commit message 均使用中文**

## 部署

### 🔴 生产保护铁律（2026-07-18 用户确立，最高优先级，任何 AI/agent 不可违反）
1. **自动部署只限阿里云测试环境**（`47.84.34.139` / www.188facai.com）。功能改完自动 commit + 部署**测试**即可。
2. **生产 AWS 的部署，必须用户明确授权后才执行** —— 绝不自动部署生产。
3. **生产 AWS 的数据（MySQL / 文件）修改或删除，必须用户逐次明确授权** —— 未获授权时对生产数据**只读**，绝不改删。

- 每次代码改完：自动 commit + 部署**阿里云测试**（无需再提醒）；**`git push` 与生产部署**都要等用户通知/授权后执行
- **阿里云测试**：IP `47.84.34.139`，SSH 密钥 `/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/aliyun.pem`，项目路径 `/root/workspace/tma-projects`，root 登录
- **生产 AWS（需授权）**：EC2 m8g.xlarge，IP `13.213.107.231`，域名 betogo.games / admin.betogo.games，SSH 用户 `ubuntu`，密钥 `/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem`，项目路径 `/opt/tma-projects`，容器 rootful（`sudo podman`）

### 默认使用：Fast 部署，约 20-40 秒（纯代码改动，无新 npm 依赖）
```bash
DEPLOY_HOST=root@47.84.34.139 \
DEPLOY_DIR=/root/workspace/tma-projects \
SSH_IDENTITY_FILE=/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/aliyun.pem \
SSH_OPTS="-o StrictHostKeyChecking=no" \
bash deploy/single-node/deploy-fast.sh <目标>
# 目标：web-tma | bff-node | core-node | all
```

### 有新 npm 依赖 / Dockerfile 变更 / 首次部署 → 完整部署，约 3-5 分钟
```bash
DEPLOY_HOST=root@47.84.34.139 \
DEPLOY_DIR=/root/workspace/tma-projects \
SSH_IDENTITY_FILE=/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/aliyun.pem \
SSH_OPTS="-o StrictHostKeyChecking=no" \
bash deploy/single-node/deploy-web-tma.sh
```

## 项目结构
- **bff-node**：Koa + TypeScript 后端 API，端口 3000
- **web-tma**：Telegram Mini App 前端，端口 8080
- **web-admin**：后台管理系统，端口 8085
- **core-node**：Fastify 核心服务，端口 4000
- 数据库迁移文件：`infra/database/betogo/`，按 `001_xxx.sql` 序号顺序执行
- 存储层：MySQL（`BFF_STORAGE=mysql`）+ Redis（session）

## 技术栈
- Node.js 20 / TypeScript 5.7
- Koa 2 + @koa/router + koa-bodyparser
- MySQL 8 (mysql2) + Redis 7 (ioredis)
- 容器运行时：Podman（服务器上兼容 Docker CLI）

## 编码规范
- 不写无意义注释，只在 WHY 不显而易见时才写
- 不提前抽象，三行重复好过过度封装
- 不加不需要的错误处理和 fallback
- 类型检查通过（`npm run typecheck`）后再提交

## 数据库迁移规则

### 幂等性
- 新迁移文件命名：`infra/database/betogo/00N_描述.sql`
- 部署脚本通过 `schema_migrations` 表记录已执行版本，**每个文件只执行一次**
- 新文件直接写即可，DDL 操作无需额外幂等处理（执行成功后版本号入库，不会重跑）

### 🚫 禁止在迁移文件中写以下语句（无论是否加注释说明"仅测试"）
- `TRUNCATE TABLE <任何业务表>`
- `DELETE FROM <任何业务表>`（不带精确 WHERE 条件的）
- `DROP TABLE <任何业务表>`（不带 `IF NOT EXISTS` 且无幂等保护的）
- `UPDATE <表> SET <字段>=0`（清零全表数据的）

> **原因**：这些语句每次部署都会执行，会静默清空线上数据。历史上 037/031/044 均因此造成投注记录、钱包余额、佣金数据被反复清空。

### 一次性清理数据的正确做法
需要清理数据时，**不写在迁移文件里**，改用以下方式之一：
1. 手动在服务器执行 SQL（一次性操作）
2. 写独立脚本（如 `scripts/reset-xxx.sql`），明确标注"手动执行，不自动部署"
3. 如果必须放在迁移文件里，用 `information_schema` 检查"是否首次迁移"，确保只在从未迁移过的库上执行一次

## 管理后台角色
- `super_admin`：最高权限，可管理 op_password、其他管理员
- `finance` / `ops` / `support`：普通管理员

## 重要接口
- 操作密码管理：`GET/POST /admin/settings/op-password`（super_admin 专用）
- 余额调整：`POST /admin/users/:id/adjust-balance`（需传 `opPassword`）

---

## AI 编码行为准则
- 编码遵循 `docs/coding-guidelines.md`（Karpathy Guidelines：编码前先思考 / 简洁优先 / 精准修改 / 目标驱动）。涉及非琐碎改动时先读该文件。

---
