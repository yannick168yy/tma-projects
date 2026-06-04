import type { WalletBalance } from '@/types/api'

let balanceCents = 125_000

export async function mockGetBalance(): Promise<WalletBalance> {
  await delay(200)
  return formatBalance(balanceCents)
}

export async function mockCredit(cents: number): Promise<WalletBalance> {
  balanceCents += cents
  return formatBalance(balanceCents)
}

function formatBalance(cents: number): WalletBalance {
  return {
    currency: 'PHP',
    availableCents: cents,
    frozenCents: 0,
    displayPhp: `₱ ${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    balances: [{ currency: 'PHP', available: cents, frozen: 0 }],
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
