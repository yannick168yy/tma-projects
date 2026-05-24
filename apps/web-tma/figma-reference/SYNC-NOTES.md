# Figma 反向同步说明（2026-05-24）

将 Vue 生产端 `apps/web-tma/src` 凌晨改动同步到 Figma 的两条路径：

## 1. Figma Make（代码原型）

**文件**：[功能介绍 · Figma Make](https://www.figma.com/make/yFUMmXGuVIeENFROqe7Y1d/%E5%8A%9F%E8%83%BD%E4%BB%8B%E7%BB%8D)（`fileKey: yFUMmXGuVIeENFROqe7Y1d`）

本地镜像：`figma-reference/App.tsx`、`theme.css`

### 已同步内容

| 区域 | 变更 |
|------|------|
| App 外壳 | `h-dvh`、`app-frame`、`app-safe-header` / `app-safe-nav` |
| 主内容 | `main` + `.page-scroll` 滚动链 |
| 搜索 / 钱包 Bottom Sheet | `data-bottom-sheet`、`data-bottom-sheet-backdrop`、`data-sheet-scroll` |
| 样式 | `theme.css` 追加 `app-shell` 规则（拖拽 CSS 变量、pan-y 滚动） |

### 手势逻辑（仅 Vue 实现）

拖拽交互在 `src/composables/useBottomSheetDrag.ts`（scroll-first + 原生惯性）。Make 侧为**结构与标注同步**；若要在 Make 预览里可拖，需将 composable 移植进 `App.tsx` 或继续在 Vue 端验证。

**手动更新 Make**：在 Figma Make 中打开项目，将 `figma-reference/App.tsx` 与 `theme.css` 中对应段落合并到 `src/app/App.tsx` 与样式文件（MCP 目前仅支持从 Make **读取**，不支持直接写入云端 Make 源码）。

## 2. Figma Design（视觉稿）

使用 **Code to canvas**（`generate_figma_design`）从本地 `http://127.0.0.1:5173/` 捕获：

- 首页（Casino）
- 搜索 Bottom Sheet 打开
- 钱包 Bottom Sheet 打开
- 个人中心（底栏仍显示）

捕获结果已写入 Figma Design 文件：

**[TMA web-tma sync 2026-05-24](https://www.figma.com/design/QowuD3y2E80dEylQUJb7lV)**

| 画板 | 来源 |
|------|------|
| 首页 Casino | `http://127.0.0.1:5173/` |
| 搜索 Bottom Sheet | `?figma=search` |
| 钱包 Bottom Sheet | `?figma=wallet` |

本地开发可用 `?figma=search|wallet|profile` 打开对应状态以便再次捕获（仅 `import.meta.env.DEV`）。

## 对照提交

Vue 端参考提交：`0752a2a`（bottom sheet scroll-first + 惯性）
