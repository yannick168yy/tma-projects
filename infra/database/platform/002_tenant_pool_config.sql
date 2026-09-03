-- 租户连接池策略：初始数 / 最大数 / 排队上限，按租户可配。
--
-- 为什么不用一个固定值：包网租户体量差异极大，试用站和旗舰客户不该拿同样的资源；
-- 而前期只有几个租户时限制连接池毫无意义，默认给足即可，服务器扛不住再按租户下调。
--
-- 字段与 mysql2 的对应关系（mysql2 没有原生「最小连接数」概念）：
--   pool_max   → connectionLimit  连接数硬上限
--   pool_min   → maxIdle          常驻空闲连接数；池创建后会后台顺序预热到这个数，
--                                 之后空闲连接不会被回收到低于它，避免反复重连
--   queue_limit→ queueLimit       等待队列上限；0 = 不限（mysql2 默认）
SET NAMES utf8mb4;

ALTER TABLE `pf_tenant`
  ADD COLUMN `pool_min` SMALLINT UNSIGNED NOT NULL DEFAULT 2
    COMMENT '常驻连接数（mysql2 maxIdle），池创建后预热到此数' AFTER `self_operated`,
  ADD COLUMN `pool_max` SMALLINT UNSIGNED NOT NULL DEFAULT 10
    COMMENT '连接数上限（mysql2 connectionLimit）' AFTER `pool_min`,
  ADD COLUMN `queue_limit` SMALLINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '等待队列上限，0=不限。设有限值可让过载快速失败而不是无声堆积' AFTER `pool_max`;

-- 自营站沿用压测验证过的池 10
UPDATE `pf_tenant` SET `pool_min` = 2, `pool_max` = 10 WHERE `self_operated` = 1;
