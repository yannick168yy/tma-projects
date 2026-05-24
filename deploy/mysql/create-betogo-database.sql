-- BetoGo 业务库（宝塔 MySQL / 宿主机 3306）
-- 执行示例（在阿里云服务器上，按实际 root 密码调整）:
--   mysql -h 127.0.0.1 -P 3306 -u root -p < deploy/mysql/create-betogo-database.sql

CREATE DATABASE IF NOT EXISTS `betogo`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 应用账号（生产请替换密码并仅授予 betogo.*）
CREATE USER IF NOT EXISTS 'betogo'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_betogo_app';
CREATE USER IF NOT EXISTS 'betogo'@'localhost' IDENTIFIED BY 'CHANGE_ME_betogo_app';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON `betogo`.* TO 'betogo'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON `betogo`.* TO 'betogo'@'localhost';

FLUSH PRIVILEGES;
