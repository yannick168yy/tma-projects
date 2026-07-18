# Codex 项目执行规则

本文件是 Codex 在本仓库工作的优先项目规则。开始任何代码任务前，先读取本文件。`CLAUDE.md` 中的规则已同步到本文件；如两者冲突，以用户最新指令和本文件更具体的规则为准。

## 语言

- 所有对话、解释、代码注释和 commit message 使用中文。

## 🔴 生产保护铁律（2026-07-18 用户确立，最高优先级，不可违反）

1. **自动部署只限阿里云测试环境**（`47.84.34.139` / www.188facai.com）。功能改完自动 commit + 部署测试即可。
2. **生产 AWS 的部署，必须用户明确授权后才执行** —— 绝不自动部署生产。生产 = EC2 `13.213.107.231` / betogo.games / admin.betogo.games，SSH 用户 `ubuntu`，密钥 `/Users/yannicky/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem`，项目路径 `/opt/tma-projects`，容器 rootful（`sudo podman`）。
3. **生产 AWS 的数据（MySQL / 文件）修改或删除，必须用户逐次明确授权** —— 未获授权时对生产数据只读，绝不改删。

## 固定交付流程

- 每次代码改完自动 commit + 部署到**阿里云测试环境**，无需用户再提醒。**生产 AWS 不自动部署，必须等用户授权。**
- 不要执行 `git push`，除非用户明确通知。
- 不要本地启动 dev server，除非用户明确要求。
- 修改代码前先确认相关文件和现有模式，避免只按猜测改。

代码改完后必须自动完成：

1. 运行对应项目的 build / typecheck。
2. 执行 `git diff --check`。
3. 只暂存本次任务相关文件。
4. 使用中文 commit message 提交。
5. 执行阿里云测试环境部署。
6. 最后回复用户：改了什么、commit 结果、部署结果、验证结果。

如果当前执行环境导致 commit 失败，例如 `.git` 目录只读、无法创建 `.git/index.lock`，必须明确说明 commit 未完成和失败原因，然后继续完成可执行的 build 与部署。

## 阿里云部署

- 服务器 IP：`47.84.34.139`
- SSH 密钥：`/Users/yannicky/TMA_FILES/亚马逊云-阿里云/aliyun.pem`
- 项目路径：`/root/workspace/tma-projects`

### 默认：Fast 部署

纯代码改动、无新增 npm 依赖时，默认使用 fast 部署：

```bash
DEPLOY_HOST=root@47.84.34.139 \
DEPLOY_DIR=/root/workspace/tma-projects \
SSH_IDENTITY_FILE=/Users/yannicky/TMA_FILES/亚马逊云-阿里云/aliyun.pem \
SSH_OPTS="-o StrictHostKeyChecking=no" \
bash deploy/single-node/deploy-fast.sh <target>
```

`<target>` 按改动模块选择：

- `web-tma`：客户端 Telegram Mini App
- `web-admin`：后台管理
- `bff-node`：BFF API
- `core-node`：核心服务
- `all`：多模块同时变更

### 完整部署

有新 npm 依赖、Dockerfile 变更或首次部署时，使用完整部署：

```bash
DEPLOY_HOST=root@47.84.34.139 \
DEPLOY_DIR=/root/workspace/tma-projects \
SSH_IDENTITY_FILE=/Users/yannicky/TMA_FILES/亚马逊云-阿里云/aliyun.pem \
SSH_OPTS="-o StrictHostKeyChecking=no" \
bash deploy/single-node/deploy-web-tma.sh
```

## 项目结构

- `apps/bff-node`：Koa + TypeScript 后端 API，端口 3000
- `apps/web-tma`：Telegram Mini App 前端，端口 8080
- `apps/web-admin`：后台管理系统，端口 8085
- `apps/core-node`：Fastify 核心服务，端口 4000
- `infra/database/betogo/`：数据库迁移文件，按 `001_xxx.sql` 序号顺序执行
- 存储层：MySQL（`BFF_STORAGE=mysql`）+ Redis（session）

## 技术栈

- Node.js 20 / TypeScript 5.7
- Koa 2 + `@koa/router` + `koa-bodyparser`
- MySQL 8 (`mysql2`) + Redis 7 (`ioredis`)
- 容器运行时：Podman（服务器上兼容 Docker CLI）

