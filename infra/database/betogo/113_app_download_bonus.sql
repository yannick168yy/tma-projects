-- App/PWA 下载礼金：一人一次领取记录（领取校验 + 来源归因）
CREATE TABLE IF NOT EXISTS bg_app_download_claim (
  user_id VARCHAR(32) NOT NULL PRIMARY KEY,
  source VARCHAR(16) NOT NULL COMMENT 'pwa | apk',
  user_agent VARCHAR(512) NOT NULL DEFAULT '',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
