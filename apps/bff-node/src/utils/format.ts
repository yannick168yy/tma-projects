export function formatPhp(amount: number): string {
  return `₱ ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function phpToCents(amountPhp: number): number {
  return Math.round(amountPhp * 100)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function formatDisplayTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
