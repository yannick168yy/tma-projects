# BetoGo MySQL 表结构（本地 ⇄ 阿里云 同源）

| 文件 | 说明 |
|------|------|
| `001_schema.sql` | v1 全量建表（用户、钱包、充提、KYC、活动、竞彩预留） |

**约定**：DDL 只改本目录；本地与服务器均通过 `scripts/apply-betogo-schema.sh` 应用，保证结构一致。

## 一键同步

```bash
# 本地 Docker（tma-mysql）
./scripts/apply-betogo-schema.sh

# 阿里云 Podman（部署后自动执行；可手动）
CTR=podman ./scripts/apply-betogo-schema.sh
```

脚本逻辑：

1. 创建库 `betogo`、用户 `betogo@'%'`
2. 若库内无表 → 执行 `001_schema.sql`
3. 若已有表 → 跳过（避免破坏数据；增量变更请新增 `002_*.sql` 并扩展脚本）

## 手动执行

```bash
mysql -h127.0.0.1 -P13306 -uroot -p < deploy/mysql/create-betogo-database.sql   # 仅宿主机直连时
mysql -h127.0.0.1 -P13306 -ubetogo -p betogo < infra/database/betogo/001_schema.sql
```

金额字段统一 **PHP 分（BIGINT）**。
