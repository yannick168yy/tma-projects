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
  /** 统一支付路由使用的渠道名（gcash / maya 等） */
  paymentChannelName?: string
  minAmount?: number
  maxAmount?: number
  /** Matrix-specific fields */
  matrixSymbol?: string
  matrixChain?: string
}

/** Telegram Wallet 充值（Telegram Stars / Ammer Pay），仅在 Telegram Mini App 内可用 */
export const TG_WALLET_DEPOSIT: PayMethod[] = [
  {
    id: 'tg_wallet_php',
    name: 'Telegram Pay',
    icon: '',
    iconUrl: '/logos/telegram.svg',
    color: 'from-[#2AABEE] to-[#229ED9]',
    tag: 'Stars',
    enabled: true,
    channelId: 'tg_wallet',
    currency: 'PHP',
  },
  {
    id: 'tg_wallet_usdt',
    name: 'Telegram Pay',
    icon: '',
    iconUrl: '/logos/telegram.svg',
    color: 'from-cyan-500 to-teal-600',
    tag: 'Stars',
    enabled: true,
    channelId: 'tg_wallet',
    currency: 'USDT',
  },
]

export const FIAT_DEPOSIT: PayMethod[] = [
  { id: 'gcash', name: 'GCash', icon: '', iconUrl: '/logos/gcash.svg', color: 'from-blue-500 to-blue-700', tag: 'Instant' },
  { id: 'maya', name: 'Maya', icon: '', iconUrl: '/logos/maya.svg', color: 'from-green-500 to-emerald-600', tag: 'Instant' },
]

export const CRYPTO_DEPOSIT: PayMethod[] = [
  { id: 'matrix_usdt_trc', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-teal-500 to-emerald-600', tag: 'TRC20', currency: 'USDT', enabled: true, channelId: 'matrix', matrixSymbol: 'USDT', matrixChain: 'TRON' },
  { id: 'matrix_usdt_erc', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', currency: 'USDT', enabled: true, channelId: 'matrix', matrixSymbol: 'USDT', matrixChain: 'ETH' },
  { id: 'matrix_usdc_trc', name: 'USDC', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-blue-500 to-sky-600', tag: 'TRC20', currency: 'USDC', enabled: true, channelId: 'matrix', matrixSymbol: 'USDC', matrixChain: 'TRON' },
  { id: 'matrix_usdc_erc', name: 'USDC', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', currency: 'USDC', enabled: true, channelId: 'matrix', matrixSymbol: 'USDC', matrixChain: 'ETH' },
  {
    id: 'matrix_trx_testnet',
    name: 'TRX_TESTNET',
    icon: '',
    iconUrl: '/logos/usdt.svg',
    color: 'from-red-500 to-orange-600',
    tag: 'Test',
    enabled: true,
    channelId: 'matrix',
    matrixSymbol: 'TRX_TESTNET',
    matrixChain: 'TRON_SHASTA',
  },
]

export const FIAT_WITHDRAW: PayMethod[] = [
  { id: 'gcash-w', name: 'GCash', icon: '', iconUrl: '/logos/gcash.svg', color: 'from-blue-500 to-blue-700', tag: 'Instant', currency: 'PHP' },
  { id: 'maya-w', name: 'Maya', icon: '', iconUrl: '/logos/maya.svg', color: 'from-green-500 to-emerald-600', tag: 'Instant', currency: 'PHP' },
]

export const CRYPTO_WITHDRAW: PayMethod[] = [
  { id: 'usdt-trc-w', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-teal-500 to-emerald-600', tag: 'TRC20', currency: 'USDT' },
  { id: 'usdt-erc-w', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', currency: 'USDT' },
  { id: 'usdc-trc-w', name: 'USDC', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-blue-500 to-sky-600', tag: 'TRC20', currency: 'USDC' },
  { id: 'usdc-erc-w', name: 'USDC', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', currency: 'USDC' },
  {
    id: 'matrix_trx_testnet_w',
    name: 'TRX_TESTNET',
    icon: '',
    iconUrl: '/logos/usdt.svg',
    color: 'from-red-500 to-orange-600',
    tag: 'Test',
    enabled: true,
    channelId: 'matrix',
    currency: 'TRX_TESTNET',
    matrixSymbol: 'TRX_TESTNET',
    matrixChain: 'TRON_SHASTA',
  },
]

export const WALLET_BANNERS = [
  { gradient: 'from-[#1a0533] via-[#4a0e82] to-[#c0392b]', label: 'FIRST DEPOSIT BONUS', text: '100% up to ₱50,000', icon: '🎁' },
  { gradient: 'from-[#0a2444] via-[#1a4a8a] to-[#0d7b4f]', label: 'ZERO FEE CRYPTO', text: 'Deposit with 0% fees', icon: '💎' },
]
