# 平台库（betogo_platform）

包网多租户的"平台层"数据，与租户业务库完全分离。

## 与租户库的区别

| | 租户库 `betogo` / `betogo_tNNN` | 平台库 `betogo_platform` |
|---|---|---|
| 目录 | `infra/database/betogo/` | `infra/database/platform/` |
| 表前缀 | `bg_` | `pf_` |
| 迁移记录 | 各库自己的 `schema_migrations` | 平台库自己的 `schema_migrations` |
| 内容 | 用户、钱包、注单、充提、活动 | 租户、域名、套餐、计费、账单、跨租户风控 |

**铁律：任何单租户的业务数据都不许进平台库。**

## 应用方式

```bash
# 本地
./scripts/apply-platform-schema.sh

# 服务器：部署 bff-node 时自动执行（deploy/single-node/deploy-fast.sh）
```

## 约定

- 文件命名 `00N_描述.sql`，按序号执行，每个文件只执行一次
- 与租户库同样禁止在迁移中写 `TRUNCATE` / 无条件 `DELETE` / `DROP TABLE`
- 自营站固定为 `pf_tenant.id = 1`、`code = 'betogo'`、`db_name = 'betogo'`
