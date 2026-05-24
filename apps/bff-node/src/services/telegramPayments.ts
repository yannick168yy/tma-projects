/**
 * Telegram Bot API — createInvoiceLink for Ammer Pay / TG Wallet deposits.
 * Only ISO 4217 codes are valid (e.g. PHP). USDT must be converted to PHP for the invoice.
 * @see https://core.telegram.org/bots/payments#supported-currencies
 */

import type { DepositCurrency } from './deposit.service.js'

/** Telegram / Ammer Pay invoice currency (ISO 4217). */
export type TelegramInvoiceCurrency = 'PHP'

export function orderToTelegramInvoice(
  currency: DepositCurrency,
  amount: number,
  usdtToPhpRate: number,
): { currency: TelegramInvoiceCurrency; amount: number; descriptionSuffix: string } {
  if (currency === 'PHP') {
    return { currency: 'PHP', amount, descriptionSuffix: `₱${amount.toFixed(2)}` }
  }
  if (usdtToPhpRate <= 0) throw new Error('USDT exchange rate not configured')
  const phpAmount = Math.round(amount * usdtToPhpRate * 100) / 100
  if (phpAmount < 1) throw new Error('Amount too small after USDT conversion')
  return {
    currency: 'PHP',
    amount: phpAmount,
    descriptionSuffix: `${amount} USDT (≈ ₱${phpAmount.toFixed(2)})`,
  }
}

function amountToMinorUnits(amount: number): number {
  const n = Math.round(amount * 100)
  if (n < 1) throw new Error('Amount too small')
  return n
}

export async function createTelegramInvoiceLink(
  botToken: string,
  providerToken: string,
  input: {
    title: string
    description: string
    payload: string
    currency: TelegramInvoiceCurrency
    amount: number
  },
): Promise<string> {
  const prices = JSON.stringify([
    { label: input.title, amount: amountToMinorUnits(input.amount) },
  ])

  const body = new URLSearchParams({
    title: input.title,
    description: input.description,
    payload: input.payload,
    provider_token: providerToken,
    currency: input.currency,
    prices,
  })

  const res = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = (await res.json()) as { ok: boolean; result?: string; description?: string }
  if (!data.ok || !data.result) {
    throw new Error(data.description ?? 'Failed to create Telegram invoice link')
  }
  return data.result
}