## 编码规范

- 不写无意义注释，只在 WHY 不显而易见时才写。
- 不提前抽象，三行重复好过过度封装。
- 不加不需要的错误处理和 fallback。
- 类型检查通过后再提交。
- 不添加用户没要求的功能。
- 一次性代码不创建抽象层。
- 不添加未被要求的灵活性或可配置性。
- 不为不可能发生的场景写错误处理。
- 修改现有代码时，不顺便改进相邻代码、注释或格式。
- 不重构没有坏掉的东西。
- 匹配现有风格，即使你会换一种写法。
- 发现无关死代码，提一下，不要删。
- 当改动产生孤儿代码时，只移除本次改动导致的无用 import、变量、函数。
- 每一行改动都应能直接追溯到用户的请求。

## web-tma 特别规则

- 客户端改动完成后部署目标使用 `web-tma`。
- 不要启动 `npm run dev` 或 Vite 本地服务，除非用户明确要求。
- 前台文案优先面向菲律宾用户，避免直接使用容易让用户联想到传销的词：
  - 避免：`三级分销`、`downline`、`passive income`、`pyramid`、`MLM`、`3-Level Distribution`
  - 推荐：`3-Circle Rewards`、`Circle Rewards`、`Share Once. Earn from 3 Circles`

## 数据库迁移规则

### 幂等性

- 新迁移文件命名：`infra/database/betogo/00N_描述.sql`
- 部署脚本通过 `schema_migrations` 表记录已执行版本，每个文件只执行一次。
- 新文件直接写即可，DDL 操作无需额外幂等处理，执行成功后版本号入库，不会重跑。

### 禁止写入迁移文件的语句

无论是否加注释说明“仅测试”，迁移文件中都禁止写：

- `TRUNCATE TABLE <任何业务表>`
- `DELETE FROM <任何业务表>`（不带精确 WHERE 条件的）
- `DROP TABLE <任何业务表>`（不带 `IF NOT EXISTS` 且无幂等保护的）
- `UPDATE <表> SET <字段>=0`（清零全表数据的）

原因：这些语句每次部署都会执行，会静默清空线上数据。历史上 `037`、`031`、`044` 均因此造成投注记录、钱包余额、佣金数据被反复清空。

### 一次性清理数据的正确做法

需要清理数据时，不写在迁移文件里，改用以下方式之一：

1. 手动在服务器执行 SQL（一次性操作）。
2. 写独立脚本，例如 `scripts/reset-xxx.sql`，明确标注“手动执行，不自动部署”。
3. 如果必须放在迁移文件里，用 `information_schema` 检查是否首次迁移，确保只在从未迁移过的库上执行一次。

## 管理后台角色

- `super_admin`：最高权限，可管理 `op_password` 和其他管理员。
- `finance` / `ops` / `support`：普通管理员。

## 重要接口

- 操作密码管理：`GET/POST /admin/settings/op-password`，`super_admin` 专用。
- 余额调整：`POST /admin/users/:id/adjust-balance`，需传 `opPassword`。

## AI 编码行为准则

### 编码前先思考

- 不假设。
- 不隐藏困惑。
- 呈现权衡。
- 动手前明确说明假设。
- 不确定时先问。
- 存在多种解释时，全部呈现，不要默默选一个。
- 发现更简单的方法时，说出来，必要时推回。
- 有不清楚的地方，停下来，指出来，问清楚。

### 简洁优先

- 最少代码解决问题。
- 不做推测性开发。
- 200 行能写成 50 行的，重写。
- 自问“资深工程师会觉得这过度复杂吗？”，如果是，简化。

### 精准修改

- 只碰必须碰的。
- 只清理自己造成的混乱。
- 不回滚或覆盖用户已有改动，除非用户明确要求。

### 目标驱动执行

- 定义成功标准。
- 循环验证直到达成。
- 多步任务时说明计划和验证方式。
- 模糊标准需要先澄清，不要靠猜。

这些准则有效的标志：diff 中不必要的改动更少；因过度复杂导致的重写更少；澄清问题在实现前提出，而不是出错后补问。
