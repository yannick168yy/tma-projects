-- 回滚：is_active 还原到备份时状态（本次新插入的行还原为 NULL=跟随上游）
UPDATE bg_568win_game_override o
LEFT JOIN bg_568win_game_override_bak_20260712 b USING (game_provider_id, game_id)
SET o.is_active = b.is_active
WHERE o.is_active = 0;
