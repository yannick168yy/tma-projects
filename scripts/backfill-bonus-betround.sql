-- 一次性回填:把历史 /Bonus(BetPayout)派彩补进 bg_bet_order 并重算 bg_bet_round，
-- 使这些真实到账、却在客户端「投注记录」里看不到的赢钱得以体现。
--
-- ⚠️ 手动执行，禁止放进 infra/database/betogo/ 迁移目录(会每次部署重跑)。
-- ⚠️ 生产执行前务必先备份,并逐步核对影响行数(见文末校验)。
-- 幂等:两步都是 INSERT IGNORE / ON DUPLICATE KEY UPDATE，重复执行不会重复补行或叠加金额。
--
-- 归局键:bonus 回调 body 无 GameRoundId，用 SeamlessGameExtraInfo.ReferenceRefNo
-- (母注单 bet 的 TransferCode)反查母 bet 的 round_id，与 deduct 写入的 bet_order.round_id 一致。

-- 步骤 1：为每条 BetPayout 派彩补一条 win 行，归到母注单 round
INSERT IGNORE INTO bg_bet_order
  (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type,
   amount, currency_code, original_amount, exchange_rate, status, settled_at)
SELECT
  b.user_id,
  '568win',
  COALESCE(pb.provider_id, b.provider_id),
  CONCAT('bonus:', b.transfer_code),
  COALESCE(pb.round_id,
           JSON_UNQUOTE(JSON_EXTRACT(b.raw_request, '$.SeamlessGameExtraInfo.ReferenceRefNo'))),
  'win',
  b.amount, b.currency, b.amount, 1, 'settled', b.created_at
FROM bg_568win_wallet_txn b
JOIN bg_568win_wallet_txn pb
  ON pb.transfer_code = JSON_UNQUOTE(JSON_EXTRACT(b.raw_request, '$.SeamlessGameExtraInfo.ReferenceRefNo'))
 AND pb.txn_type = 'bet'
WHERE b.txn_type = 'bonus'
  AND b.amount > 0
  AND JSON_EXTRACT(b.raw_request, '$.SeamlessGameExtraInfo.ReferenceRefNo') IS NOT NULL;

-- 步骤 2：重算所有被补过派彩的 round 的读加速表 bg_bet_round
-- (只重算涉及 bonus 补行的局，逻辑与 refreshBetRound 完全一致)
INSERT INTO bg_bet_round
  (user_id, round_id, aggregator_id, provider_txn_id, bet_amount, win_amount,
   currency_code, first_at, last_id)
SELECT
  o.user_id, o.round_id, MAX(o.aggregator_id),
  COALESCE(MAX(CASE WHEN o.bet_type = 'bet' THEN o.provider_txn_id END), MAX(o.provider_txn_id)),
  SUM(CASE WHEN o.bet_type = 'bet' THEN o.amount ELSE 0 END),
  SUM(CASE WHEN o.bet_type IN ('win', 'refund') THEN o.amount ELSE 0 END),
  MAX(o.currency_code), MIN(o.created_at), MAX(o.id)
FROM bg_bet_order o
JOIN (
  SELECT DISTINCT user_id, round_id
  FROM bg_bet_order
  WHERE aggregator_id = '568win' AND bet_type = 'win' AND provider_txn_id LIKE 'bonus:%'
) t ON t.user_id = o.user_id AND t.round_id = o.round_id
GROUP BY o.user_id, o.round_id
ON DUPLICATE KEY UPDATE
  aggregator_id = VALUES(aggregator_id), provider_txn_id = VALUES(provider_txn_id),
  bet_amount = VALUES(bet_amount), win_amount = VALUES(win_amount),
  currency_code = VALUES(currency_code), first_at = VALUES(first_at), last_id = VALUES(last_id);
