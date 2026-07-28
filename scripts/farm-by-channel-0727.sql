-- 07-27 投放渠道套利客统计（只读，已剔除风控白名单测试机账号）
-- 口径：设备指纹(device_id 或硬件fp)共用≥3=套利铁证；同IP≥5且无设备信号=疑似。关联全站，人群=07-27带投放归因注册。
WITH
wl_dev  AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='device'),
wl_ip   AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='ip'),
wl_user AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='user'),
-- 白名单账号：登录/注册用过白名单设备或硬件指纹，或本身在 user 白名单
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
  WHERE a.created_at >= '2026-07-27' AND a.created_at < '2026-07-28'
    AND (a.channel_code IS NOT NULL OR a.click_platform <> 'other')
    AND a.user_id NOT IN (SELECT user_id FROM wl_acct)
),
-- 团伙计数：排除白名单设备/指纹/IP 与白名单账号，避免测试机把整环撑大
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
SELECT COALESCE(p.channel,'__TOTAL__') AS channel,
  COUNT(*) AS entrants,
  SUM(x.dev_cluster>=3) AS farm_device,
  SUM(x.dev_cluster<3 AND x.ip_cluster>=5) AS suspect_ip,
  ROUND(100*SUM(x.dev_cluster>=3 OR (x.dev_cluster<3 AND x.ip_cluster>=5))/COUNT(*),1) AS farm_pct,
  MAX(x.dev_cluster) AS max_ring
FROM pop p JOIN u_dev x ON x.user_id=p.user_id
GROUP BY p.channel WITH ROLLUP
ORDER BY farm_pct DESC, entrants DESC;
