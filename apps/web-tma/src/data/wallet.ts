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
  /** Matrix-specific fields */
  matrixSymbol?: string
  matrixChain?: string
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
  { id: 'gcash', name: 'GCash', icon: '', iconUrl: '/logos/gcash.svg', color: 'from-blue-500 to-blue-700', tag: 'Instant' },
  { id: 'maya', name: 'Maya', icon: '', iconUrl: '/logos/maya.svg', color: 'from-green-500 to-emerald-600', tag: 'Instant' },
]

export const CRYPTO_DEPOSIT: PayMethod[] = [
  { id: 'usdt-trc', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-teal-500 to-emerald-600', tag: 'TRC20', enabled: false },
  {
    id: 'ton',
    name: 'TON',
    icon: '',
    iconUrl: '/logos/ton.svg',
    color: 'from-sky-400 to-blue-600',
    tag: 'TON Connect',
    enabled: true,
    channelId: 'ton_connect',
    currency: 'TON',
  },
  {
    id: 'matrix_trx_shasta',
    name: 'TRX',
    icon: 'T',
    color: 'from-red-500 to-rose-700',
    tag: 'TRON_SHASTA',
    enabled: true,
    channelId: 'matrix',
    matrixSymbol: 'TRX',
    matrixChain: 'TRON_SHASTA',
  },
  {
    id: 'matrix_trx_testnet',
    name: 'TRX',
    icon: 'T',
    color: 'from-orange-500 to-red-600',
    tag: 'TRX_TESTNET',
    enabled: true,
    channelId: 'matrix',
    matrixSymbol: 'TRX',
    matrixChain: 'TRX_TESTNET',
  },
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
  {
    id: 'matrix_trx_shasta_w',
    name: 'TRX',
    icon: 'T',
    color: 'from-red-500 to-rose-700',
    tag: 'TRON_SHASTA',
    enabled: true,
    channelId: 'matrix',
    matrixSymbol: 'TRX',
    matrixChain: 'TRON_SHASTA',
  },
  {
    id: 'matrix_trx_testnet_w',
    name: 'TRX',
    icon: 'T',
    color: 'from-orange-500 to-red-600',
    tag: 'TRX_TESTNET',
    enabled: true,
    channelId: 'matrix',
    matrixSymbol: 'TRX',
    matrixChain: 'TRX_TESTNET',
  },
]

export const WALLET_BANNERS = [
  { gradient: 'from-[#1a0533] via-[#4a0e82] to-[#c0392b]', label: 'FIRST DEPOSIT BONUS', text: '100% up to ₱50,000', icon: '🎁' },
  { gradient: 'from-[#0a2444] via-[#1a4a8a] to-[#0d7b4f]', label: 'ZERO FEE CRYPTO', text: 'Deposit with 0% fees', icon: '💎' },
]
