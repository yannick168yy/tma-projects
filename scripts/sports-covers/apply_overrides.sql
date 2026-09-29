-- 体育首页封面覆盖（手动执行，不进入自动迁移）
-- 图片需先上传到 KYC_STORAGE_DIR/covers/sports/。

UPDATE bg_virtual_game_config
SET image_override = '/api/v1/home/images/covers/sports/ph-568win-tennis-v1.webp',
    image_source = 'sports-original'
WHERE uuid = '568win:sportsbook';

INSERT INTO bg_568win_game_override
  (game_provider_id, game_id, image_override, image_override_source, image_anim)
VALUES
  (1080, 7, '/api/v1/home/images/covers/sports/ph-lucky-basketball-v1.webp', 'sports-original', NULL),
  (1015, 0, '/api/v1/home/images/covers/sports/ph-afb-football-v1.webp', 'sports-original', NULL),
  (1053, 1, '/api/v1/home/images/covers/sports/in-panda-cricket-v1.webp', 'sports-original', NULL),
  (1022, 0, '/api/v1/home/images/covers/sports/in-bti-basketball-v1.webp', 'sports-original', NULL),
  (44, 0, '/api/v1/home/images/covers/sports/in-saba-football-v1.webp', 'sports-original', NULL)
ON DUPLICATE KEY UPDATE
  image_override = VALUES(image_override),
  image_override_source = VALUES(image_override_source),
  image_anim = VALUES(image_anim);

INSERT INTO bg_568win_game_cover_candidate
  (game_provider_id, game_id, source, url, anim_url)
VALUES
  (0, 0, 'sports-original', '/api/v1/home/images/covers/sports/ph-568win-tennis-v1.webp', NULL),
  (1080, 7, 'sports-original', '/api/v1/home/images/covers/sports/ph-lucky-basketball-v1.webp', NULL),
  (1015, 0, 'sports-original', '/api/v1/home/images/covers/sports/ph-afb-football-v1.webp', NULL),
  (1053, 1, 'sports-original', '/api/v1/home/images/covers/sports/in-panda-cricket-v1.webp', NULL),
  (1022, 0, 'sports-original', '/api/v1/home/images/covers/sports/in-bti-basketball-v1.webp', NULL),
  (44, 0, 'sports-original', '/api/v1/home/images/covers/sports/in-saba-football-v1.webp', NULL)
ON DUPLICATE KEY UPDATE
  url = VALUES(url),
  anim_url = VALUES(anim_url);
