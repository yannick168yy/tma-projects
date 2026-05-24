/**
 * Telegram Bot API — createInvoiceLink for Ammer Pay / TG Wallet deposits.
 * @see https://core.telegram.org/bots/api#createinvoicelink
 */

function amountToMinorUnits(amount: number, currency: 'PHP' | 'USDT'): number {
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
    currency: 'PHP' | 'USDT'
    amount: number
  },
): Promise<string> {
  const prices = JSON.stringify([
    { label: input.title, amount: amountToMinorUnits(input.amount, input.currency) },
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
