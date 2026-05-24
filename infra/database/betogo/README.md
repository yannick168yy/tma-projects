# BetoGo MySQL 表结构

| 文件 | 说明 |
|------|------|
| `001_schema.sql` | v1 全量建表（用户、钱包、充提、KYC、活动、竞彩预留） |

## 执行顺序

```bash
# 1. 建库与用户（若未执行）
mysql -h127.0.0.1 -P3306 -uroot -p < deploy/mysql/create-betogo-database.sql

# 2. 建表
mysql -h127.0.0.1 -P3306 -ubetogo -p betogo < infra/database/betogo/001_schema.sql
```

金额字段统一 **PHP 分（BIGINT）**；`bg_deposit_order.amount` 保留下单原始面额（PHP/USDT）。
