import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import type { OrderWithdraw } from '../types/domain.js'
import { saveWithdraw } from './store/index.js'
import { executeMatrixWithdrawOrder } from './matrix.service.js'
import { nowIso } from '../utils/format.js'

export interface ApproveResult {
  status: OrderWithdraw['status']
  matrixOrderNo?: string
}

/**
 * 批准提款并出款。管理员人工批准与自动审核共用此路径，避免两份逻辑漂移。
 * - matrix：调 Matrix API 实际链上出款，失败时内部已退款并置 failed，会抛错。
 * - 其他渠道（tg_wallet 等）：直接标记完成。
 * 调用方需自行保证 order.status === 'pending'。
 */
export async function approveWithdraw(
  env: Env,
  redis: Redis,
  order: OrderWithdraw,
): Promise<ApproveResult> {
  if (order.channelId === 'matrix') {
    const matrixOrderNo = await executeMatrixWithdrawOrder(env, redis, order.orderId)
    return { status: 'processing', matrixOrderNo }
  }

  order.status = 'completed'
  order.completedAt = nowIso()
  await saveWithdraw(redis, order)
  return { status: order.status }
}
