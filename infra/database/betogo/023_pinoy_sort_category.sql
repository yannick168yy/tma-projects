-- 023: 为菲律宾传统游戏打 sort_category='pinoy' 标签
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS `__migrate_023`;
DELIMITER $$
CREATE PROCEDURE `__migrate_023`()
BEGIN
  UPDATE sg_games
  SET sort_category = 'pinoy'
  WHERE uuid IN (
    -- PERYA CLASSICS
    '58f038e202409028258f3ed9581589db0eb50510', -- Color Game Extreme (JILI)
    'b58561e0b90249b18f6fe3d66bf65c74',          -- Color Game (JILI)
    'aa9e42ff386e49a0889492e7cbd4452a',           -- Color Prediction (JILI)
    'a7943aa090104ddda8008b685fcbaeb2',           -- Super E-Sabong (JILI)
    '6721efc3f16f42cd907155d79d560030',           -- CockFighting (Rich88)
    '672cf996d4be4bcd8d6c7c847258ca33',           -- Sic Bo (JILI)
    -- MORE PINOY GAMES
    '173c325e55a546e4a50cb1f5d89171b4',           -- Dragon Tiger Mobile (KAGaming)
    '0d863a26ff6843169aeda4519811c924',           -- Dragon Tiger Mobile (PragmaticPlay)
    '319a82ab9eb941ca8adbc958af3456b1',           -- Virtual SicBo (FunkyGames)
    'c36b075de1384fc681970c8343269c05',           -- Thai HiLo (FunkyGames)
    '7d6977b36be04303b1a5a56a9caf9573',           -- Cockfighting 2 (Rich88)
    '1caab9939c3c40c4b02638bc1ecf5c9a',           -- Thai Sic Bo 2 (Rich88)
    'da1d06adc2b6452e908b7634ec9b61ca',           -- Color Game (Rich88)
    'af923befebaf4df0b64e9057c820e5d2',           -- Color Dish (Rich88)
    '6b6daf151dbc45c88987e81aa056b7f0',           -- Lucky Color Game (JDB)
    '55bca7f034174deca3080875d3149364',           -- TeenPatti Joker Mobile (JILI)
    '96f98fff15574a02b3c3978c08e344ae',           -- TeenPatti Mobile (JILI)
    'c148c295ad214b03b42d79fb0b5a11f2'            -- Hilo Mobile (Spribe)
  );
END $$
DELIMITER ;
CALL `__migrate_023`();
DROP PROCEDURE IF EXISTS `__migrate_023`;
