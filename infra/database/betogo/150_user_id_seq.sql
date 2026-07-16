-- 150: 用户 id 取号序列表 —— 替换 nextUserId 的全表 MAX 扫描
-- 背景（压测 P4c 发现，优化清单#8）：
--   ① MAX(CAST(SUBSTRING(id,4) AS UNSIGNED)) 遇到非 BG-<n> 格式 id 时负数回绕到 2^64，之后所有注册取同一 id；
--   ② MAX+1 无锁，同瞬并发注册取同号，saveUser 的 ON DUPLICATE KEY UPDATE 会静默把两个用户合并进同一账号/钱包。
-- 取号方式：REPLACE INTO 单行（uk_stub 保证表恒一行），insertId 单调递增、原子并发安全。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bg_user_id_seq` (
  `n`    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `stub` CHAR(1) NOT NULL,
  PRIMARY KEY (`n`),
  UNIQUE KEY `uk_stub` (`stub`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户ID取号器（恒一行，REPLACE 取号）';

-- 初始化计数器 = 当前合法 BG-<n> 最大值（只认纯数字后缀，脏 id 不参与）；空库回落 10000，与旧起点一致
INSERT INTO `bg_user_id_seq` (`n`, `stub`)
SELECT COALESCE(MAX(CAST(SUBSTRING(`id`, 4) AS UNSIGNED)), 10000), 'a'
FROM `bg_user`
WHERE `id` REGEXP '^BG-[0-9]+$'
ON DUPLICATE KEY UPDATE `n` = `n`;
