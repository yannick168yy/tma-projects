/**
 * Telegram Bot API — createInvoiceLink for Ammer Pay / TG Wallet deposits.
 * Ammer Pay accepts Telegram Stars (XTR) as the invoice currency.
 * The Stars amount is derived by dividing the PHP amount by the PHP-per-Star rate.
 * @see https://core.telegram.org/bots/payments#supported-currencies
 */

import type { DepositCurrency } from './deposit.service.js'

/** Ammer Pay invoices must use Telegram Stars (XTR). */
export type TelegramInvoiceCurrency = 'XTR'

export function orderToTelegramInvoice(
  currency: DepositCurrency,
  amount: number,
  usdtToPhpRate: number,
  phpPerStar: number,
): { currency: TelegramInvoiceCurrency; amount: number; descriptionSuffix: string } {
  let phpAmount: number
  if (currency === 'PHP') {
    phpAmount = amount
  } else {
    if (usdtToPhpRate <= 0) throw new Error('USDT exchange rate not configured')
    phpAmount = Math.round(amount * usdtToPhpRate * 100) / 100
    if (phpAmount < 1) throw new Error('Amount too small after USDT conversion')
  }

  if (phpPerStar <= 0) throw new Error('AMMER_PAY_PHP_PER_STAR not configured')
  // Stars are whole integers; round up so the deposit covers the requested PHP amount
  const stars = Math.ceil(phpAmount / phpPerStar)
  if (stars < 1) throw new Error('Amount converts to 0 Stars')

  const descriptionSuffix =
    currency === 'PHP'
      ? `₱${amount.toFixed(2)} (${stars} Stars)`
      : `${amount} USDT ≈ ₱${phpAmount.toFixed(2)} (${stars} Stars)`

  return { currency: 'XTR', amount: stars, descriptionSuffix }
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
  // XTR amounts are in whole Stars; no minor-unit conversion needed
  const prices = JSON.stringify([{ label: input.title, amount: input.amount }])

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
