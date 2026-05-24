import { fetchDepositOrder } from '@/api/deposit'
import { isTelegramWebApp } from '@/api/client'

export type InvoiceCloseStatus = 'paid' | 'cancelled' | 'failed' | 'pending'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Poll BFF until webhook credits the wallet (prod) or dev auto-settle already paid. */
export async function waitForDepositPaid(orderId: string, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const order = await fetchDepositOrder(orderId)
    if (order.status === 'paid') return true
    if (order.status === 'failed' || order.status === 'cancelled') return false
    await sleep(1500)
  }
  return false
}

export function openTelegramInvoice(invoiceLink: string): Promise<InvoiceCloseStatus> {
  if (!isTelegramWebApp()) {
    return Promise.reject(new Error('Open BetoGo inside Telegram to use Telegram Wallet.'))
  }

  const tg = window.Telegram?.WebApp
  if (!tg?.openInvoice) {
    tg?.openLink?.(invoiceLink)
    return Promise.resolve('pending')
  }

  return new Promise((resolve) => {
    tg.openInvoice!(invoiceLink, (status: string) => {
      if (status === 'paid' || status === 'cancelled' || status === 'failed' || status === 'pending') {
        resolve(status as InvoiceCloseStatus)
        return
      }
      resolve('pending')
    })
  })
}
