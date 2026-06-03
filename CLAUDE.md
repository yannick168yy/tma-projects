# Claude Code 行为准则（本项目）

## 语言
- **所有对话、解释、注释、commit message 均使用中文**

## 部署
- 每次代码改完必须**自动 commit + 部署**到阿里云测试环境（无需用户再提醒）；**`git push` 等用户通知后再执行**
- 服务器 IP：`47.84.34.139`
- SSH 密钥：`~/Downloads/yannick.pem`
- 项目路径：`/root/workspace/tma-projects`

### 纯代码改动（无新 npm 依赖）→ Fast 部署，约 20-40 秒
```bash
DEPLOY_HOST=root@47.84.34.139 \
DEPLOY_DIR=/root/workspace/tma-projects \
SSH_IDENTITY_FILE=~/Downloads/yannick.pem \
SSH_OPTS="-o StrictHostKeyChecking=no" \
bash deploy/single-node/deploy-fast.sh <目标>
# 目标：web-tma | bff-node | core-node | all
```

### 有新 npm 依赖 / Dockerfile 变更 / 首次部署 → 完整部署，约 3-5 分钟
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

---

## AI 编码行为准则（Karpathy Guidelines）

减少 LLM 常见编码错误的行为指南。**权衡：这些原则偏向谨慎而非速度，对琐碎任务自行判断。**

### 1. 编码前先思考

**不假设。不隐藏困惑。呈现权衡。**

动手前：
- 明确说明假设。不确定时，先问。
- 存在多种解释时，全部呈现——不要默默选一个。
- 发现更简单的方法时，说出来，必要时推回。
- 有不清楚的地方，停下来，指出来，问清楚。

### 2. 简洁优先

**最少代码解决问题。不做推测性开发。**

- 不添加用户没要求的功能。
- 一次性代码不创建抽象层。
- 不添加未被要求的"灵活性"或"可配置性"。
- 不为不可能发生的场景写错误处理。
- 200 行能写成 50 行的，重写。

自问："资深工程师会觉得这过度复杂吗？" 如果是，简化。

### 3. 精准修改

**只碰必须碰的。只清理自己造成的混乱。**

修改现有代码时：
- 不"顺便改进"相邻代码、注释或格式。
- 不重构没有坏掉的东西。
- 匹配现有风格，即使你会换一种写法。
- 发现无关死代码，提一下——不要删。

当你的改动产生孤儿代码时：
- 移除**你的改动**导致的无用 import/变量/函数。
- 不移除原本就存在的死代码，除非被要求。

检验标准：**每一行改动都应能直接追溯到用户的请求。**

### 4. 目标驱动执行

**定义成功标准。循环验证直到达成。**

将任务转化为可验证的目标：
- "添加验证" → "为无效输入写测试，让测试通过"
- "修复 bug" → "写一个能复现 bug 的测试，让它通过"
- "重构 X" → "确保重构前后测试都通过"

多步任务时，说明计划：
```
1. [步骤] → 验证：[检查项]
2. [步骤] → 验证：[检查项]
3. [步骤] → 验证：[检查项]
```

明确的成功标准让 AI 能独立迭代。模糊标准（"让它能用"）需要反复澄清。

---

**这些准则有效的标志：** diff 中不必要的改动更少；因过度复杂导致的重写更少；澄清问题在实现前提出，而不是出错后补问。
