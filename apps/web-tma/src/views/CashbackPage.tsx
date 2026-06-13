import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Flame, Zap, Sparkles, type LucideIcon } from 'lucide-react'
import { fetchRebateConfig, fetchRebateSummary, type RebateConfig, type RebateSummary } from '@/api/rebate'
import { launchGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'
import { ApiError } from '@/api/client'

type DateTab = 'today' | 'yesterday'

const CATEGORY_ICONS: Record<string, string> = {
  slots: '🎰', live: '🎲', sports: '⚽', fishing: '🐟',
  table: '🃏', bingo: '🎱', crash: '🚀', pinoy: '🐓', other: '🎮',
}

// 与首页游戏大类选项保持一致的展示顺序
const CATEGORY_ORDER = ['slots', 'live', 'table', 'bingo', 'sports', 'fishing', 'crash', 'pinoy', 'other']
const catRank = (cat: string) => {
  const i = CATEGORY_ORDER.indexOf(cat)
  return i === -1 ? CATEGORY_ORDER.length : i
}

interface Props {
  onOpenGame: (url: string) => void
  onOpenCategory: (params: { title: string; sortCategory: string }) => void
}

function phpStr(v: number) {
  return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function catKeyOf(cat: string) {
  return `cashback.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`
}

export default function CashbackPage({ onOpenGame, onOpenCategory }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const locale = useLocaleStore((s) => s.locale)
  const currency = activeCurrency === 'PHP' ? 'PHP' : 'PHP'

  const [activeTab, setActiveTab] = useState<DateTab>('today')
  const [config, setConfig] = useState<RebateConfig | null>(null)
  const [summary, setSummary] = useState<RebateSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
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

  function toggleTier(tier: string) {
    setExpandedTier((prev) => prev === tier ? null : tier)
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
  const enabledRates = rates.filter((r) => r.enabled).sort((a, b) => catRank(a.gameCategory) - catRank(b.gameCategory))
  const tiers = config ? Object.entries(config.featured ?? {}) : []

  const tierRate = (tier: string) => tier === 'elite' ? t('cashback.tierEliteRate') : t('cashback.tierProRate')

  return (
    <div className="page-main pb-6">
      {/* Hero —— 明亮喜庆的红→橙→金渐变，传达洗码返奖的愉悦 */}
      <div
        className="relative px-4 pt-14 pb-6 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #f43f5e 0%, #fb7185 16%, #fb923c 56%, #fbbf24 100%)' }}
      >
        {/* 装饰光晕，增加层次与喜庆感 */}
        <div className="absolute -top-12 -right-10 h-36 w-36 rounded-full bg-amber-200/40 blur-2xl" />
        <div className="absolute -bottom-10 -left-8 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
        <div className="absolute top-3 right-8 h-16 w-16 rounded-full bg-white/10" />

        <span className="relative inline-block bg-white/25 text-white text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full backdrop-blur-sm mb-2">
          {t('cashback.pageSubtitle')}
        </span>
        <h1 className="relative text-white font-black leading-tight mb-1.5 font-display text-[2rem] drop-shadow-[0_2px_10px_rgba(120,30,0,0.35)]">
          {t('cashback.pageTitle')}
        </h1>
        <p className="relative text-white/90 text-xs max-w-[240px] leading-relaxed">{t('cashback.bannerSub')}</p>
        <div className="relative flex gap-2.5 mt-4">
          {([
            { Icon: Flame, value: t('cashback.tierEliteRate'), label: t('cashback.heroRateLabel') },
            { Icon: Zap, value: t('cashback.heroCreditValue'), label: t('cashback.heroCreditLabel') },
            { Icon: Sparkles, value: '0×', label: t('cashback.heroWagerLabel') },
          ] as { Icon: LucideIcon; value: string; label: string }[]).map((s) => (
            <div key={s.label} className="flex-1 bg-white/15 rounded-xl px-2 py-2.5 text-center border border-white/25 backdrop-blur-sm">
              <s.Icon size={18} className="mx-auto mb-1 text-white" strokeWidth={2.4} />
              <p className="text-white font-black text-sm leading-none">{s.value}</p>
              <p className="text-white/75 text-[9px] mt-1 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 今日 / 昨日 药丸 Tab */}
      <div className="mx-4 mt-3">
        <div className="flex bg-secondary rounded-full p-1 gap-1">
          {(['today', 'yesterday'] as DateTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-full text-sm font-bold transition-all ${
                activeTab === tab ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground'
              }`}
            >
              {t(tab === 'today' ? 'cashback.tabToday' : 'cashback.tabYesterday')}
            </button>
          ))}
        </div>
      </div>

      {/* 金色 Total Bonus 横条 */}
      <div className="mx-4 mt-3 relative overflow-hidden rounded-2xl">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500 to-yellow-400" />
        <div className="absolute -top-6 -right-2 h-20 w-20 rounded-full bg-white/15" />
        <div className="relative flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-white font-black text-xl leading-tight font-display">{t('cashback.totalBonus')}</p>
            <p className="text-white/80 text-[11px] mt-0.5">{t('cashback.dataUpdates')}</p>
          </div>
          {summaryLoading ? (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <p className="text-white font-black text-2xl font-display drop-shadow">{phpStr(token ? (summary?.totalRebate ?? 0) : 0)}</p>
          )}
        </div>
      </div>

      {/* 投注明细（有数据时展示） */}
      {token && summary && summary.breakdown.length > 0 && (
        <div className="mx-4 mt-2 bg-secondary rounded-2xl px-4 py-3 space-y-1.5">
          {summary.breakdown.map((item) => (
            <div key={item.gameCategory} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span>{CATEGORY_ICONS[item.gameCategory] ?? '🎮'}</span>
                <span>{t(catKeyOf(item.gameCategory))}</span>
                <span className="text-[10px] opacity-60">{item.ratePct}%</span>
              </span>
              <span className="font-semibold text-green-400">+{phpStr(item.rebateAmount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* CASHBACK GAMES */}
      {tiers.length > 0 && (
        <div className="mx-4 mt-5">
          <h3 className="font-black text-foreground text-base tracking-wide mb-3">{t('cashback.cashbackGames').toUpperCase()}</h3>
          <div className="space-y-3">
            {tiers.map(([tier, games]) => {
              const cover = games[0]?.coverUrl
              const expanded = expandedTier === tier
              return (
                <div key={tier} className="rounded-2xl bg-secondary border border-border overflow-hidden">
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-background">
                      {cover
                        ? <img src={cover} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-2xl">🎰</div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-primary font-black text-sm">
                        {t(tier === 'elite' ? 'cashback.tierElite' : 'cashback.tierPro')}
                      </p>
                      <div className="flex gap-5 mt-1">
                        <div>
                          <p className="text-muted-foreground text-[10px]">{t('cashback.cashbackRate')}</p>
                          <p className="text-foreground font-bold text-sm">{tierRate(tier)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-[10px]">{t('cashback.bonusLabel')}</p>
                          <p className="text-green-400 font-bold text-sm">{phpStr(0)}</p>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleTier(tier)}
                      className="flex-shrink-0 flex items-center gap-1.5 bg-primary text-primary-foreground rounded-full pl-4 pr-1.5 py-1.5 active:opacity-80 transition-opacity"
                    >
                      <span className="font-bold text-xs">{t('cashback.viewBtn')}</span>
                      <span className="bg-black/30 text-white text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                        {games.length}
                      </span>
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-3 pb-3 border-t border-border pt-3">
                      {games.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {games.map((g) => (
                            <button
                              key={g.gameUuid}
                              type="button"
                              onClick={() => void onGameTap(g.gameUuid)}
                              className="flex flex-col rounded-xl overflow-hidden bg-background active:scale-[0.98] transition-transform"
                            >
                              <div className="aspect-square w-full bg-secondary">
                                {g.coverUrl
                                  ? <img src={g.coverUrl} alt="" className="w-full h-full object-cover" />
                                  : <div className="w-full h-full flex items-center justify-center text-2xl">🎰</div>
                                }
                              </div>
                              <p className="text-[11px] font-bold text-white/95 truncate px-1.5 py-1.5">
                                {localizedGameName({ name: g.name ?? '', nameZh: g.nameZh }, locale)}
                              </p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-xs text-center py-2">No games configured</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 各分类返利费率 + GO BET */}
      {enabledRates.length > 0 && (
        <div className="mx-4 mt-5">
          <h3 className="font-black text-foreground text-base tracking-wide mb-3">{t('cashback.rateTable').toUpperCase()}</h3>
          <div className="bg-secondary rounded-2xl border border-border overflow-hidden">
            {enabledRates.map((r, i) => (
              <div
                key={r.gameCategory}
                className={`flex items-center gap-3 px-4 py-3.5 ${i < enabledRates.length - 1 ? 'border-b border-border' : ''}`}
              >
                <span className="text-2xl leading-none flex-shrink-0">{CATEGORY_ICONS[r.gameCategory] ?? '🎮'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{t(catKeyOf(r.gameCategory))}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('cashback.cashbackRate')} <span className="text-primary font-bold">{r.ratePct}%</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenCategory({ title: t(catKeyOf(r.gameCategory)), sortCategory: r.gameCategory })}
                  className="flex-shrink-0 bg-primary text-primary-foreground rounded-full px-4 py-2 font-bold text-xs active:opacity-80 transition-opacity"
                >
                  {t('cashback.goBet')}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 px-1">{t('cashback.bannerSub')}</p>
        </div>
      )}
    </div>
  )
}
