import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { getPromoConfig } from '../promo-config.service.js'
import { getTurnoverProgress } from '../turnover.service.js'
import { isHumanOnDuty } from './cs-duty.js'
import { queryRecentOrders, type CsOrder } from './cs-orders.js'
import {
  escalateConversation,
  getConversationById,
  getOrCreateConversation,
  saveMessage,
} from './cs-store.js'

export interface DeterministicCsResult {
  reply: string
  conversationId: number
  status: string
}

const DEPOSIT_INTENTS = new Set([
  'deposit_not_credited',
  'deposit_amount_wrong',
  'deposit_status',
  'deposit_method_limit',
])

const WITHDRAWAL_INTENTS = new Set([
  'withdrawal_status',
  'withdrawal_rejected',
  'withdrawal_amount_wrong',
  'withdrawal_arrival_time',
])

const CANNOT_WITHDRAW_INTENTS = new Set([
  'cannot_withdraw',
  'cannot_withdraw_kyc',
  'cannot_withdraw_turnover',
  'cannot_withdraw_pending',
])

const KYC_INTENTS = new Set([
  'kyc_help',
  'kyc_phone_issue',
  'kyc_document_issue',
  'kyc_face_issue',
  'kyc_rejected_reason',
])

const PROMO_INTENTS = new Set([
  'promotions',
  'promo_first_deposit',
  'promo_trial',
  'promo_reward_missing',
  'promo_rules',
])

const GAME_INTENTS = new Set([
  'game_issue',
  'game_cannot_open',
  'game_crashed',
  'game_settlement_issue',
  'game_missing',
  'game_maintenance',
])

const ACCOUNT_GUIDE_INTENTS = new Set([
  'account_issue',
  'account_login_issue',
  'account_bind_issue',
])

const HUMAN_REASON_BY_INTENT: Record<string, 'user_request' | 'money_dispute' | 'account_security' | 'complaint'> = {
  human_agent: 'user_request',
  human_complaint: 'complaint',
  human_money_dispute: 'money_dispute',
  human_account_security: 'account_security',
  account_frozen: 'account_security',
  account_security: 'account_security',
}

const DETERMINISTIC_INTENTS = new Set([
  ...DEPOSIT_INTENTS,
  ...WITHDRAWAL_INTENTS,
  ...CANNOT_WITHDRAW_INTENTS,
  ...KYC_INTENTS,
  ...PROMO_INTENTS,
  ...GAME_INTENTS,
  ...ACCOUNT_GUIDE_INTENTS,
  ...Object.keys(HUMAN_REASON_BY_INTENT),
])

function isGuest(userId: string): boolean {
  return userId.startsWith('guest:')
}

function canGuestUseIntent(intent: string): boolean {
  return intent === 'deposit_method_limit'
    || PROMO_INTENTS.has(intent)
    || GAME_INTENTS.has(intent)
    || ACCOUNT_GUIDE_INTENTS.has(intent)
    || Boolean(HUMAN_REASON_BY_INTENT[intent])
}

function money(amount: number, currency = 'PHP'): string {
  if (currency === 'PHP') return `₱${amount.toFixed(2)}`
  return `${amount.toFixed(2)} ${currency}`
}

function orderLine(order: CsOrder, kind: 'deposit' | 'withdraw'): string {
  const action = kind === 'deposit' ? 'deposit' : 'withdrawal'
  if (order.state === 'success') return `Your latest ${action} ${order.orderId} for ${order.amount} ${order.currency} is completed.`
  if (order.state === 'pending') return `Your latest ${action} ${order.orderId} for ${order.amount} ${order.currency} is still processing.`
  const reason = order.rejectReason ? ` Reason: ${order.rejectReason}` : ''
  return `Your latest ${action} ${order.orderId} for ${order.amount} ${order.currency} was not successful.${reason}`
}

async function getKycRow(env: Env, userId: string): Promise<RowDataPacket | null> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT status, phone_verified, doc_verified, face_verified, reject_reason, reject_step, doc_submitted_at, face_submitted_at
     FROM bg_kyc WHERE user_id = ? LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}

