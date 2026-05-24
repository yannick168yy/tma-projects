# web-tma — BetoGo 客户端

Telegram Mini App 游戏客户端（Vue 3 + Vite + Tailwind CSS 4）。

## 本地运行（Docker Only）

在**仓库根目录**执行：

```bash
docker compose up -d --build web-tma
```

浏览器打开 http://localhost:8080（`WEB_TMA_PORT`，默认 8080）。

改完 Vue/CSS/组件后：

```bash
docker compose up -d --build web-tma
```

> 不在本机运行 `npm run dev`。`npm run build` 仅在 Docker 镜像构建阶段执行（见 `Dockerfile`）。

## 设计来源

静态首页对齐 Figma Make：[功能介绍](https://www.figma.com/make/yFUMmXGuVIeENFROqe7Y1d/%E5%8A%9F%E8%83%BD%E4%BB%8B%E7%BB%8D)（`App.homepage-final.tsx` → Vue 移植）。

## 已实现（静态 UI）

- **首页**：分类快捷卡、Banner、游戏 Tab、历史/热门/直播/厂商
- **活动页**：试玩官 / 邀请 / 首充
- **Bingo / Perya**、**菜单**、**个人中心**、**钱包弹窗**、**全局搜索**
- 底栏：Cashier · Bingo · Bonuses · Casino · Menu

## 待接

- Telegram WebApp SDK、`initData` 登录
- BFF API、Pinia 状态
- 游戏启动、路由子页
