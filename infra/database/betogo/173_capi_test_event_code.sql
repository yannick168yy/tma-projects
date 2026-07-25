-- 173: 像素级测试事件码
--   开测验证期投流方给每条线一个 test_event_code（FB「测试事件」页实时确认回传用），
--   多线同时验证时全局 env 顶不住，跟着像素走。验证完后台清空该字段即恢复正式上报。
SET NAMES utf8mb4;

ALTER TABLE `bg_capi_pixel_token`
  ADD COLUMN `test_event_code` VARCHAR(32) NULL COMMENT '测试事件码,非空时随事件上报,验证完清空' AFTER `access_token`;
