-- ============================================================================
-- 投放渠道套利客日报（只读，可反复跑）
-- 用法：改下面 @day 为要统计的自然日，整段执行即可。
-- 口径：设备指纹(device_id 或硬件fp)被≥3个账号共用 = 套利铁证；
--       同IP≥5且无设备信号 = 疑似(IP噪声大，单列不并入铁证)；
--       关联范围=全站全时段(抓团伙老主号)，人群=当日带投放归因的注册；
--       已剔除风控白名单(bg_promo_claim_whitelist)登记的测试机账号。
-- ============================================================================
SET @day := '2026-07-27';                 -- ← 只改这里
SET @d0  := CONCAT(@day,' 00:00:00');
SET @d1  := CONCAT(@day,' 23:59:59.999');

WITH
wl_dev  AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='device'),
wl_ip   AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='ip'),
wl_user AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='user'),
wl_acct AS (
  SELECT DISTINCT user_id FROM bg_login_log
    WHERE device_id IN (SELECT value FROM wl_dev) OR fp_visitor IN (SELECT value FROM wl_dev)
  UNION SELECT id FROM bg_user WHERE register_device_id IN (SELECT value FROM wl_dev)
  UNION SELECT value FROM wl_user
),
pop AS (
  SELECT a.user_id,
         COALESCE(NULLIF(a.channel_code,''), NULLIF(a.utm_source,''), a.click_platform) AS channel
  FROM bg_user_attribution a
  WHERE a.created_at BETWEEN @d0 AND @d1
    AND (a.channel_code IS NOT NULL OR a.click_platform <> 'other')
    AND a.user_id NOT IN (SELECT user_id FROM wl_acct)
),
ud AS (
  SELECT user_id, device_id FROM bg_login_log
    WHERE device_id<>'' AND device_id IS NOT NULL
      AND device_id NOT IN (SELECT value FROM wl_dev) AND user_id NOT IN (SELECT user_id FROM wl_acct)
  UNION
  SELECT id, register_device_id FROM bg_user
    WHERE register_device_id<>'' AND register_device_id IS NOT NULL
      AND register_device_id NOT IN (SELECT value FROM wl_dev) AND id NOT IN (SELECT user_id FROM wl_acct)
),
dc AS (SELECT device_id, COUNT(DISTINCT user_id) n FROM ud GROUP BY device_id),
uf AS (
  SELECT DISTINCT user_id, fp_visitor FROM bg_login_log
    WHERE fp_visitor<>'' AND fp_visitor IS NOT NULL
      AND fp_visitor NOT IN (SELECT value FROM wl_dev) AND user_id NOT IN (SELECT user_id FROM wl_acct)
),
fc AS (SELECT fp_visitor, COUNT(DISTINCT user_id) n FROM uf GROUP BY fp_visitor),
ui AS (
  SELECT user_id, ip FROM bg_login_log
    WHERE ip<>'' AND ip IS NOT NULL AND ip NOT IN (SELECT value FROM wl_ip) AND user_id NOT IN (SELECT user_id FROM wl_acct)
  UNION
  SELECT user_id, client_ip FROM bg_user_attribution
    WHERE client_ip<>'' AND client_ip IS NOT NULL AND client_ip NOT IN (SELECT value FROM wl_ip) AND user_id NOT IN (SELECT user_id FROM wl_acct)
),
ic AS (SELECT ip, COUNT(DISTINCT user_id) n FROM ui GROUP BY ip),
u_dev AS (
  SELECT p.user_id, p.channel,
    GREATEST(
      COALESCE((SELECT MAX(dc.n) FROM ud JOIN dc ON dc.device_id=ud.device_id WHERE ud.user_id=p.user_id),0),
      COALESCE((SELECT MAX(fc.n) FROM uf JOIN fc ON fc.fp_visitor=uf.fp_visitor WHERE uf.user_id=p.user_id),0)
    ) AS dev_cluster,
    COALESCE((SELECT MAX(ic.n) FROM ui JOIN ic ON ic.ip=ui.ip WHERE ui.user_id=p.user_id),0) AS ip_cluster
  FROM pop p
)
SELECT COALESCE(p.channel,'__合计__') AS channel,
  COUNT(*)                                                              AS entrants,
  SUM(x.dev_cluster>=3)                                                 AS farm_device,
  SUM(x.dev_cluster<3 AND x.ip_cluster>=5)                             AS suspect_ip,
  ROUND(100*SUM(x.dev_cluster>=3 OR (x.dev_cluster<3 AND x.ip_cluster>=5))/COUNT(*),1) AS farm_pct,
  MAX(x.dev_cluster)                                                    AS max_ring
FROM pop p JOIN u_dev x ON x.user_id=p.user_id
GROUP BY p.channel WITH ROLLUP
ORDER BY GROUPING(p.channel), farm_pct DESC, entrants DESC;
