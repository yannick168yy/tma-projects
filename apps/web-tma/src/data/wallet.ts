export interface PayMethod {
  id: string
  name: string
  icon: string
  color: string
  tag: string
}

export const FIAT_DEPOSIT: PayMethod[] = [
  { id: 'gcash', name: 'GCash', icon: '💙', color: 'from-blue-500 to-blue-700', tag: 'Instant' },
  { id: 'maya', name: 'Maya', icon: '💚', color: 'from-green-500 to-emerald-600', tag: 'Instant' },
  { id: 'bdo', name: 'BDO Bank', icon: '🏦', color: 'from-blue-800 to-blue-900', tag: '1–3 hrs' },
  { id: 'bpi', name: 'BPI Bank', icon: '🏛️', color: 'from-red-700 to-red-900', tag: '1–3 hrs' },
  { id: '711', name: '7-Eleven', icon: '🏪', color: 'from-orange-500 to-red-600', tag: 'OTC' },
  { id: 'coins', name: 'Coins.ph', icon: '🪙', color: 'from-yellow-500 to-amber-600', tag: 'Instant' },
]

export const CRYPTO_DEPOSIT: PayMethod[] = [
  { id: 'usdt-trc', name: 'USDT', icon: '₮', color: 'from-teal-500 to-emerald-600', tag: 'TRC20' },
  { id: 'usdt-erc', name: 'USDT', icon: '₮', color: 'from-indigo-500 to-blue-700', tag: 'ERC20' },
  { id: 'ton', name: 'TON', icon: '💎', color: 'from-sky-400 to-blue-600', tag: 'TON' },
  { id: 'btc', name: 'Bitcoin', icon: '₿', color: 'from-orange-400 to-amber-600', tag: 'BTC' },
  { id: 'eth', name: 'Ethereum', icon: 'Ξ', color: 'from-purple-500 to-indigo-700', tag: 'ETH' },
  { id: 'bnb', name: 'BNB', icon: '◈', color: 'from-yellow-400 to-yellow-600', tag: 'BEP20' },
]

export const FIAT_WITHDRAW: PayMethod[] = [
  { id: 'gcash-w', name: 'GCash', icon: '💙', color: 'from-blue-500 to-blue-700', tag: 'Instant' },
  { id: 'maya-w', name: 'Maya', icon: '💚', color: 'from-green-500 to-emerald-600', tag: 'Instant' },
  { id: 'bdo-w', name: 'BDO Bank', icon: '🏦', color: 'from-blue-800 to-blue-900', tag: '1–24 hrs' },
  { id: 'bpi-w', name: 'BPI Bank', icon: '🏛️', color: 'from-red-700 to-red-900', tag: '1–24 hrs' },
]

export const CRYPTO_WITHDRAW: PayMethod[] = [
  { id: 'usdt-trc-w', name: 'USDT', icon: '₮', color: 'from-teal-500 to-emerald-600', tag: 'TRC20' },
  { id: 'usdt-erc-w', name: 'USDT', icon: '₮', color: 'from-indigo-500 to-blue-700', tag: 'ERC20' },
  { id: 'ton-w', name: 'TON', icon: '💎', color: 'from-sky-400 to-blue-600', tag: 'TON' },
  { id: 'btc-w', name: 'Bitcoin', icon: '₿', color: 'from-orange-400 to-amber-600', tag: 'BTC' },
]

export const TX_HISTORY = [
  { id: 1, type: 'deposit' as const, method: 'GCash', amount: '+₱ 1,000.00', date: '2025-05-22 14:32', status: 'success' as const },
  { id: 2, type: 'withdraw' as const, method: 'BDO Bank', amount: '−₱ 500.00', date: '2025-05-21 09:15', status: 'success' as const },
  { id: 3, type: 'deposit' as const, method: 'USDT TRC20', amount: '+21.80 USDT', date: '2025-05-20 18:44', status: 'success' as const },
  { id: 4, type: 'withdraw' as const, method: 'GCash', amount: '−₱ 200.00', date: '2025-05-19 11:02', status: 'pending' as const },
  { id: 5, type: 'deposit' as const, method: 'Maya', amount: '+₱ 500.00', date: '2025-05-18 20:11', status: 'success' as const },
  { id: 6, type: 'deposit' as const, method: 'TON', amount: '+5.00 TON', date: '2025-05-17 16:30', status: 'failed' as const },
]

export const WALLET_BANNERS = [
  { gradient: 'from-[#1a0533] via-[#4a0e82] to-[#c0392b]', label: 'FIRST DEPOSIT BONUS', text: '100% up to ₱50,000', icon: '🎁' },
  { gradient: 'from-[#0a2444] via-[#1a4a8a] to-[#0d7b4f]', label: 'ZERO FEE CRYPTO', text: 'Deposit with 0% fees', icon: '💎' },
]
