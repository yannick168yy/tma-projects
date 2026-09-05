# overlay 租户的发版与回归流程（P3-4）

overlay（`apps/web-tma/src/tenants/<code>/`）是定制化的最后一层，代价是**被覆盖的文件
不会自动跟上主干改动**，包括 bug 修复。这份文档就是为了让这个代价可控。

## 谁在用 overlay

```bash
ls apps/web-tma/src/tenants/            # 目录名即租户代号（_example 是示例，不对应真实租户）
TENANT=<code> npm run build:tenant      # 构建日志会打印这次覆盖了哪几个模块
```

构建日志里那行 `[tenant-overlay] <code> 覆盖 N 个模块：a, b, c` 是唯一可靠的清单 ——
比翻目录准，因为文件放错位置时它不会出现在清单里（覆盖悄悄失效）。

## 主干改动时的回归判断

改完主干、提交前跑一次：

```bash
# 列出本次改动的文件里，哪些被某个租户覆盖过
git diff --name-only origin/main... | sed 's|^apps/web-tma/src/||' | while read -r f; do
  find apps/web-tma/src/tenants -path "*/$f" 2>/dev/null
done | sort -u
```

有输出就意味着：**这些租户拿不到本次改动**。按下面处理，不要默认「他们不需要」：

| 本次改动性质 | 处理 |
|---|---|
| 修 bug / 补安全 | 必须同步进 overlay 文件（或让客户回到主干实现） |
| 加新功能 | 与商务确认这家要不要；不要则记进 overlay 目录的 NOTES.md |
| 纯重构 / 改样式 | 至少构建一次该租户产物，确认不报错 |
| 改了被覆盖文件的**依赖签名**（props / 导出名） | 一定要跟：overlay 会编译失败或运行时白屏 |

## 发版顺序

1. 主干：`bash deploy/single-node/deploy-fast.sh web-tma`
2. 每个 overlay 租户：`TENANT=<code> bash deploy/single-node/deploy-fast.sh web-tma-tenant`
3. 两者产物目录与 `base` 前缀都是分开的（`/` 与 `/t/<code>/`）——
   **不要**把 overlay 产物同步到主干站点目录：assets 文件名哈希会撞，
   撞了之后主干页面会加载到 overlay 的 chunk，表现是随机白屏且很难复现

## 收缩 overlay

overlay 越少越好。定期检查每个 overlay 文件与主干同名文件的差异：

```bash
diff apps/web-tma/src/tenants/<code>/views/Foo.tsx apps/web-tma/src/views/Foo.tsx
```

差异已经能用 L1（品牌/文案/开关）或 L2（首页布局/底部导航）表达时，删掉 overlay 文件，
让这家回到主干 —— 这是唯一能真正降低长期维护成本的动作。
