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
  { id: 'gcash', name: 'GCash', icon: '', iconUrl: '/logos/gcash.svg', color: 'from-blue-500 to-blue-700', tag: 'Instant', currency: 'PHP' },
  { id: 'maya', name: 'Maya', icon: '', iconUrl: '/logos/maya.svg', color: 'from-green-500 to-emerald-600', tag: 'Instant', currency: 'PHP' },
  { id: 'gotyme', name: 'GoTyme', icon: '', iconUrl: '/logos/gotyme.svg', color: 'from-teal-500 to-cyan-600', tag: 'Instant', currency: 'PHP' },
  { id: 'bri', name: 'BRI', icon: 'BRI', color: 'from-blue-600 to-sky-700', tag: 'Bank', currency: 'IDR' },
  { id: 'bca', name: 'BCA', icon: 'BCA', color: 'from-indigo-600 to-blue-800', tag: 'Bank', currency: 'IDR' },
  { id: 'bni', name: 'BNI', icon: 'BNI', color: 'from-orange-500 to-cyan-700', tag: 'Bank', currency: 'IDR' },
  { id: 'mandiri', name: 'Mandiri', icon: 'MDR', color: 'from-yellow-500 to-blue-700', tag: 'Bank', currency: 'IDR' },
  { id: 'dana', name: 'DANA', icon: 'D', color: 'from-sky-500 to-blue-700', tag: 'Wallet', currency: 'IDR' },
  { id: 'ovo', name: 'OVO', icon: 'O', color: 'from-violet-500 to-purple-700', tag: 'Wallet', currency: 'IDR' },
  { id: 'gopay', name: 'GoPay', icon: 'G', color: 'from-cyan-500 to-blue-700', tag: 'Wallet', currency: 'IDR' },
  { id: 'shopeepay', name: 'ShopeePay', icon: 'S', color: 'from-orange-500 to-red-600', tag: 'Wallet', currency: 'IDR' },
  { id: 'qris', name: 'QRIS', icon: 'QR', color: 'from-red-500 to-slate-700', tag: 'QRIS', currency: 'IDR' },
]

export const CRYPTO_DEPOSIT: PayMethod[] = [
  // USDT：TRON(TRC20) 与 ETHEREUM(ERC20) 均已实测能出真实地址
  { id: 'matrix_usdt_trc', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-teal-500 to-emerald-600', tag: 'TRC20', currency: 'USDT', enabled: true, channelId: 'matrix', matrixSymbol: 'USDT', matrixChain: 'TRON' },
  { id: 'matrix_usdt_erc', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', currency: 'USDT', enabled: true, channelId: 'matrix', matrixSymbol: 'USDT', matrixChain: 'ETHEREUM' },
  // USDC：TRON(TRC20) 与 ETHEREUM(ERC20) 均已实测能出真实地址
  { id: 'matrix_usdc_trc', name: 'USDC', icon: '', iconUrl: '/logos/usdc.svg', color: 'from-blue-500 to-sky-600', tag: 'TRC20', currency: 'USDC', enabled: true, channelId: 'matrix', matrixSymbol: 'USDC', matrixChain: 'TRON' },
  { id: 'matrix_usdc_erc', name: 'USDC', icon: '', iconUrl: '/logos/usdc.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', currency: 'USDC', enabled: true, channelId: 'matrix', matrixSymbol: 'USDC', matrixChain: 'ETHEREUM' },
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
  { id: 'gotyme-w', name: 'GoTyme', icon: '', iconUrl: '/logos/gotyme.svg', color: 'from-teal-500 to-cyan-600', tag: 'Instant', currency: 'PHP' },
  { id: 'bri-w', name: 'BRI', icon: 'BRI', color: 'from-blue-600 to-sky-700', tag: 'Bank', currency: 'IDR' },
  { id: 'bca-w', name: 'BCA', icon: 'BCA', color: 'from-indigo-600 to-blue-800', tag: 'Bank', currency: 'IDR' },
  { id: 'bni-w', name: 'BNI', icon: 'BNI', color: 'from-orange-500 to-cyan-700', tag: 'Bank', currency: 'IDR' },
  { id: 'mandiri-w', name: 'Mandiri', icon: 'MDR', color: 'from-yellow-500 to-blue-700', tag: 'Bank', currency: 'IDR' },
  { id: 'dana-w', name: 'DANA', icon: 'D', color: 'from-sky-500 to-blue-700', tag: 'Wallet', currency: 'IDR' },
  { id: 'ovo-w', name: 'OVO', icon: 'O', color: 'from-violet-500 to-purple-700', tag: 'Wallet', currency: 'IDR' },
  { id: 'gopay-w', name: 'GoPay', icon: 'G', color: 'from-cyan-500 to-blue-700', tag: 'Wallet', currency: 'IDR' },
  { id: 'shopeepay-w', name: 'ShopeePay', icon: 'S', color: 'from-orange-500 to-red-600', tag: 'Wallet', currency: 'IDR' },
]

export const CRYPTO_WITHDRAW: PayMethod[] = [
  { id: 'usdt-trc-w', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-teal-500 to-emerald-600', tag: 'TRC20', enabled: true, channelId: 'matrix', currency: 'USDT', matrixSymbol: 'USDT', matrixChain: 'TRON' },
  { id: 'usdt-erc-w', name: 'USDT', icon: '', iconUrl: '/logos/usdt.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', enabled: true, channelId: 'matrix', currency: 'USDT', matrixSymbol: 'USDT', matrixChain: 'ETHEREUM' },
  { id: 'usdc-trc-w', name: 'USDC', icon: '', iconUrl: '/logos/usdc.svg', color: 'from-blue-500 to-sky-600', tag: 'TRC20', enabled: true, channelId: 'matrix', currency: 'USDC', matrixSymbol: 'USDC', matrixChain: 'TRON' },
  { id: 'usdc-erc-w', name: 'USDC', icon: '', iconUrl: '/logos/usdc.svg', color: 'from-indigo-500 to-blue-700', tag: 'ERC20', enabled: true, channelId: 'matrix', currency: 'USDC', matrixSymbol: 'USDC', matrixChain: 'ETHEREUM' },
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
