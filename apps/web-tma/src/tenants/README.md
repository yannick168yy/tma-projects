# L3 overlay：按租户覆盖组件（P3-4）

`src/tenants/<租户代号>/` 下放**与主干同路径同名**的文件即可覆盖，例如：

```
src/views/HomeContent.tsx                 ← 主干
src/tenants/acme/views/HomeContent.tsx    ← acme 用这份
```

构建：

```bash
TENANT=acme npm run build       # 产物：dist-tenants/acme/，base = /t/acme/
npm run build                   # 主干产物：dist/，base = /
TENANT=acme npm run dev         # 本地起 overlay 版
```

只覆盖 `@/` 开头的内部引用；`node_modules` 与相对路径不参与解析改写，
避免同一模块出现两份实例。overlay 文件内部的相对 import 会先在 overlay 目录里找，
找不到自动回落主干同位置，所以拷一个文件过来改不需要把它的依赖一起拷。

## 什么该进 overlay，什么不该

先看能不能用更靠上的层解决 —— overlay 是最后一层：

| 需求 | 该用的层 |
|---|---|
| 换色/换 logo/换站名 | L1 品牌包（平台控制台 → 品牌） |
| 改文案 | L1 文案覆盖包 |
| 关掉某个玩法/入口 | L1 功能开关 |
| 首页区块顺序/数量/卡型 | L2 首页布局 |
| 底栏顺序/图标/去哪 | L2 底部导航 |
| 某个区块要长得完全不一样 | **L3 overlay**（覆盖单个区块组件） |
| 整页重做 | **L3 overlay**（覆盖该 view） |

## 代价（必须知道）

overlay 文件**不会自动跟上主干改动**。主干改了一个被某租户覆盖的文件，
那个租户不会拿到这次改动 —— 包括 bug 修复。所以：

- 覆盖粒度尽量小：覆盖一个区块组件而不是整个 `HomeContent.tsx`
- 每次主干改动涉及被覆盖的文件时，按 `docs/ops/tenant-overlay.md` 的清单回归对应租户
- 构建日志会打印这次覆盖了哪几个模块，覆盖悄悄失效时能看出来

`_example/` 是可运行的示例（`TENANT=_example npm run build` 能出产物），
不对应任何真实租户，也不要往里加业务逻辑。
