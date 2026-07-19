-- 022: 修正 bingo 游戏的 sort_category 分类
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS `__migrate_022`;
DELIMITER $$
CREATE PROCEDURE `__migrate_022`()
BEGIN
  -- 将 SG 原始分类为 bingo/videobingos 的游戏统一设为 sort_category='bingo'
  UPDATE sg_games
  SET sort_category = 'bingo'
  WHERE category IN ('bingo', 'videobingos', 'Bingo');

  -- 补漏：名称含 bingo 但被归到 slots/other 的游戏
  UPDATE sg_games
  SET sort_category = 'bingo'
  WHERE LOWER(name) LIKE '%bingo%'
    AND sort_category NOT IN ('bingo');
END $$
DELIMITER ;
CALL `__migrate_022`();
DROP PROCEDURE IF EXISTS `__migrate_022`;
