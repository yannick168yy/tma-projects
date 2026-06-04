-- 033: 修复 031 迁移创建的表未指定 COLLATE 导致与 bg_user 的 JOIN 冲突
-- MySQL 8.0 默认 utf8mb4_0900_ai_ci，而存量表使用 utf8mb4_unicode_ci

ALTER TABLE bg_wallet
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE bg_deposit_order
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE bg_withdraw_order
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- bg_wallet_ledger.currency 列（031 加的）也需对齐
ALTER TABLE bg_wallet_ledger
  MODIFY COLUMN currency VARCHAR(16) NOT NULL DEFAULT 'PHP'
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    COMMENT '币种';