function kycReply(row: RowDataPacket | null): string {
  if (!row || row.status === 'none') {
    return 'KYC verification has not been started yet. Please open KYC Setting and complete phone verification, then upload your ID and face photo if requested.'
  }
  if (row.status === 'approved') {
    return 'Your KYC verification is already approved! You have successfully completed the process.'
  }
  if (row.status === 'rejected') {
    const reason = row.reject_reason ? ` Reason: ${row.reject_reason}.` : ''
    return `Your KYC verification was rejected.${reason} Please open KYC Setting, fix the issue, and submit it again.`
  }
  if (!row.phone_verified) {
    return 'Your KYC verification is pending. Please complete phone verification in KYC Setting first.'
  }
  if (row.doc_submitted_at || row.face_submitted_at) {
    return 'Your KYC verification is under review. Please wait for the review result in KYC Setting.'
  }
  return 'Your phone verification is complete. Please continue the remaining KYC steps in KYC Setting.'
}

async function cannotWithdrawReply(env: Env, userId: string): Promise<string> {
  const kyc = await getKycRow(env, userId)
  if (!kyc || kyc.status !== 'approved') return `You cannot withdraw yet because KYC is not approved. ${kycReply(kyc)}`

  const turnover = await getTurnoverProgress(getMysqlPool(env), userId)
  if (!turnover.canWithdraw) {
    const pending = turnover.requirements.filter((r) => r.status === 'pending')
    const first = pending[0]
    const detail = first
      ? ` Latest requirement: ${money(first.requiredAmount - first.completedAmount, first.currency)} remaining from ${first.sourceType}.`
      : ''
    return `You still need to complete wagering requirements before withdrawing. Total remaining: ${money(turnover.totalRemaining)}.${detail}`
  }

  const withdrawals = await queryRecentOrders(env, userId, 'withdraw')
  const latest = withdrawals[0]
  if (latest?.state === 'pending') return `${orderLine(latest, 'withdraw')} Please wait for the review result.`
  if (latest?.state === 'failed') return orderLine(latest, 'withdraw')
  return 'Your KYC is approved and your wagering requirements are complete. If you still cannot withdraw, please check your balance, withdrawal amount, and payment channel.'
}

async function promotionsReply(env: Env): Promise<string> {
  const cfg = await getPromoConfig(env)
  const lines: string[] = []
  if (cfg.trial.enabled) lines.push(`Free trial bonus: ${money(cfg.trial.amount)}, wagering ${cfg.trial.turnoverX}x.`)
  if (cfg.firstdep.enabled) {
    const tier = cfg.firstdep.tiers.PHP?.[0]
    const tierText = tier ? ` from deposit ${money(tier.depositAmount)} get ${money(tier.bonusAmount)}` : ''
    lines.push(`First deposit bonus is available${tierText}, wagering ${cfg.firstdep.turnoverX}x.`)
  }
  if (cfg.appdl.enabled) lines.push(`App download bonus: ${money(cfg.appdl.amount)}, wagering ${cfg.appdl.turnoverX}x.`)
  if (cfg.redep.enabled) lines.push(`Reload offer: deposit from ${money(cfg.redep.minDeposit)} to get ${money(cfg.redep.bonusAmount)}.`)
  if (cfg.lossRebate.enabled) lines.push(`Cashback: ${cfg.lossRebate.ratePct}% on eligible net loss.`)

  const [spinRows] = await getMysqlPool(env).query<RowDataPacket[]>(`SELECT enabled FROM bg_spin_config LIMIT 1`)
  if (spinRows[0]?.enabled === 1) lines.push('Rewards Spin is available for eligible deposits.')

  if (lines.length === 0) return 'There are no active promotions right now. Please check the Bonuses page later.'
  return `Current promotions:\n${lines.map((line) => `- ${line}`).join('\n')}\nOpen the Bonuses page for full details and eligibility.`
}

