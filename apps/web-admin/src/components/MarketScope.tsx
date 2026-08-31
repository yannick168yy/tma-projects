import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Segmented } from 'antd'

export type AdminMarketScope = 'ALL' | 'PH' | 'ID'

const STORAGE_KEY = 'admin_market_scope'

interface MarketScopeValue {
  market: AdminMarketScope
  setMarket: (market: AdminMarketScope) => void
  currency: 'ALL' | 'PHP' | 'IDR'
  unit: 'USDT' | 'PHP' | 'IDR'
  timezone: 'UTC+8' | 'UTC+7'
}

const MarketScopeContext = createContext<MarketScopeValue | null>(null)

export function AdminMarketProvider({ children }: { children: ReactNode }) {
  const [market, setMarketState] = useState<AdminMarketScope>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'PH' || saved === 'ID' ? saved : 'ALL'
  })
  const value = useMemo<MarketScopeValue>(() => ({
    market,
    setMarket: (next) => { localStorage.setItem(STORAGE_KEY, next); setMarketState(next) },
    currency: market === 'PH' ? 'PHP' : market === 'ID' ? 'IDR' : 'ALL',
    unit: market === 'PH' ? 'PHP' : market === 'ID' ? 'IDR' : 'USDT',
    timezone: market === 'ID' ? 'UTC+7' : 'UTC+8',
  }), [market])
  return <MarketScopeContext.Provider value={value}>{children}</MarketScopeContext.Provider>
}

export function useMarketScope(): MarketScopeValue {
  const value = useContext(MarketScopeContext)
  if (!value) throw new Error('useMarketScope must be used inside AdminMarketProvider')
  return value
}

export function MarketScopeSelector() {
  const { market, setMarket } = useMarketScope()
  return (
    <Segmented
      size="small"
      value={market}
      onChange={(value) => setMarket(value as AdminMarketScope)}
      options={[
        { label: '综合', value: 'ALL' },
        { label: '菲律宾 ₱', value: 'PH' },
        { label: '印尼 Rp', value: 'ID' },
      ]}
    />
  )
}

export function formatMarketAmount(value: number, unit: string): string {
  const amount = Math.round(value).toLocaleString('en-US')
  if (unit === 'PHP') return `₱${amount}`
  if (unit === 'IDR') return `Rp ${amount}`
  return `USDT ${amount}`
}
