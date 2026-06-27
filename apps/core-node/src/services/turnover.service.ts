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
       (user_id, currency, source_type, source_ref, required_amount)
     VALUES (?, ?, 'deposit', ?, ?)`,
    [userId, currency, orderId, amount],
  )
}

export async function allocateBetTurnover(
  db: Pool,
  userId: string,
  betOrderId: number,
  betAmount: number,
  gameUuid: string,
  currency = 'PHP',
): Promise<void> {
  if (betAmount <= 0) return

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await allocateBetTurnoverInTransaction(conn, userId, betOrderId, betAmount, gameUuid, currency)
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export async function allocateBetTurnoverInTransaction(
  conn: PoolConnection,
  userId: string,
  betOrderId: number,
  betAmount: number,
  gameUuid: string,
  currency = 'PHP',
): Promise<void> {
  if (betAmount <= 0) return

  const [[gameRow]] = await conn.query<RowDataPacket[]>(
    `SELECT g.sort_category, COALESCE(r.rate, 1.0) AS rate
     FROM sg_games g
     LEFT JOIN bg_game_turnover_rates r ON r.sort_category = g.sort_category
     WHERE g.uuid = ?`,
    [gameUuid],
  )
  const sortCategory = (gameRow?.sort_category as string | null) ?? null
  const rate = gameRow ? Number(gameRow.rate) : 1.0
  const effectiveAmount = Math.round(betAmount * rate * 10000) / 10000

  if (effectiveAmount <= 0) return

  const [logResult] = await conn.execute<ResultSetHeader>(
    `INSERT INTO bg_turnover_logs
       (user_id, currency, bet_order_id, bet_amount, rate, effective_amount, sort_category)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, currency, betOrderId, betAmount, rate, effectiveAmount, sortCategory],
  )
  const logId = logResult.insertId

  // FIFO：同货币的 pending 要求，按创建时间顺序填满
  const [reqs] = await conn.query<RowDataPacket[]>(
    `SELECT id, required_amount - completed_amount AS remaining
     FROM bg_turnover_requirements
     WHERE user_id = ? AND currency = ? AND status = 'pending'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at ASC
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

export async function reverseBetTurnover(
  db: Pool,
  userId: string,
  roundId: string,
): Promise<void> {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [logs] = await conn.query<RowDataPacket[]>(
      `SELECT tl.id
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
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
