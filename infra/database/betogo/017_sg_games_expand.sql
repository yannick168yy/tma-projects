-- 017: sg_games 补充完整字段（类型、技术、RTP、波动性等）
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS `__migrate_017`;
DELIMITER $$
CREATE PROCEDURE `__migrate_017`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sg_games' AND COLUMN_NAME='type') = 0 THEN
    ALTER TABLE `sg_games`
      ADD COLUMN `type`         VARCHAR(64)   NULL COMMENT '游戏类型，如 slots | baccarat' AFTER `name`,
      ADD COLUMN `provider_id`  INT           NULL COMMENT '供应商数字 ID'                AFTER `provider`,
      ADD COLUMN `technology`   VARCHAR(32)   NULL COMMENT '技术: HTML5 | Flash'          AFTER `provider_id`,
      ADD COLUMN `has_freespins` TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否支持免费旋转' AFTER `has_lobby`,
      ADD COLUMN `has_tables`   TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '是否有桌子'      AFTER `has_freespins`,
      ADD COLUMN `label`        VARCHAR(255)  NULL COMMENT '子供应商标签'                  AFTER `has_tables`,
      ADD COLUMN `rtp`          DECIMAL(5,2)  NULL COMMENT '玩家回报率 RTP %'              AFTER `label`,
      ADD COLUMN `volatility`   VARCHAR(32)   NULL COMMENT '波动性: low|medium|high'       AFTER `rtp`,
      ADD COLUMN `reels_count`  VARCHAR(16)   NULL COMMENT '转轮数，如 5+1'               AFTER `volatility`,
      ADD COLUMN `lines_count`  INT           NULL COMMENT '赔付线数'                      AFTER `reels_count`,
      ADD COLUMN `image_hq_url` VARCHAR(512)  NULL COMMENT '高清图地址'                    AFTER `image_url`;
  END IF;
END $$
DELIMITER ;
CALL `__migrate_017`();
DROP PROCEDURE IF EXISTS `__migrate_017`;
