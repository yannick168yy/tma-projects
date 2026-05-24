import type { PromoHighlight, RedPacketRecord, ReferralRecord } from '@/types/api'

export async function mockGetHighlights(): Promise<PromoHighlight[]> {
  await delay(150)
  const trialClaimed = localStorage.getItem('betogo_trial_claimed')
  const referralReady = localStorage.getItem('betogo_referral_ready') === '1'
  const firstDepReady = localStorage.getItem('betogo_firstdep_ready') === '1'

  return [
    {
      promoId: 'trial',
      highlight: !trialClaimed,
      flagLabel: !trialClaimed ? '₱88' : null,
    },
    {
      promoId: 'referral',
      highlight: referralReady,
      flagLabel: referralReady ? 'Claim' : null,
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

export async function mockClaimReferral(): Promise<{ amountPhp: number }> {
  await delay(500)
  localStorage.setItem('betogo_referral_ready', '0')
  localStorage.setItem('betogo_referral_claimed', '1')
  return { amountPhp: 50 }
}

export async function mockClaimFirstDep(): Promise<{ amountPhp: number }> {
  await delay(500)
  localStorage.setItem('betogo_firstdep_ready', '0')
  return { amountPhp: 1000 }
}

export async function mockReferralRecords(): Promise<ReferralRecord[]> {
  await delay(200)
  return [
    { id: '1', role: 'inviter', displayName: 'J***o', status: 'qualified', rewardPhp: 50 },
    { id: '2', role: 'invitee', displayName: 'You', status: 'claimed', rewardPhp: 30 },
  ]
}

export async function mockRedPacketRecords(): Promise<RedPacketRecord[]> {
  await delay(200)
  const rows: RedPacketRecord[] = []
  if (localStorage.getItem('betogo_trial_claimed')) {
    rows.push({ id: 'rp1', type: 'Trial Officer', amountPhp: 88, createdAt: '2026-05-24 10:00' })
  }
  return rows
}

export function mockSeedReferralReady() {
  localStorage.setItem('betogo_referral_ready', '1')
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
