import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, TrendingUp, Info } from 'lucide-react'
import { fetchRebateConfig, fetchRebateSummary, type RebateConfig, type RebateSummary } from '@/api/rebate'
import { fetchGames, launchGame, type SlotGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import GameCard from '@/components/home/GameCard'
import { ApiError } from '@/api/client'

type DateTab = 'today' | 'yesterday'

const CATEGORY_ICONS: Record<string, string> = {
  slots: '🎰', live: '🎲', sports: '⚽', fishing: '🐟',
  table: '🃏', bingo: '🎱', crash: '🚀', pinoy: '🐓', other: '🎮',
}

const TIER_GRADIENTS: Record<string, string> = {
  elite: 'from-amber-500 to-yellow-400',
  pro: 'from-blue-500 to-cyan-400',
}

interface Props {
  onOpenGame: (url: string) => void
}

function phpStr(v: number) {
  return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export default function CashbackPage({ onOpenGame }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const currency = activeCurrency === 'PHP' ? 'PHP' : 'PHP'

  const [activeTab, setActiveTab] = useState<DateTab>('today')
  const [config, setConfig] = useState<RebateConfig | null>(null)
  const [summary, setSummary] = useState<RebateSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [tierGames, setTierGames] = useState<Record<string, SlotGame[]>>({})
  const [expandedTier, setExpandedTier] = useState<string | null>(null)
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  void launchingUuid // 保留，后续可扩展 loading 状态展示

  useEffect(() => {
    fetchRebateConfig().then(setConfig).catch(() => null)
  }, [])

  const loadSummary = useCallback(async (tab: DateTab) => {
    if (!token) return
    setSummaryLoading(true)
    try {
      const s = await fetchRebateSummary(tab, currency)
      setSummary(s)
    } catch {
      setSummary(null)
    } finally {
      setSummaryLoading(false)
    }
  }, [token, currency])

  useEffect(() => { void loadSummary(activeTab) }, [activeTab, loadSummary])

  async function loadTierGames(tier: string) {
    const uuids = (config?.featured[tier] ?? []).map((g) => g.gameUuid)
    if (!uuids.length || tierGames[tier]) return
    try {
      // 通过 provider 查找精选游戏列表（通过 uuid 精确搜索）
      const promises = uuids.slice(0, 12).map((uuid) =>
        fetchGames({ search: uuid, limit: 1 }).then((r) => r.items[0]).catch(() => null)
      )
      const results = (await Promise.all(promises)).filter((g): g is SlotGame => g !== null)
      setTierGames((prev) => ({ ...prev, [tier]: results }))
    } catch { /* ignore */ }
  }

  function toggleTier(tier: string) {
    if (expandedTier === tier) { setExpandedTier(null); return }
    setExpandedTier(tier)
    void loadTierGames(tier)
  }

  async function onGameTap(uuid: string) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (launchingUuid) return
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchGame(uuid, 'mobile', activeCurrency)
      onOpenGame(url)
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Launch failed') }
    finally { setLaunchingUuid(null) }
  }

  const rates = config?.config ?? []
  const enabledRates = rates.filter((r) => r.enabled)
  const tiers = config ? Object.entries(config.featured ?? {}) : []

  const statusText = summary
    ? summary.status === 'paid' ? t('cashback.statusPaid')
      : summary.status === 'processing' ? t('cashback.statusProcessing')
      : t('cashback.statusEstimated')
    : ''
  const statusColor = summary?.status === 'paid' ? 'text-green-400' : 'text-yellow-400'

  return (
    <div className="page-main">
      {/* Banner */}
      <div className="relative overflow-hidden mx-4 mt-3 rounded-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-800 via-green-700 to-teal-600" />
        <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute bottom-0 right-8 h-16 w-16 rounded-full bg-white/5" />
        <div className="relative p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black tracking-widest bg-white/20 text-white px-2 py-0.5 rounded-full">
              {t('cashback.bannerTag')}
            </span>
            <h2 className="text-white font-black text-[1.5rem] leading-tight mt-2 whitespace-pre-line font-display">
              {t('cashback.bannerTitle')}
            </h2>
            <p className="text-white/60 text-xs mt-1">{t('cashback.bannerSub')}</p>
          </div>
          <div className="flex-shrink-0 text-[52px] leading-none select-none">💵</div>
        </div>
      </div>

      {/* 今日/昨日 Tab */}
      <div className="mx-4 mt-3">
        <div className="flex bg-secondary rounded-xl p-1 gap-1">
          {(['today', 'yesterday'] as DateTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                activeTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {t(tab === 'today' ? 'cashback.tabToday' : 'cashback.tabYesterday')}
            </button>
          ))}
        </div>

        {/* 洗码金额卡片 */}
        <div className="mt-2 bg-secondary rounded-2xl p-4">
          {!token ? (
            <p className="text-muted-foreground text-sm text-center py-2">{t('auth.signInPlay')}</p>
          ) : summaryLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : summary && summary.totalBet > 0 ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-muted-foreground text-xs">{statusText}</span>
                <span className={`text-xs font-bold ${statusColor}`}>{activeTab === 'today' ? '⏳' : '✅'}</span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-muted-foreground text-[11px]">
                    {activeTab === 'today' ? t('cashback.estimatedLabel') : t('cashback.earnedLabel')}
                  </p>
                  <p className="text-2xl font-black text-green-400 font-display">{phpStr(summary.totalRebate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground text-[11px]">{t('cashback.betLabel')}</p>
                  <p className="text-base font-bold text-foreground">{phpStr(summary.totalBet)}</p>
                </div>
              </div>
              {summary.breakdown.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                  {summary.breakdown.map((item) => {
                    const catKey = `cashback.category${item.gameCategory.charAt(0).toUpperCase() + item.gameCategory.slice(1)}`
                    return (
                      <div key={item.gameCategory} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span>{CATEGORY_ICONS[item.gameCategory] ?? '🎮'}</span>
                          <span>{t(catKey)}</span>
                          <span className="text-[10px] opacity-60">{item.ratePct}%</span>
                        </span>
                        <span className="font-semibold text-green-400">+{phpStr(item.rebateAmount)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-2">{t('cashback.noActivity')}</p>
          )}
        </div>
      </div>

      {/* Cashback Games */}
      {tiers.length > 0 && (
        <div className="mx-4 mt-4">
          <h3 className="font-black text-foreground text-base mb-0.5">{t('cashback.cashbackGames')}</h3>
          <p className="text-muted-foreground text-[11px] mb-3">{t('cashback.cashbackGamesDesc')}</p>
          <div className="space-y-3">
            {tiers.map(([tier, games]) => (
              <div key={tier} className="rounded-2xl overflow-hidden bg-secondary">
                <button
                  type="button"
                  onClick={() => toggleTier(tier)}
                  className="w-full active:opacity-80 transition-opacity"
                >
                  <div className={`relative overflow-hidden bg-gradient-to-r ${TIER_GRADIENTS[tier] ?? 'from-gray-600 to-gray-700'} p-3 flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                      <div className="bg-white/20 rounded-xl px-3 py-1.5">
                        <span className="text-white font-black text-xl leading-none font-display">
                          {tier === 'elite' ? t('cashback.tierEliteRate') : t('cashback.tierProRate')}
                        </span>
                      </div>
                      <div className="text-left">
                        <p className="text-white font-black text-sm">
                          {t(tier === 'elite' ? 'cashback.tierElite' : 'cashback.tierPro')}
                        </p>
                        <p className="text-white/70 text-[10px]">{games.length} games</p>
                      </div>
                    </div>
                    {expandedTier === tier
                      ? <ChevronUp size={18} className="text-white/80" />
                      : <ChevronDown size={18} className="text-white/80" />
                    }
                  </div>
                </button>
                {expandedTier === tier && (
                  <div className="px-3 py-3">
                    {tierGames[tier] ? (
                      tierGames[tier].length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {tierGames[tier].map((game) => (
                            <GameCard
                              key={game.uuid}
                              game={game}
                              onTap={() => void onGameTap(game.uuid)}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-xs text-center py-2">No games configured</p>
                      )
                    ) : (
                      <div className="flex justify-center py-3">
                        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 洗码返奖详情 */}
      {enabledRates.length > 0 && (
        <div className="mx-4 mt-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-primary" />
            <h3 className="font-black text-foreground text-base">{t('cashback.rateTable')}</h3>
          </div>
          <p className="text-muted-foreground text-[11px] mb-3">{t('cashback.rateTableDesc')}</p>
          <div className="bg-secondary rounded-2xl overflow-hidden">
            {enabledRates.map((r, i) => {
              const maxRate = Math.max(...enabledRates.map((x) => x.ratePct))
              const barWidth = maxRate > 0 ? (r.ratePct / maxRate) * 100 : 0
              const catKey = `cashback.category${r.gameCategory.charAt(0).toUpperCase() + r.gameCategory.slice(1)}`
              return (
                <div
                  key={r.gameCategory}
                  className={`flex items-center justify-between px-4 py-3 ${i < enabledRates.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-base leading-none flex-shrink-0">{CATEGORY_ICONS[r.gameCategory] ?? '🎮'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{t(catKey)}</p>
                      <div className="h-1.5 rounded-full bg-border mt-0.5 max-w-[80px]">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${barWidth}%` }} />
                      </div>
                    </div>
                  </div>
                  <span className="text-primary font-black text-sm ml-3">{r.ratePct}%</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5 mt-2 px-1">
            <Info size={11} className="text-muted-foreground flex-shrink-0" />
            <p className="text-[10px] text-muted-foreground">{t('cashback.bannerSub')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
