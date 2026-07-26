-- 175: 投放线短码
--   短链 /t/<code> 用 code 在本表换出该线的渠道标识与像素 ID，投放链接不再带长参数。
--   同一条线的 FB 行与 TikTok 行共用一个 channel_code（各自平台的像素随行取）。
SET NAMES utf8mb4;

ALTER TABLE `bg_capi_pixel_token`
  ADD COLUMN `channel_code` VARCHAR(64) NULL COMMENT '渠道短码,短链 /t/<code> 与归因 c 值' AFTER `pixel_id`,
  ADD KEY `idx_channel_code` (`channel_code`);
