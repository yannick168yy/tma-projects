-- 034: bg_withdraw_order 和 bg_deposit_order 的 status ENUM 补加 admin_rejected

ALTER TABLE bg_withdraw_order
  MODIFY COLUMN status ENUM('pending','processing','completed','failed','rejected','admin_rejected')
  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending';

ALTER TABLE bg_deposit_order
  MODIFY COLUMN status ENUM('pending','paid','failed','rejected','admin_rejected')
  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending';
