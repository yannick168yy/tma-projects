import type { PromoHighlight, RedPacketRecord } from '@/types/api'

export async function mockGetHighlights(): Promise<PromoHighlight[]> {
  await delay(150)
  const trialClaimed = localStorage.getItem('betogo_trial_claimed')
  const firstDepReady = localStorage.getItem('betogo_firstdep_ready') === '1'

  return [
    {
      promoId: 'trial',
      highlight: !trialClaimed,
      flagLabel: !trialClaimed ? '₱88' : null,
    },
    {
      promoId: 'firstdep',
      highlight: firstDepReady,
      flagLabel: firstDepReady ? '120%' : null,
    },
  ]
}

export async function mockClaimTrial(): Promise<{ amountPhp: number }> {
  await delay(500)
  localStorage.setItem('betogo_trial_claimed', '1')
  return { amountPhp: 88 }
}

export async function mockClaimFirstDep(): Promise<{ amountPhp: number }> {
  await delay(500)
  localStorage.setItem('betogo_firstdep_ready', '0')
  return { amountPhp: 1000 }
}

export async function mockRedPacketRecords(): Promise<RedPacketRecord[]> {
  await delay(200)
  const rows: RedPacketRecord[] = []
  if (localStorage.getItem('betogo_trial_claimed')) {
    rows.push({ id: 'rp1', type: 'Trial Officer', amountPhp: 88, createdAt: '2026-05-24 10:00' })
  }
  return rows
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
