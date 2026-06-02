import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, ChevronLeft, ChevronRight } from 'lucide-react'
import PeryaCarnivalHero from '@/components/bingo/PeryaCarnivalHero'
import GameImageCard from '@/components/game/GameImageCard'
import { PINOY_CLASSICS, MORE_PINOY_GAMES, PERYA_WINNERS } from '@/data/bingo'
import { fetchGames, launchGame, type SlotGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/client'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props {
  onOpenWallet: () => void
  onGameTap: () => void
  onOpenGame: (url: string) => void
  onOpenCategoryLobby: (params: { title: string; sortCategory?: string }) => void
}

const providerFallback: Record<string, [string, string]> = {
  JiliGames: ['#4c0091', '#7c3aed'], PragmaticPlay: ['#065f46', '#059669'], Caleta: ['#1e3a8a', '#2563eb'],
}
function cardFallback(provider: string): [string, string] { return providerFallback[provider] ?? ['#1e293b', '#334155'] }

const providerHeroLeft: Record<string, string> = { JiliGames: '#0e0024', PragmaticPlay: '#021a10', Caleta: '#050e2a' }
function heroLeftColor(provider: string) { return providerHeroLeft[provider] ?? '#0e1117' }

const fiestaBuntingColors = ['#FFB800','#ec4899','#34d399','#60a5fa','#f97316','#a855f7','#FFB800','#ef4444','#FFB800','#ec4899','#34d399','#60a5fa','#f97316','#a855f7','#FFB800','#ef4444'] as const

