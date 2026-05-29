-- 019: 修复 cs_faq 乱码（连接字符集为 latin1 时 UTF-8 数据被双重编码）
SET NAMES utf8mb4;

UPDATE cs_faq
SET
  question = CONVERT(BINARY(CONVERT(question USING latin1)) USING utf8mb4),
  answer   = CONVERT(BINARY(CONVERT(answer   USING latin1)) USING utf8mb4);

-- 标记表：让部署脚本检测到后跳过此迁移
CREATE TABLE IF NOT EXISTS bg_fix_faq_encoding (
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT INTO bg_fix_faq_encoding VALUES (NOW());
