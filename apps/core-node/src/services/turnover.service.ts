import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

export async function createDepositRequirement(
  conn: PoolConnection,
  userId: string,
  orderId: string,
  amount: number,
  currency = 'PHP',
): Promise<void> {
  if (amount <= 0) return
  await conn.execute(
    `INSERT IGNORE INTO bg_turnover_requirements
       (user_id, currency, source_type, source_ref, base_amount, required_amount)
     VALUES (?, ?, 'deposit', ?, ?, ?)`,
    [userId, currency, orderId, amount, amount],
  )
}

async function fillPendingTurnoverRequirements(
  conn: PoolConnection,
  userId: string,
  currency: string,
  logId: number,
  effectiveAmount: number,
): Promise<void> {
  const [reqs] = await conn.query<RowDataPacket[]>(
    `SELECT id, required_amount - completed_amount AS remaining
     FROM bg_turnover_requirements
     WHERE user_id = ? AND currency = ? AND status = 'pending'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY (source_type = 'deposit') DESC, created_at ASC
     FOR UPDATE`,
    [userId, currency],
  )

  let remaining = effectiveAmount
  for (const req of reqs) {
    if (remaining <= 0) break
    const fill = Math.min(remaining, Number(req.remaining))
    if (fill <= 0) continue
    await conn.execute(
      `INSERT INTO bg_turnover_allocations (log_id, requirement_id, allocated_amount)
       VALUES (?, ?, ?)`,
      [logId, req.id, fill],
    )
    await conn.execute(
      `UPDATE bg_turnover_requirements
       SET status = IF(completed_amount + ? >= required_amount, 'completed', 'pending'),
           completed_amount = completed_amount + ?,
           updated_at = NOW()
       WHERE id = ?`,
      [fill, fill, req.id],
    )
    remaining -= fill
  }
}

export async function allocateBetTurnoverInTransaction(
  conn: PoolConnection,
  userId: string,
  betOrderId: number,
  betAmount: number,
  game: { gpid: number | null; gameId: number | null },
  currency = 'PHP',
): Promise<void> {
  if (betAmount <= 0) return

  let sortCategory: string | null = null
  let rate = 1.0
  if (game.gameId != null) {
    const [[gameRow]] = await conn.query<RowDataPacket[]>(
      `SELECT sc.sort_category, COALESCE(r.rate, 1.0) AS rate
       FROM (
         SELECT COALESCE(o.sort_category,
           CASE
             WHEN g.new_game_type = 203 THEN 'fishing'
             WHEN g.new_game_type = 204 THEN 'table'
             WHEN g.new_game_type = 300 THEN 'sports'
             WHEN g.new_game_type >= 100 AND g.new_game_type < 200 THEN 'live'
             WHEN g.new_game_type >= 200 AND g.new_game_type < 300 THEN 'slots'
             ELSE 'other'
           END) AS sort_category
         FROM bg_568win_game g
         LEFT JOIN bg_568win_game_override o
           ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
         WHERE g.game_id = ? AND (? IS NULL OR g.game_provider_id = ?)
         LIMIT 1
       ) sc
       LEFT JOIN bg_game_turnover_rates r ON r.sort_category = sc.sort_category`,
      [game.gameId, game.gpid, game.gpid],
    )
    if (gameRow) {
      sortCategory = (gameRow.sort_category as string | null) ?? null
      rate = Number(gameRow.rate)
    }
  }
  const effectiveAmount = Math.round(betAmount * rate * 10000) / 10000

  if (effectiveAmount <= 0) return

  const [logResult] = await conn.execute<ResultSetHeader>(
    `INSERT INTO bg_turnover_logs
       (user_id, currency, bet_order_id, bet_amount, rate, effective_amount, sort_category)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, currency, betOrderId, betAmount, rate, effectiveAmount, sortCategory],
  )
  const logId = logResult.insertId

  // 总流水累计（迁移151）：同事务增量维护，读侧(getUserTotalTurnover)免于全表 SUM
  await conn.execute(
    `INSERT INTO bg_user_vip_state (user_id, currency, turnover_total) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE turnover_total = turnover_total + VALUES(turnover_total)`,
    [userId, currency, effectiveAmount],
  )

  await fillPendingTurnoverRequirements(conn, userId, currency, logId, effectiveAmount)
}

export async function increaseBetTurnoverInTransaction(
  conn: PoolConnection,
  userId: string,
  betOrderId: number,
  betDiff: number,
  game: { gpid: number | null; gameId: number | null },
  currency = 'PHP',
): Promise<void> {
  if (betDiff <= 0) return
  const [[log]] = await conn.query<RowDataPacket[]>(
    `SELECT id, rate
     FROM bg_turnover_logs
     WHERE user_id = ? AND currency = ? AND bet_order_id = ? AND is_reversed = 0
     FOR UPDATE`,
    [userId, currency, betOrderId],
  )
  if (!log) {
    await allocateBetTurnoverInTransaction(conn, userId, betOrderId, betDiff, game, currency)
    return
  }
  const rate = Number(log.rate)
  const effectiveDiff = Math.round(betDiff * rate * 10000) / 10000
  if (effectiveDiff <= 0) return
  await conn.execute(
    `UPDATE bg_turnover_logs
     SET bet_amount = bet_amount + ?, effective_amount = effective_amount + ?
     WHERE id = ?`,
    [betDiff, effectiveDiff, log.id],
  )
  await conn.execute(
    `INSERT INTO bg_user_vip_state (user_id, currency, turnover_total) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE turnover_total = turnover_total + VALUES(turnover_total)`,
    [userId, currency, effectiveDiff],
  )
  await fillPendingTurnoverRequirements(conn, userId, currency, Number(log.id), effectiveDiff)
}

export async function reverseBetTurnover(
  db: Pool,
  userId: string,
  roundId: string,
): Promise<void> {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [logs] = await conn.query<RowDataPacket[]>(
      `SELECT tl.id, tl.currency, tl.effective_amount
       FROM bg_turnover_logs tl
       JOIN bg_bet_order bo ON bo.id = tl.bet_order_id
       WHERE bo.user_id = ? AND bo.round_id = ? AND bo.bet_type = 'bet'
         AND tl.is_reversed = 0
       FOR UPDATE`,
      [userId, roundId],
    )

    for (const log of logs) {
      const [allocs] = await conn.query<RowDataPacket[]>(
        `SELECT requirement_id, allocated_amount FROM bg_turnover_allocations WHERE log_id = ?`,
        [log.id],
      )
      for (const alloc of allocs) {
        await conn.execute(
          `UPDATE bg_turnover_requirements
           SET completed_amount = GREATEST(0, completed_amount - ?),
               status = IF(status = 'completed', 'pending', status),
               updated_at = NOW()
           WHERE id = ?`,
          [alloc.allocated_amount, alloc.requirement_id],
        )
      }
      await conn.execute(
        `UPDATE bg_turnover_logs SET is_reversed = 1 WHERE id = ?`,
        [log.id],
      )
      // 总流水累计（迁移151）：冲正同事务减量，保持与 is_reversed=0 口径一致
      await conn.execute(
        `UPDATE bg_user_vip_state SET turnover_total = GREATEST(0, turnover_total - ?)
         WHERE user_id = ? AND currency = ?`,
        [Number(log.effective_amount), userId, log.currency],
      )
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
