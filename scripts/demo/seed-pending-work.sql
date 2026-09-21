-- 演示后台固定待办样本。只从已脱敏快照中挑现有记录改状态，不新增用户或资金流水。

DROP TEMPORARY TABLE IF EXISTS demo_pending_withdrawals;
CREATE TEMPORARY TABLE demo_pending_withdrawals AS
SELECT order_id, ROW_NUMBER() OVER (ORDER BY created_at DESC, order_id) AS slot
FROM bg_withdraw_order
WHERE review_verdict = 'manual'
ORDER BY created_at DESC, order_id
LIMIT 2;

UPDATE bg_withdraw_order w
JOIN demo_pending_withdrawals d ON d.order_id = w.order_id
SET w.status = 'pending',
    w.review_verdict = 'manual',
    w.reviewed_at = CASE d.slot
      WHEN 1 THEN DATE_SUB(NOW(), INTERVAL 40 MINUTE)
      ELSE DATE_SUB(NOW(), INTERVAL 2 HOUR)
    END,
    w.handled_by = NULL,
    w.handled_at = NULL,
    w.badge_ignored = 0,
    w.refunded = 0,
    w.reject_reason = NULL,
    w.reject_reason_user = NULL,
    w.created_at = CASE d.slot
      WHEN 1 THEN DATE_SUB(NOW(), INTERVAL 35 MINUTE)
      ELSE DATE_SUB(NOW(), INTERVAL 110 MINUTE)
    END,
    w.updated_at = NOW();

DROP TEMPORARY TABLE demo_pending_withdrawals;

DROP TEMPORARY TABLE IF EXISTS demo_pending_tickets;
CREATE TEMPORARY TABLE demo_pending_tickets AS
SELECT c.id,
       ROW_NUMBER() OVER (ORDER BY c.updated_at DESC, c.id) AS slot,
       (SELECT COUNT(*) FROM cs_message m WHERE m.conversation_id = c.id) AS message_count
FROM cs_conversation c
WHERE c.escalated_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM cs_message m WHERE m.conversation_id = c.id)
ORDER BY c.updated_at DESC, c.id
LIMIT 2;

UPDATE cs_conversation c
JOIN demo_pending_tickets d ON d.id = c.id
SET c.status = 'escalated',
    c.assigned_admin_id = NULL,
    c.escalate_reason = COALESCE(c.escalate_reason, 'unresolved'),
    c.escalated_at = CASE d.slot
      WHEN 1 THEN DATE_SUB(NOW(), INTERVAL 20 MINUTE)
      ELSE DATE_SUB(NOW(), INTERVAL 75 MINUTE)
    END,
    c.user_left_at = NULL,
    c.badge_ignored = 0,
    c.updated_at = CASE d.slot
      WHEN 1 THEN DATE_SUB(NOW(), INTERVAL 15 MINUTE)
      ELSE DATE_SUB(NOW(), INTERVAL 70 MINUTE)
    END,
    c.resolved_at = NULL,
    c.ai_summary = CASE d.slot
      WHEN 1 THEN '用户多次咨询账户相关问题，AI 已提供基础说明，但用户仍要求人工协助。建议查看完整对话后跟进处理。'
      ELSE '用户反馈当前问题尚未解决，并请求人工客服介入。AI 已完成基础引导，建议结合对话记录核实情况后回复用户。'
    END,
    c.ai_summary_model = '演示数据',
    c.ai_summary_message_count = d.message_count,
    c.ai_summary_updated_at = CASE d.slot
      WHEN 1 THEN DATE_SUB(NOW(), INTERVAL 15 MINUTE)
      ELSE DATE_SUB(NOW(), INTERVAL 70 MINUTE)
    END;

DROP TEMPORARY TABLE demo_pending_tickets;

DROP TEMPORARY TABLE IF EXISTS demo_pending_kyc;
CREATE TEMPORARY TABLE demo_pending_kyc AS
SELECT user_id, ROW_NUMBER() OVER (ORDER BY updated_at DESC, user_id) AS slot
FROM bg_kyc
WHERE status = 'approved'
  AND full_name IS NOT NULL
  AND doc_submitted_at IS NOT NULL
ORDER BY updated_at DESC, user_id
LIMIT 2;

UPDATE bg_kyc k
JOIN demo_pending_kyc d ON d.user_id = k.user_id
SET k.status = 'pending',
    k.phone_verified = 1,
    k.doc_verified = 0,
    k.face_verified = 0,
    k.verify_mode = 'document',
    k.submitted_at = CASE d.slot
      WHEN 1 THEN DATE_SUB(NOW(), INTERVAL 30 MINUTE)
      ELSE DATE_SUB(NOW(), INTERVAL 95 MINUTE)
    END,
    k.doc_submitted_at = CASE d.slot
      WHEN 1 THEN DATE_SUB(NOW(), INTERVAL 25 MINUTE)
      ELSE DATE_SUB(NOW(), INTERVAL 90 MINUTE)
    END,
    k.face_submitted_at = NULL,
    k.reviewed_at = NULL,
    k.reviewed_by = NULL,
    k.badge_ignored = 0,
    k.reject_reason = NULL,
    k.reject_step = NULL,
    k.updated_at = NOW();

DROP TEMPORARY TABLE demo_pending_kyc;
