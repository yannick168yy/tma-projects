-- 171: 安装认领改为按设备键查（IP 降为优先项而非硬条件，CGNAT/VPN 下两次请求出口 IP 常不同），
-- 补 device_key 前导的索引。
SET NAMES utf8mb4;

ALTER TABLE `bg_pending_install`
  ADD KEY `idx_key_created` (`device_key`, `created_at`);
