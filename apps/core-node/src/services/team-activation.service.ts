import type { PoolConnection } from 'mysql2/promise'

export async function tryActivateTeamNode(
  conn: PoolConnection,
  userId: string,
  creditedAmount: number,
  currency = 'PHP',
): Promise<void> {
  const activationCurrency = currency === 'IDR' ? 'IDR' : 'PHP'
  await conn.execute(
    `UPDATE bg_team_node tn
     SET tn.activated = 1,
         tn.activation_cents = ROUND(? * 100),
         tn.activation_currency = ?,
         tn.activated_at = NOW(3)
     WHERE tn.user_id = ?
       AND tn.activated = 0
       AND ROUND(? * 100) >= (
         SELECT CASE WHEN ? = 'IDR' THEN min_activation_idr_cents ELSE min_activation_cents END
         FROM bg_team_config WHERE id = 1 LIMIT 1
       )`,
    [creditedAmount, activationCurrency, userId, creditedAmount, activationCurrency],
  )
}