export default function BingoPage({ onOpenWallet, onGameTap, onOpenGame, onOpenCategoryLobby }: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const locale = useLocaleStore((s) => s.locale)
  const [bingoGames, setBingoGames] = useState<SlotGame[]>([])
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  const peryaScroll = useRef<HTMLDivElement>(null)
  const moreScroll = useRef<HTMLDivElement>(null)

  function scrollRow(ref: React.RefObject<HTMLDivElement | null>, dir: -1 | 1) { ref.current?.scrollBy({ left: dir * 148, behavior: 'smooth' }) }

  const heroGame = bingoGames[0] ?? null
  const subGames = bingoGames.slice(1, 5)
  const marqueeWinners = useMemo(() => [...PERYA_WINNERS, ...PERYA_WINNERS], [])

  useEffect(() => {
    fetchGames({ sortCategory: 'bingo', sortBy: 'ph_bonus', limit: 8 }).then((res) => setBingoGames(res.items)).catch(() => {})
  }, [])

  async function onPlayGame(uuid: string) {
    if (!isLoggedIn) { onGameTap(); return }
    setLaunchingUuid(uuid)
    try { const { url } = await launchGame(uuid); onOpenGame(url) }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Failed to launch game') }
    finally { setLaunchingUuid(null) }
  }

  return (
    <div className="page-main">
      <PeryaCarnivalHero>
        <p className="text-amber-300 text-[10px] font-black uppercase tracking-widest mb-1">🎪 {t('bingo.carnival')}</p>
        <h1 className="font-black leading-none mb-1 font-display text-[2.6rem]" style={{ textShadow: '0 2px 20px rgba(168, 85, 247, 0.6)' }}>
          <span className="text-white">{t('bingo.titlePerya')}</span>
          <span className="text-primary">{t('bingo.titleAnd')}</span>
          <span style={{ color: '#ec4899' }}>{t('bingo.titleBingo')}</span>
        </h1>
        <p className="text-white/40 text-xs leading-relaxed">{t('bingo.heroSub')}</p>
        <div className="flex items-center gap-2 mt-4 bg-black/35 rounded-xl px-3 py-2 overflow-hidden" style={{ border: '1px solid rgba(255, 184, 0, 0.14)' }}>
          <div className="flex items-center gap-1 flex-shrink-0"><Trophy size={11} className="text-primary" /><span className="text-primary text-[10px] font-black uppercase tracking-wide">{t('bingo.winners')}</span></div>
          <div className="w-px h-3 bg-white/10 flex-shrink-0" />
          <div className="overflow-hidden flex-1">
            <div className="flex gap-5 animate-marquee whitespace-nowrap" style={{ animationDuration: '16s' }}>
              {marqueeWinners.map((w, i) => (
                <span key={i} className="text-[11px] flex-shrink-0">
                  <span className="text-primary font-bold">{w.name}</span>
                  <span className="text-white/40"> {t('common.won')} </span>
                  <span className="text-emerald-400 font-bold">{w.amount}</span>
                  <span className="text-white/25"> · {w.game}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </PeryaCarnivalHero>

      <div className="mx-4 mt-4 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: 'linear-gradient(90deg, #2d1800, #1a0d40)', border: '1px solid rgba(255, 184, 0, 0.25)', boxShadow: '0 4px 20px rgba(255, 184, 0, 0.12)' }}>
        <span className="text-2xl">🏆</span>
        <div className="flex-1"><p className="text-primary text-[10px] font-black uppercase tracking-widest leading-none">Today's Jackpot</p><p className="text-white font-black text-xl leading-tight font-display">₱ 1,200,000</p></div>
        <button type="button" className="bg-primary text-primary-foreground font-black text-xs px-4 py-2 rounded-xl shadow shadow-amber-500/25 flex-shrink-0" onClick={onOpenWallet}>JOIN NOW</button>
      </div>

      {heroGame && (
        <div className="px-4 mt-5">
          <div className="flex items-center gap-2 mb-3"><span className="text-base">🎪</span><h2 className="text-white font-black text-base font-display">SIGNATURE GAMES</h2></div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="col-span-2 relative rounded-3xl overflow-hidden h-40 text-left active:scale-[0.98] transition-transform" disabled={launchingUuid === heroGame.uuid} onClick={() => void onPlayGame(heroGame.uuid)}>
              <div className="absolute inset-0" style={{ background: `linear-gradient(to right, ${heroLeftColor(heroGame.provider)} 45%, #2a0060 100%)` }} />
              <div className="absolute right-0 top-0 bottom-0 w-[55%]">
                {(heroGame.imageHqUrl || heroGame.imageUrl) && <img src={(heroGame.imageHqUrl || heroGame.imageUrl)!} className="w-full h-full object-cover object-center" />}
                <div className="absolute inset-0" style={{ background: `linear-gradient(to right, ${heroLeftColor(heroGame.provider)} 0%, transparent 55%)` }} />
              </div>
              <div className="absolute inset-0 p-4 flex flex-col justify-center" style={{ maxWidth: '58%' }}>
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full mb-2 self-start bg-[#FFB800] text-black">JACKPOT</span>
                <h3 className="text-white font-black leading-tight font-display" style={{ fontSize: heroGame.name.length <= 14 ? '22px' : heroGame.name.length <= 20 ? '18px' : '15px', overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>{heroGame.name}</h3>
                <p className="text-white/50 text-xs mt-0.5">{heroGame.provider}</p>
                <div className="flex items-center gap-1 mt-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /><span className="text-white/50 text-[11px]">{(heroGame.weight * 12 + 800).toLocaleString()} playing</span></div>
              </div>
            </button>
            {subGames.map((g) => (
              <button key={g.uuid} type="button" className="rounded-3xl overflow-hidden h-36 active:scale-[0.98] transition-transform" disabled={launchingUuid === g.uuid} onClick={() => void onPlayGame(g.uuid)}>
                <GameImageCard imageUrl={g.imageHqUrl ?? g.imageUrl} fallbackBg={cardFallback(g.provider)} name={localizedGameName(g, locale)} provider={g.provider} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3 px-4">
          <div className="flex items-center gap-2"><span className="text-base">🎡</span><h2 className="text-white font-black text-base font-display">PERYA CLASSICS</h2></div>
          <div className="flex items-center gap-0.5">
            <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(peryaScroll, -1)}><ChevronLeft size={13} /></button>
            <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(peryaScroll, 1)}><ChevronRight size={13} /></button>
          </div>
        </div>
        <div ref={peryaScroll} className="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
          {PINOY_CLASSICS.map((g) => (
            <div key={g.uuid} className="flex-shrink-0 w-32">
              <button type="button" className="w-full h-44 rounded-xl overflow-hidden active:scale-95 transition-transform" disabled={launchingUuid === g.uuid} onClick={() => void onPlayGame(g.uuid)}>
                <GameImageCard variant="mirror" imageUrl={g.imageUrl} fallbackBg={g.bg} name={localizedGameName(g, locale)} provider={g.provider} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3 px-4">
          <div className="flex items-center gap-2"><span className="text-base">🐓</span><h2 className="text-white font-black text-base font-display">MORE PINOY GAMES</h2></div>
          <div className="flex items-center gap-2">
            <button type="button" className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform" onClick={() => onOpenCategoryLobby({ title: '🇵🇭 All Pinoy Games', sortCategory: 'pinoy' })}>ALL</button>
            <div className="flex items-center gap-0.5">
              <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(moreScroll, -1)}><ChevronLeft size={13} /></button>
              <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(moreScroll, 1)}><ChevronRight size={13} /></button>
            </div>
          </div>
        </div>
        <div ref={moreScroll} className="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
          {MORE_PINOY_GAMES.map((g) => (
            <div key={g.uuid} className="flex-shrink-0 w-32">
              <button type="button" className="w-full h-44 rounded-xl overflow-hidden active:scale-95 transition-transform" disabled={launchingUuid === g.uuid} onClick={() => void onPlayGame(g.uuid)}>
                <GameImageCard variant="mirror" imageUrl={g.imageUrl} fallbackBg={g.bg} name={localizedGameName(g, locale)} provider={g.provider} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-5 rounded-2xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #1a004a, #3b0020)', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 80% 50%, rgba(236, 72, 153, 0.12) 0%, transparent 65%)' }} />
        <div className="absolute top-0 inset-x-0 overflow-hidden flex" style={{ height: '8px' }}>
          {fiestaBuntingColors.map((c, i) => <span key={i} className="inline-block flex-shrink-0" style={{ width: '14px', height: '8px', background: c, clipPath: 'polygon(0 0, 100% 0, 50% 100%)', opacity: 0.8 }} />)}
        </div>
        <div className="relative px-4 pt-5 pb-4 flex items-center gap-3">
          <div className="text-4xl">🎉</div>
          <div className="flex-1">
            <p className="text-pink-300 text-[10px] font-black uppercase tracking-widest">Fiesta Special</p>
            <p className="text-white font-black text-lg leading-tight font-display">DAILY FREE BINGO<br /><span className="text-primary">Every 6PM</span></p>
          </div>
          <button type="button" className="flex-shrink-0 bg-pink-500 hover:bg-pink-400 text-white font-black text-xs px-4 py-2.5 rounded-xl transition-colors shadow shadow-pink-500/30" onClick={onOpenWallet}>LIBRE!</button>
        </div>
      </div>

      <div className="px-4 mt-5 mb-4">
        <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black mb-3">Powered by</p>
        <div className="flex gap-2 flex-wrap">
          {['JILI', 'PRAGMATIC', 'CALETA', 'RICH88', 'JDB', 'SPRIBE'].map((p) => (
            <span key={p} className="text-[10px] font-black text-muted-foreground bg-secondary px-3 py-1.5 rounded-full border border-border">{p}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
