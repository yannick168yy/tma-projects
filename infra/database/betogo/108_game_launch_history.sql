-- 108: 用户游戏启动历史（recently played 改为启动即记录，不再依赖投注注单反查）
SET NAMES utf8mb4;

CREATE TABLE bg_game_launch (
  user_id VARCHAR(32) NOT NULL COMMENT '本地用户ID',
  game_uuid VARCHAR(80) NOT NULL COMMENT '游戏uuid（568win:gp:id 或 slotegrator uuid）',
  launch_count INT NOT NULL DEFAULT 1,
  last_launched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, game_uuid),
  KEY idx_user_time (user_id, last_launched_at DESC),
  CONSTRAINT fk_game_launch_user FOREIGN KEY (user_id) REFERENCES bg_user (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户游戏启动历史';
