export interface Promo {
  id: string
  tag: string
  title: string
  tagline: string
  reward: string
  rewardLabel: string
  desc: string
  gradient: string
  accentColor: string
  icon: string
  steps: string[]
  badge: string
  badgeColor: string
  cta: string
  ctaColor: string
  expiry: string
  highlight: boolean
}

export const PROMOS: Promo[] = [
  {
    id: 'trial',
    tag: 'NEW PLAYER',
    title: 'Chief Trial Officer',
    tagline: 'Register & Play for Free',
    reward: '₱ 88',
    rewardLabel: 'Free Bonus',
    desc: 'Brand-new players get ₱88 in free credits upon first registration — no deposit required. Start exploring all our games risk-free!',
    gradient: 'from-[#1a0060] via-[#4a0e82] to-[#8B2FC9]',
    accentColor: '#c084fc',
    icon: '🎖️',
    steps: ['Register a new account', 'Receive ₱88 bonus instantly'],
    badge: 'No Deposit',
    badgeColor: 'bg-purple-400/20 text-purple-300',
    cta: 'Claim Now',
    ctaColor: 'bg-purple-500 hover:bg-purple-400',
    expiry: 'Ongoing',
    highlight: true,
  },
  {
    id: 'referral',
    tag: 'REFERRAL',
    title: 'Invite & Earn Together',
    tagline: 'Both You & Your Friend Win',
    reward: '₱50 / ₱30',
    rewardLabel: 'Inviter / Invitee',
    desc: 'Invite a friend to TarsierWin. When they register and make their first deposit, you get ₱50 and your friend gets ₱30 — unlimited referrals!',
    gradient: 'from-[#064e3b] via-[#065f46] to-[#047857]',
    accentColor: '#34d399',
    icon: '🤝',
    steps: ['Share your referral link', 'Friend registers & deposits', 'Both receive bonus'],
    badge: 'Unlimited',
    badgeColor: 'bg-emerald-400/20 text-emerald-300',
    cta: 'Share Link',
    ctaColor: 'bg-emerald-500 hover:bg-emerald-400',
    expiry: 'Ongoing',
    highlight: false,
  },
  {
    id: 'firstdep',
    tag: 'FIRST DEPOSIT',
    title: 'First Deposit Fiesta',
    tagline: '100% Match Bonus',
    reward: '120%',
    rewardLabel: 'Up to ₱1,000',
    desc: 'Make your first deposit and we will top it up by 120% — up to ₱1,000 bonus credited instantly. Minimum deposit ₱100 to qualify.',
    gradient: 'from-[#7c2d12] via-[#c0392b] to-[#e85d04]',
    accentColor: '#fbbf24',
    icon: '💰',
    steps: ['Make your first deposit (min ₱100)', 'Bonus credited within 5 minutes', 'Wager 15x to withdraw'],
    badge: '120% Match',
    badgeColor: 'bg-amber-400/20 text-amber-300',
    cta: 'Deposit Now',
    ctaColor: 'bg-amber-500 hover:bg-amber-400',
    expiry: 'Limited Time',
    highlight: false,
  },
]

export const BONUS_WINNERS = [
  { name: 'J***n', promo: 'Chief Trial Officer', amount: '₱88' },
  { name: 'M***a', promo: 'First Deposit Fiesta', amount: '₱1,000' },
  { name: 'R***o', promo: 'Invite & Earn', amount: '₱500' },
  { name: 'C***e', promo: 'First Deposit Fiesta', amount: '₱1,000' },
  { name: 'A***y', promo: 'Invite & Earn', amount: '₱1,500' },
]

export const PROMO_STATS = [
  { label: 'Total Distributed', value: '₱4.2M+', icon: '💎' },
  { label: 'Active Promos', value: '3', icon: '🎯' },
  { label: 'Winners Today', value: '128', icon: '🏆' },
]
