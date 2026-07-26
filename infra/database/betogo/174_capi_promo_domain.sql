-- 174: 投放线推广域名
--   每条投放线（=一个像素）登记它实际投放使用的推广域名，便于后台对账时看清
--   「哪条线投在哪个域名」，也便于核对归因落库的 landing_host 是否与配置一致。
SET NAMES utf8mb4;

ALTER TABLE `bg_capi_pixel_token`
  ADD COLUMN `promo_domain` VARCHAR(191) NULL COMMENT '该线推广域名,如 betogo666.com' AFTER `test_event_code`;
