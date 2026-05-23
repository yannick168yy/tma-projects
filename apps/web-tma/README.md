# web-tma

Telegram Mini App 客户端（Vue 3 + Vite + Tailwind CSS 4）。

## 设计来源

静态首页对齐 Figma Make：[功能介绍](https://www.figma.com/make/yFUMmXGuVIeENFROqe7Y1d/%E5%8A%9F%E8%83%BD%E4%BB%8B%E7%BB%8D)（`App.homepage-final.tsx` → Vue 移植）。

## 开发

```bash
cd apps/web-tma
npm install
npm run dev
```

浏览器打开 http://localhost:5173 。建议用 DevTools 手机模式（宽 390–430px）预览。

## 已实现（静态）

- TARSIER WIN 顶栏、钱包下拉、Top up
- 分类快捷卡、Banner 轮播、游戏 Tab
- Game History、Recent Wins 跑马灯
- Popular Games 网格、E-Games、Live Games、Providers
- 底栏导航、客服条

## 待接（后续）

- Telegram WebApp SDK、`initData` 登录
- BFF API、Pinia 状态
- 游戏启动、路由子页
