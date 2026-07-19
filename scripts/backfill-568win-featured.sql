-- 一次性回填：富化高分游戏批量置为首页推荐 featured
-- ⚠️ 手动执行，不进迁移、不自动部署
-- 用法：ssh 到服务器后
--   podman exec tma-mysql sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" betogo' < 本文件
UPDATE bg_568win_game_override
SET is_featured = 1
WHERE ph_bonus >= 15
  AND COALESCE(is_featured, 0) = 0;