async function depositReply(env: Env, userId: string): Promise<string> {
  const orders = await queryRecentOrders(env, userId, 'deposit')
  const latest = orders[0]
  if (!latest) return 'No recent deposit order was found. Please make sure the payment was submitted successfully.'
  return orderLine(latest, 'deposit')
}

async function withdrawalReply(env: Env, userId: string): Promise<string> {
  const orders = await queryRecentOrders(env, userId, 'withdraw')
  const latest = orders[0]
  if (!latest) return 'No recent withdrawal order was found. You can submit a withdrawal from the Wallet page.'
  return orderLine(latest, 'withdraw')
}

function depositGuideReply(): string {
  return 'Please open Wallet > Deposit to see live deposit methods and exact limits. Available channels and minimum amounts may change by payment provider.'
}

function gameGuideReply(intent: string): string {
  if (intent === 'game_settlement_issue') return 'Please send the game name, bet time, round/order id, and what result you expected. Keep screenshots if balance or settlement is affected.'
  if (intent === 'game_missing' || intent === 'game_maintenance') return 'Please send the game name or provider. I can help check whether it is available or under maintenance.'
  return 'Please send the game name and what happened, for example: cannot load, game crashed, missing settlement, or cannot find the game.'
}

function accountGuideReply(intent: string): string {
  if (intent === 'account_login_issue') return 'Please tell me which login method failed and what error you saw. You can also try reopening the Telegram Mini App and checking your network first.'
  if (intent === 'account_bind_issue') return 'Please tell me which binding has an issue: Telegram, Google, or phone. Include the error message if one appears.'
  return 'Please describe the account or login issue, for example: cannot log in, account frozen, phone verification, or suspected account theft.'
}

export async function handleDeterministicCsIntent(
  env: Env,
  userId: string,
  intent: string,
  userText: string,
): Promise<DeterministicCsResult | null> {
  if (!DETERMINISTIC_INTENTS.has(intent)) return null

  const conversation = await getOrCreateConversation(env, userId)
  const conversationId = conversation.id

  if (conversation.status === 'human_taken') {
    await saveMessage(env, conversationId, 'user', userText)
    const reply = 'A human agent is handling this conversation and will reply here shortly. Please wait a moment.'
    return { reply, conversationId, status: 'human_taken' }
  }

  await saveMessage(env, conversationId, 'user', userText)

  let reply: string
  let status: string = conversation.status

  if (isGuest(userId) && !canGuestUseIntent(intent)) {
    reply = 'Please log in first so I can check your account information.'
  } else if (DEPOSIT_INTENTS.has(intent)) {
    reply = intent === 'deposit_method_limit' ? depositGuideReply() : await depositReply(env, userId)
  } else if (WITHDRAWAL_INTENTS.has(intent)) {
    reply = await withdrawalReply(env, userId)
  } else if (CANNOT_WITHDRAW_INTENTS.has(intent)) {
    reply = await cannotWithdrawReply(env, userId)
  } else if (KYC_INTENTS.has(intent)) {
    reply = kycReply(await getKycRow(env, userId))
  } else if (PROMO_INTENTS.has(intent)) {
    reply = await promotionsReply(env)
  } else if (GAME_INTENTS.has(intent)) {
    reply = gameGuideReply(intent)
  } else if (ACCOUNT_GUIDE_INTENTS.has(intent)) {
    reply = accountGuideReply(intent)
  } else if (HUMAN_REASON_BY_INTENT[intent]) {
    const onDuty = await isHumanOnDuty(env)
    const toStatus = onDuty ? 'human_taken' : 'escalated'
    status = toStatus
    await escalateConversation(env, conversationId, HUMAN_REASON_BY_INTENT[intent], toStatus)
    reply = onDuty
      ? 'A human agent is online and will reply here shortly. Please wait in this chat.'
      : `No human agent is online right now. I have recorded this as ticket #${conversationId}, and an agent will follow up here as soon as one is available.`
  } else {
    return null
  }

  await saveMessage(env, conversationId, status === 'human_taken' ? 'admin' : 'assistant', reply)
  const latest = await getConversationById(env, conversationId)
  return { reply, conversationId, status: latest?.status ?? status }
}
