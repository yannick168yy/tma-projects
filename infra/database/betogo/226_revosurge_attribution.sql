-- 226: RevoSurge 买量接入
--   click_id 是 RevoSurge 归因的唯一凭据，注册时随 X-Attr 落快照（用户可能几天后才充值，
--   那时 URL 参数早没了，只有这份快照能支撑 S2S 回传）
--   bg_capi_event 复用为 RevoSurge 的幂等闸，platform 枚举加一个值即可
SET NAMES utf8mb4;

ALTER TABLE `bg_user_attribution`
  ADD COLUMN `revosurge_click_id` VARCHAR(191) NULL COMMENT 'RevoSurge 广告点击 ID，落地页 ?click_id= 带入' AFTER `tt_pixel_id`;

ALTER TABLE `bg_capi_event`
  MODIFY COLUMN `platform` ENUM('facebook','tiktok','revosurge') NOT NULL;
