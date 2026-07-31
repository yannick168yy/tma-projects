# 前后台 E2E 冒烟测试

脚本：`scripts/e2e-smoke.mjs`

## 运行方式

```bash
node scripts/e2e-smoke.mjs
```

默认目标：

- 通过 SSH 隧道连接阿里云测试环境：`root@47.84.34.139`
- SSH 密钥：`/Volumes/MacAPFS/TMA_FILES/aliyun.pem`
- 本地转发：`127.0.0.1:18080 -> 127.0.0.1:8080`（web-tma）
- 本地转发：`127.0.0.1:18085 -> 127.0.0.1:8085`（web-admin）

可覆盖：

```bash
E2E_WEB_TMA_BASE_URL=http://127.0.0.1:8080 \
E2E_WEB_ADMIN_BASE_URL=http://127.0.0.1:8085 \
node scripts/e2e-smoke.mjs
```

只跑某类场景：

```bash
E2E_TARGET=web-admin node scripts/e2e-smoke.mjs
E2E_TARGET=web-tma-mobile-wallet node scripts/e2e-smoke.mjs
```

## 产物

默认输出到：

```text
artifacts/e2e-smoke/<timestamp>/
```

每个场景会生成：

- `*.png`：成功截图
- `*.failed.png`：失败时截图
- `*.failed.html`：失败时页面 HTML
- `*.error.txt`：失败堆栈
- `*.console.log`：浏览器 console
- `*.network.log`：被 mock 的 API 请求和网络失败记录

## 覆盖范围

`web-tma` 移动端：

- 启动页/首页
- 登录态恢复
- 钱包弹层
- KYC 页面
- 活动页
- 转盘页
- 客服弹层
- 游戏大厅

`web-admin` 桌面端：

- 登录页
- Dashboard
- 用户详情
- 提现审批
- KYC 审核
- 游戏管理
- 活动配置
- 支付渠道

## 实现说明

脚本不依赖 Playwright，也不新增 npm 包。它使用本机 Chrome/Chromium 的 Chrome DevTools Protocol：

1. 启动 headless Chrome。
2. 访问前后台测试环境。
3. 拦截 `/api/v1/*` 请求并返回稳定 mock 数据。
4. 断言关键文案/结构存在。
5. 生成桌面和移动端截图。

这样测试不会依赖真实 Telegram、真实管理员账号、真实支付/KYC/游戏数据，也不会污染测试服数据。

## 失败诊断

先看 `*.error.txt`，再看同名 `*.failed.png` 和 `*.failed.html`。如果是入口文案变更导致点击失败，通常会在错误中看到“未找到可点击入口”。如果是页面接口新增字段导致渲染失败，优先查看 `*.console.log`。
