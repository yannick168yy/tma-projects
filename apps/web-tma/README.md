# web-tma

Telegram Mini App 游戏客户端（竞彩聚合，Vue 3 + Vite + Tailwind CSS 4）。

## 设计来源

静态首页对齐 Figma Make：[功能介绍](https://www.figma.com/make/yFUMmXGuVIeENFROqe7Y1d/%E5%8A%9F%E8%83%BD%E4%BB%8B%E7%BB%8D)（`App.homepage-final.tsx` → Vue 移植）。

## 开发

```bash
cd apps/web-tma
npm install
npm run dev
```

浏览器打开 http://localhost:5173。建议用 DevTools 手机模式（宽 390–430px）预览。

## 已实现（静态，对齐 Figma Make 最新稿）

- **首页**：分类快捷卡（活动导向）、Banner、游戏 Tab、历史/热门/直播/厂商
- **活动页**：试玩官 / 邀请 / 首充三大活动卡片
- **Bingo / Perya**：嘉年华风格专区与 Pinoy 游戏网格
- **菜单**：游戏分类浏览、语言切换、客服入口
- **个人中心**：资料、联系方式、政策链接
- **钱包弹窗**：法币/加密货币充提、交易历史
- **全局搜索**：游戏搜索浮层
- 底栏：Cashier · Bingo · Bonuses · Casino · Menu

## 待接（后续）

- Telegram WebApp SDK、`initData` 登录
- BFF API、Pinia 状态
- 游戏启动、路由子页
