-- 172: CAPI 像素 token 映射
--   投流方用自己 BM 出像素，一线一像素、不同 BM 的 access token 互不通用，
--   全局单 env token 撑不住多线投放 —— 改为按 (platform, pixel_id) 查 token。
--   表里没配的像素回退 env 全局 token（兼容单 BM 场景）。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bg_capi_pixel_token` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `platform`     ENUM('facebook','tiktok') NOT NULL,
  `pixel_id`     VARCHAR(64)  NOT NULL,
  `access_token` VARCHAR(512) NOT NULL,
  `remark`       VARCHAR(191)     NULL COMMENT '线路/投手备注，便于对账',
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_pixel` (`platform`, `pixel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CAPI 回传 token：按像素匹配，支持多投放线/多 BM';
