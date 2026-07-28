-- 07-27 投放套利客明细（只读）：被判定账号清单 + 总计
WITH
pop AS (
  SELECT a.user_id,
         COALESCE(NULLIF(a.channel_code,''), NULLIF(a.utm_source,''), a.click_platform) AS channel
  FROM bg_user_attribution a
  WHERE a.created_at >= '2026-07-27' AND a.created_at < '2026-07-28'
    AND (a.channel_code IS NOT NULL OR a.click_platform <> 'other')
),
ud AS (
  SELECT user_id, device_id FROM bg_login_log WHERE device_id IS NOT NULL AND device_id<>''
  UNION
  SELECT id, register_device_id FROM bg_user WHERE register_device_id IS NOT NULL AND register_device_id<>''
),
dc AS (SELECT device_id, COUNT(DISTINCT user_id) n FROM ud GROUP BY device_id),
u_dev AS (
  SELECT p.user_id, p.channel,
    (SELECT dc.device_id FROM ud JOIN dc ON dc.device_id=ud.device_id WHERE ud.user_id=p.user_id ORDER BY dc.n DESC LIMIT 1) AS top_device,
    COALESCE((SELECT MAX(dc.n) FROM ud JOIN dc ON dc.device_id=ud.device_id WHERE ud.user_id=p.user_id),0) AS ring
  FROM pop p
)
SELECT x.channel, x.user_id, x.ring AS ring_accounts,
       LEFT(x.top_device,16) AS device_fp16, u.status, u.created_at
FROM u_dev x JOIN bg_user u ON u.id=x.user_id
WHERE x.ring>=3
ORDER BY x.ring DESC, x.channel, x.user_id;
