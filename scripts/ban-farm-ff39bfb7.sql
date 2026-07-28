-- 2026-07-27 薅羊毛团伙处置（用户已授权，手动执行，不进迁移）
-- 依据：硬件指纹 ff39bfb75b63bcb8cc411346d8be52b8 = 同一台 HONOR LGN-LX2，
-- 12 个号 / 12 个全新 deviceId / 12 个代理 IP，各领 ₱20 下载金；
-- BG-10213 存 ₱110 解锁提现闸门后滚到 ₱10,343.75，试提 ₱5,000 已被人工拒。
-- 处置：全部封禁 + 余额没收清零（留 admin_adjust 账本，申诉可按账本退）。

SET @ids := NULL; -- 文档用途；下面 IN 列表为准

UPDATE bg_user
   SET status = 'banned',
       status_reason = 'risk: multi-account bonus farming, hw fingerprint ff39bfb75b63bcb8cc411346d8be52b8, 12 accounts, proxy IP rotation'
 WHERE id IN ('BG-10098','BG-10108','BG-10170','BG-10178','BG-10182','BG-10187',
              'BG-10194','BG-10198','BG-10201','BG-10204','BG-10206','BG-10213');

INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
SELECT CONCAT('LG_', ROUND(UNIX_TIMESTAMP(NOW(3))*1000), '_', SUBSTRING(MD5(RAND()),1,6)),
       user_id, currency, 'admin_adjust', -available, 0, 'risk', NULL,
       'seizure: multi-account farm fp ff39bfb7'
  FROM bg_wallet
 WHERE user_id IN ('BG-10098','BG-10108','BG-10170','BG-10178','BG-10182','BG-10187',
                   'BG-10194','BG-10198','BG-10201','BG-10204','BG-10206','BG-10213')
   AND available > 0;

UPDATE bg_wallet
   SET available = 0, version = version + 1
 WHERE user_id IN ('BG-10098','BG-10108','BG-10170','BG-10178','BG-10182','BG-10187',
                   'BG-10194','BG-10198','BG-10201','BG-10204','BG-10206','BG-10213')
   AND available > 0;

-- 复核
SELECT u.id, u.status, w.available
  FROM bg_user u LEFT JOIN bg_wallet w ON w.user_id = u.id
 WHERE u.id IN ('BG-10098','BG-10108','BG-10170','BG-10178','BG-10182','BG-10187',
                'BG-10194','BG-10198','BG-10201','BG-10204','BG-10206','BG-10213')
 ORDER BY u.id;
SELECT COUNT(*) AS ledger_rows, SUM(amount) AS seized
  FROM bg_wallet_ledger WHERE description = 'seizure: multi-account farm fp ff39bfb7';
