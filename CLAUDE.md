# Claude Code 行为准则（本项目）

## 语言
- **所有对话、解释、注释、commit message 均使用中文**

## 部署
- 每次代码改完必须**自动 commit + 部署**到阿里云测试环境（无需用户再提醒）；**`git push` 等用户通知后再执行**
- 服务器 IP：`47.84.34.139`
- SSH 密钥：`~/Downloads/yannick.pem`
- 项目路径：`/root/workspace/tma-projects`
- 部署命令（在本地项目根目录执行）：
  ```bash
  DEPLOY_HOST=root@47.84.34.139 \
  DEPLOY_DIR=/root/workspace/tma-projects \
  SSH_IDENTITY_FILE=~/Downloads/yannick.pem \
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
- 新迁移文件命名：`infra/database/betogo/00N_描述.sql`
- 迁移脚本会检查 `bg_<描述>` 表是否已存在来决定是否跳过
- ALTER TABLE 操作必须加幂等判断（IF NOT EXISTS 或先 SELECT information_schema）

## 管理后台角色
- `super_admin`：最高权限，可管理 op_password、其他管理员
- `finance` / `ops` / `support`：普通管理员

## 重要接口
- 操作密码管理：`GET/POST /admin/settings/op-password`（super_admin 专用）
- 余额调整：`POST /admin/users/:id/adjust-balance`（需传 `opPassword`）
