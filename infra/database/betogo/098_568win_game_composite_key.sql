ALTER TABLE `bg_568win_game`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`game_provider_id`, `game_id`),
  ADD KEY `idx_game_id` (`game_id`);
