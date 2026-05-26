import type { DepositCurrency } from '@/types/wallet'

export interface PayMethod {
  id: string
  name: string
  icon: string
  /** Path to a logo image (overrides icon + gradient when provided) */
  iconUrl?: string
  color: string
  tag: string
  /** false = greyed out, not selectable */
  enabled?: boolean
  channelId?: string
  currency?: DepositCurrency
  iconKind?: 'emoji' | 'telegram'
  yfpayChannelCode?: string
  minAmount?: number
  maxAmount?: number
}

/** Telegram Wallet via TON Connect — coming soon */
export const TG_WALLET_DEPOSIT: PayMethod[] = [
  {
    id: 'tg_wallet_php',
    name: 'Telegram Pay',
    icon: '',
    iconUrl: '/logos/telegram.svg',
    color: 'from-[#2AABEE] to-[#229ED9]',
    tag: 'Coming Soon',
    enabled: false,
    channelId: 'tg_wallet',
    currency: 'PHP',
  },
  {
    id: 'tg_wallet_usdt',
    name: 'Telegram Pay',
    icon: '',
    iconUrl: '/logos/telegram.svg',
    color: 'from-cyan-500 to-teal-600',
    tag: 'Coming Soon',
    enabled: false,
    channelId: 'tg_wallet',
    currency: 'USDT',
  },
]

export const FIAT_DEPOSIT: PayMethod[] = [
  { id: 'gcash', name: 'GCash', icon: '', iconUrl: '/logos/gcash.svg', color: 'from-blue-500 to-blue-700', tag: 'Soon', enabled: false },
  { id: 'maya', name: 'Maya', icon: '', iconUrl: '/logos/maya.svg', color: 'from-green-500 to-emerald-600', tag: 'Soon', enabled: false },
]

export const CRYPTO_DEPOSIT: PayMethod[] = [
  { id: 'usdt-trc', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-teal-500 to-emerald-600', tag: 'TRC20', enabled: false },
  { id: 'ton', name: 'TON', icon: '', iconUrl: '/logos/ton.svg', color: 'from-sky-400 to-blue-600', tag: 'TON', enabled: false },
]

export const FIAT_WITHDRAW: PayMethod[] = [
  { id: 'gcash-w', name: 'GCash', icon: '', iconUrl: '/logos/gcash.svg', color: 'from-blue-500 to-blue-700', tag: 'Instant' },
  { id: 'maya-w', name: 'Maya', icon: '', iconUrl: '/logos/maya.svg', color: 'from-green-500 to-emerald-600', tag: 'Instant' },
]

export const CRYPTO_WITHDRAW: PayMethod[] = [
  { id: 'usdt-trc-w', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-teal-500 to-emerald-600', tag: 'TRC20' },
  { id: 'usdt-erc-w', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20' },
  { id: 'ton-w', name: 'TON', icon: '', iconUrl: '/logos/ton.svg', color: 'from-sky-400 to-blue-600', tag: 'TON' },
  { id: 'btc-w', name: 'Bitcoin', icon: '', iconUrl: '/logos/btc.svg', color: 'from-orange-400 to-amber-600', tag: 'BTC' },
]

export const TX_HISTORY = [
  { id: 1, type: 'deposit' as const, method: 'GCash', amount: '+₱ 1,000.00', date: '2025-05-22 14:32', status: 'success' as const },
  { id: 2, type: 'withdraw' as const, method: 'Maya', amount: '−₱ 500.00', date: '2025-05-21 09:15', status: 'success' as const },
  { id: 3, type: 'deposit' as const, method: 'USDT TRC20', amount: '+21.80 USDT', date: '2025-05-20 18:44', status: 'success' as const },
  { id: 4, type: 'withdraw' as const, method: 'GCash', amount: '−₱ 200.00', date: '2025-05-19 11:02', status: 'pending' as const },
  { id: 5, type: 'deposit' as const, method: 'Maya', amount: '+₱ 500.00', date: '2025-05-18 20:11', status: 'success' as const },
  { id: 6, type: 'deposit' as const, method: 'TON', amount: '+5.00 TON', date: '2025-05-17 16:30', status: 'failed' as const },
]

export const WALLET_BANNERS = [
  { gradient: 'from-[#1a0533] via-[#4a0e82] to-[#c0392b]', label: 'FIRST DEPOSIT BONUS', text: '100% up to ₱50,000', icon: '🎁' },
  { gradient: 'from-[#0a2444] via-[#1a4a8a] to-[#0d7b4f]', label: 'ZERO FEE CRYPTO', text: 'Deposit with 0% fees', icon: '💎' },
]
