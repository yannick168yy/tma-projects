-- BetoGo 业务库（参考 SQL；推荐用 scripts/apply-betogo-schema.sh 统一建库/用户/表）
-- 容器 MySQL：127.0.0.1:13306（生产）  本地 Docker：127.0.0.1:3306

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
