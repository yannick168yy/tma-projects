-- 首页装修 Banner 由「按语言换图」改为「按站点换图」：站点 = 后台站点域名映射里的所属站点（PH/IN/ID）。
-- 旧表 bg_home_content_image 保留不删，仅不再读取。
CREATE TABLE IF NOT EXISTS `bg_home_content_site_image` (
  `kind` ENUM('banner','card','wallet_banner') NOT NULL,
  `slot` INT UNSIGNED NOT NULL,
  `market` VARCHAR(8) NOT NULL COMMENT '站点：PH / IN / ID',
  `image_key` VARCHAR(255) NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`kind`, `slot`, `market`),
  CONSTRAINT `fk_home_content_site_image_item`
    FOREIGN KEY (`kind`, `slot`) REFERENCES `bg_home_content` (`kind`, `slot`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首页装修各站点专属图片（未配置的站点用默认图）';

-- 原印尼语图片基本只服务印尼站，迁为印尼站图片；越南语 / 中文图片没有对应站点，不迁移
INSERT IGNORE INTO `bg_home_content_site_image` (`kind`, `slot`, `market`, `image_key`)
SELECT `kind`, `slot`, 'ID', `image_key` FROM `bg_home_content_image` WHERE `locale` = 'id';
