import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Wallet, TrendingUp, CheckCircle2, Clock, XCircle, ChevronRight, GitBranch, CircleHelp, X, ShieldCheck, Users, Zap, CalendarDays, ClipboardList, SlidersHorizontal, Link2 } from 'lucide-react'
import KycModal from '@/components/wallet/KycModal'
import { useKycGate } from '@/hooks/useKycGate'
import { fetchTeamTree, type TeamTreeNode, type CurrencyBreakdownItem } from '@/api/promotion'
import { translateApiError } from '@/utils/translateApiError'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'
import { analytics } from '@/utils/analytics'
import threeCircleHero from '@/assets/team/3-circles/hero.webp'
import circleStructureImage from '@/assets/team/3-circles/3-circle-structure.webp'
import iconFacebook from '@/assets/team/3-circles/facebook.webp'
import iconViber from '@/assets/team/3-circles/viber.webp'
import iconWhatsApp from '@/assets/team/3-circles/whatsapp.webp'
import iconTelegram from '@/assets/team/3-circles/telegram.webp'
import iconX from '@/assets/team/3-circles/x.webp'
import iconLine from '@/assets/team/3-circles/line.webp'

// ── 月份工具 ─────────────────────────────────────────────────────────────────
function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function prevPeriod(p: string) {
  const [y, m] = p.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
function nextPeriod(p: string) {
  const [y, m] = p.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
function formatPeriod(p: string, locale = 'en') {
  const [y, m] = p.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(y, m - 1, 1))
}

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  const abs = Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (val < 0 ? '-₱' : '₱') + abs
}

function turnoverDisplay(cents: number): string {
  const val = (cents ?? 0) / 100
  return '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCurrencyAmt(betCents: number, currency: string): string {
  const val = betCents / 100
  if (currency === 'PHP') return '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const formatted = val % 1 === 0 ? val.toFixed(0) : parseFloat(val.toFixed(6)).toString()
  return `${formatted} ${currency}`
}

function breakdownDisplay(breakdown: { currency: string; betCents: number }[] | CurrencyBreakdownItem[] | null | undefined): string {
  if (!breakdown || breakdown.length === 0) return ''
  const sorted = [...breakdown].sort((a, b) => (a.currency === 'PHP' ? -1 : b.currency === 'PHP' ? 1 : 0))
  return sorted.map(b => fmtCurrencyAmt(b.betCents, b.currency)).join(' + ')
}

function parseGuideSections(text: string): { heading: string | null; body: string }[] {
  const chunks = text.split('\n\n').map((c) => c.trim()).filter(Boolean)
  const sections: { heading: string | null; body: string }[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const isHeading = chunk.length <= 60 && !chunk.includes('\n') && !/[.?!,。，！？]$/.test(chunk)
    if (isHeading && i + 1 < chunks.length) {
      sections.push({ heading: chunk, body: chunks[i + 1] })
      i++
    } else {
      sections.push({ heading: null, body: chunk })
    }
  }
  return sections
}

const statusColor: Record<string, string> = {
  pending: 'text-amber-400', paid: 'text-emerald-400',
  voided: 'text-muted-foreground', approved: 'text-emerald-400', rejected: 'text-red-400',
}
const levelBadge: Record<number, string> = {
  1: 'bg-amber-500/20 text-amber-400',
  2: 'bg-blue-500/20 text-blue-400',
  3: 'bg-purple-500/20 text-purple-400',
}
const levelColors: Record<number, { text: string; badge: string; line: string }> = {
  1: { text: 'text-amber-300', badge: 'border-amber-400/45 bg-amber-400/15 text-amber-300', line: 'border-amber-400/25' },
  2: { text: 'text-blue-300', badge: 'border-blue-400/45 bg-blue-500/20 text-blue-300', line: 'border-blue-400/25' },
  3: { text: 'text-purple-300', badge: 'border-purple-400/45 bg-purple-500/20 text-purple-300', line: 'border-purple-400/25' },
}

type ThreeCircleTab = 'overview' | 'circle' | 'rewards'
type SharePlatform = 'facebook' | 'viber' | 'whatsapp' | 'telegram' | 'x' | 'line' | 'copy'

// ── 树形节点 ──────────────────────────────────────────────────────────────────
function TreeNodeRow({ node, depth, expandedIds, onToggle }: {
  node: TeamTreeNode
  depth: 1 | 2 | 3
  expandedIds: Set<string>
  onToggle: (id: string) => void
}) {
  const { t } = useTranslation()
  const isExpanded = expandedIds.has(node.userId)
  const hasKids = node.children.length > 0
  const color = levelColors[depth]
  return (
    <>
      <div
        className={`relative flex items-center gap-2 py-3 border-b border-white/6 ${hasKids ? 'active:bg-white/5' : ''}`}
        style={{ paddingLeft: (depth - 1) * 22 + 6 }}
        onClick={() => hasKids && onToggle(node.userId)}
      >
        {depth > 1 && <span className={`absolute bottom-0 top-0 border-l border-dashed ${color.line}`} style={{ left: (depth - 1) * 22 - 9 }} />}
        {hasKids
          ? <ChevronRight size={16} className={`text-slate-400 flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
          : <span className="w-4 flex-shrink-0" />}
        <span className={`text-[12px] font-black px-2 py-1 rounded-full border flex-shrink-0 ${color.badge}`}>C{depth}</span>
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-[15px] font-bold text-white truncate leading-none mb-1">{node.displayName}</p>
          {(node.turnoverCents !== 0 || node.currencyBreakdown?.length > 0) && (
            <p className="text-[11px] leading-none text-slate-400 truncate">
              {t('team.turnover')} {node.currencyBreakdown?.length > 0 ? breakdownDisplay(node.currencyBreakdown) : turnoverDisplay(node.turnoverCents)}
            </p>
          )}
        </div>
        {node.thisMonthCents !== 0 && (
          <span className={`font-black text-sm flex-shrink-0 pr-1 ${color.text}`}>{phpDisplay(node.thisMonthCents)}</span>
        )}
      </div>
      {hasKids && isExpanded && node.children.map((child) => (
        <TreeNodeRow key={child.userId} node={child} depth={Math.min(depth + 1, 3) as 2 | 3} expandedIds={expandedIds} onToggle={onToggle} />
      ))}
    </>
  )
}

// ── 页面主体 ──────────────────────────────────────────────────────────────────
export default function TeamCenterPage() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const ensureLoggedIn = useAuthStore((s) => s.ensureLoggedIn)
  const store = usePromotionStore()

  const [activeTab, setActiveTab] = useState<ThreeCircleTab>('overview')
  const [period, setPeriod] = useState(currentPeriod)
  const [copyTip, setCopyTip] = useState(false)
  const [withdrawInput, setWithdrawInput] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const { kycApproved, kycOpen, setKycOpen, onKycClose, onKycApproved } = useKycGate(activeTab === 'rewards')

  // 树形视图状态
  const [treeView, setTreeView] = useState(true)
  const [treeData, setTreeData] = useState<{ l1Members: TeamTreeNode[] } | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [guideOpen, setGuideOpen] = useState(false)
  const [openCtaShake, setOpenCtaShake] = useState(false)
  const openCtaRef = useRef<HTMLButtonElement | null>(null)

  const inviteCode = user?.inviteCode ?? ''
  const telegramLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const webShareLink = useMemo(() => buildInviteWebLink(inviteCode), [inviteCode])

  // ── 加载 ────────────────────────────────────────────────────────────────────
  async function loadTree(p: string) {
    setTreeLoading(true); setTreeData(null)
    try {
      const data = await fetchTeamTree(p)
      setTreeData(data)
      const allIds = new Set<string>()
      for (const l1 of data.l1Members) {
        allIds.add(l1.userId)
        for (const l2 of l1.children) {
          allIds.add(l2.userId)
          for (const l3 of l2.children) allIds.add(l3.userId)
        }
      }
      setExpandedIds(allIds)
    } catch { /* fail silently */ }
    finally { setTreeLoading(false) }
  }

  function changePeriod(p: string) {
    setPeriod(p)
    void store.loadTeamCommissions(p)
    if (treeView) void loadTree(p)
    else setTreeData(null)
  }

  useEffect(() => {
    if (!user) return
    void Promise.all([
      store.loadTeamStatus(),
      store.loadTeamCommissions(period),
      store.loadTeamWallet(),
      store.loadTeamWithdrawals(1),
      loadTree(period),
    ])
  }, [user])

  useEffect(() => {
    if (!user) {
      setActiveTab('overview')
      return
    }
    if (store.teamStatusLoading) return
    setActiveTab(store.teamStatus?.isAgent ? 'circle' : 'overview')
  }, [user, store.teamStatusLoading, store.teamStatus?.isAgent])

  // ── 树形控制 ─────────────────────────────────────────────────────────────────
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function expandAll() {
    if (!treeData) return
    const ids = new Set<string>()
    for (const l1 of treeData.l1Members) {
      ids.add(l1.userId)
      for (const l2 of l1.children) ids.add(l2.userId)
    }
    setExpandedIds(ids)
  }
  function switchToTree() {
    setTreeView(true)
    if (!treeData && !treeLoading) void loadTree(period)
  }
  function promptOpenCircle() {
    setActiveTab('overview')
    window.setTimeout(() => {
      openCtaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setOpenCtaShake(true)
      window.setTimeout(() => setOpenCtaShake(false), 1300)
    }, 80)
  }
  function selectTab(id: ThreeCircleTab) {
    if (id !== 'overview' && !isAgent) {
      promptOpenCircle()
      return
    }
    setActiveTab(id)
  }

  // ── 分享 ─────────────────────────────────────────────────────────────────────
  async function copyWebLink() {
    await navigator.clipboard.writeText(webShareLink).catch(() => {})
    setCopyTip(true); setTimeout(() => setCopyTip(false), 1800)
  }
  function openAppLink(url: string, fallback?: string) {
    window.location.href = url
    if (fallback) {
      window.setTimeout(() => {
        if (!document.hidden) window.location.href = fallback
      }, 900)
    }
  }
  function shareToPlatform(platform: SharePlatform) {
    if (!isAgent) {
      promptOpenCircle()
      return
    }
    if (!inviteCode) {
      void onEnable()
      return
    }
    if (platform === 'copy') {
      void copyWebLink()
      analytics.shareInvite(platform)
      return
    }
    const text = `Join my 3-Circle Rewards on BetoGo — use my code ${inviteCode}!`
    const message = `${text}\n${webShareLink}`
    if (platform === 'telegram') {
      analytics.shareInvite(platform)
      openAppLink(`tg://msg_url?url=${encodeURIComponent(telegramLink)}&text=${encodeURIComponent(text)}`)
      return
    }
    if (platform === 'facebook') {
      const fallback = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(webShareLink)}`
      analytics.shareInvite(platform)
      openAppLink(`fb-messenger://share?link=${encodeURIComponent(webShareLink)}`, fallback)
      return
    }
    if (platform === 'viber') {
      analytics.shareInvite(platform)
      openAppLink(`viber://forward?text=${encodeURIComponent(message)}`)
      return
    }
    if (platform === 'whatsapp') {
      analytics.shareInvite(platform)
      openAppLink(`whatsapp://send?text=${encodeURIComponent(message)}`, `https://wa.me/?text=${encodeURIComponent(message)}`)
      return
    }
    if (platform === 'x') {
      const fallback = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(webShareLink)}`
      analytics.shareInvite(platform)
      openAppLink(`twitter://post?message=${encodeURIComponent(message)}`, fallback)
      return
    }
    if (platform === 'line') {
      analytics.shareInvite(platform)
      openAppLink(`line://msg/text/${encodeURIComponent(message)}`, `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(webShareLink)}`)
    }
  }

  async function onEnable() {
    if (!user) {
      await ensureLoggedIn(t('auth.signInProfile'))
      return
    }
    setEnabling(true)
    const res = await store.enableAgent()
    setEnabling(false)
    if (res.ok) {
      analytics.agentActivated()
      setActiveTab('circle')
    }
  }

  // ── 提现 ─────────────────────────────────────────────────────────────────────
  async function submitWithdraw() {
    setWithdrawError('')
    const cents = Math.round(parseFloat(withdrawInput) * 100)
    if (!cents || cents <= 0) { setWithdrawError(t('team.invalidAmount')); return }
    setWithdrawing(true)
    const res = await store.submitWithdrawal(cents)
    setWithdrawing(false)
    if (res.ok) setWithdrawInput('')
    else setWithdrawError(res.message ? translateApiError(res.message, t) : t('team.withdrawFailed'))
  }

  // ── 数据引用 ──────────────────────────────────────────────────────────────────
  const teamStatus   = store.teamStatus
  const teamWallet   = store.teamWallet
  const summary      = store.teamCommissionSummary
  const commItems    = store.teamCommissionItems
  const commLoading  = store.teamCommissionLoading
  const withdrawals  = store.teamWithdrawals
  const wdLoading    = store.teamWithdrawalsLoading
  const isAgent      = teamStatus?.isAgent ?? false
  const l1Rate       = teamStatus?.ratePlan?.l1RatePct ?? 0.6
  const l2Rate       = teamStatus?.ratePlan?.l2RatePct ?? 0.3
  const l3Rate       = teamStatus?.ratePlan?.l3RatePct ?? 0.2
  const l1Count      = teamStatus?.l1Count ?? 0
  const l2Count      = teamStatus?.l2Count ?? 0
  const l3Count      = teamStatus?.l3Count ?? 0
  const periodLabel  = formatPeriod(period, i18n.language)

  const tabs = [
    { id: 'overview' as const, label: t('team.tabOverview'), Icon: ClipboardList },
    { id: 'circle' as const, label: t('team.tabTeam'), Icon: Users },
    { id: 'rewards' as const, label: t('team.tabEarnings'), Icon: Wallet },
  ]

  const rateCards = [
    { level: 1, title: t('team.rateC1Title'), desc: t('team.rateC1Desc'), rate: l1Rate, icon: Users, cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
    { level: 2, title: t('team.rateC2Title'), desc: t('team.rateC2Desc'), rate: l2Rate, icon: Users, cls: 'border-blue-500/20 bg-blue-500/10 text-blue-300' },
    { level: 3, title: t('team.rateC3Title'), desc: t('team.rateC3Desc'), rate: l3Rate, icon: Users, cls: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  ]

  const sharePlatforms = [
    { id: 'facebook' as const, label: 'Facebook', icon: iconFacebook },
    { id: 'viber' as const, label: 'Viber', icon: iconViber },
    { id: 'whatsapp' as const, label: 'WhatsApp', icon: iconWhatsApp },
    { id: 'telegram' as const, label: 'Telegram', icon: iconTelegram },
    { id: 'x' as const, label: 'X', icon: iconX },
    { id: 'line' as const, label: 'Line', icon: iconLine },
    { id: 'copy' as const, label: t('team.shareLink'), icon: '' },
  ]
  const sectionTitleClass = 'mb-3 text-lg font-medium text-white'
  const metricCardClass = 'rounded-xl border border-amber-300/12 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_54%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'

  const guideSections = useMemo(() => {
    if (!guideOpen) return []
    const text = t('team.guide.content', {
      l1Rate: teamStatus?.ratePlan?.l1RatePct ?? 25,
      l2Rate: teamStatus?.ratePlan?.l2RatePct ?? 8,
      l3Rate: teamStatus?.ratePlan?.l3RatePct ?? 3,
    })
    return parseGuideSections(text)
  }, [guideOpen, t, teamStatus?.ratePlan])

  return (
    <div className="flex min-h-full flex-col bg-[#07111c] text-white">
      <style>{`@keyframes team-open-shake{0%,100%{transform:translateX(0)}15%{transform:translateX(-8px)}30%{transform:translateX(7px)}45%{transform:translateX(-5px)}60%{transform:translateX(4px)}75%{transform:translateX(-2px)}}`}</style>
      <div className="relative overflow-hidden">
        <img src={threeCircleHero} alt="" className="block w-full" />
      </div>

      <div className="sticky z-20 bg-[#07111c]/96 px-4 pt-1 backdrop-blur" style={{ top: 'var(--app-header-height)' }}>
        <div className="flex border-b border-white/10">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-[13px] font-medium transition-colors ${activeTab === id ? 'text-amber-300 border-b-2 border-amber-400 -mb-px' : 'text-slate-400'}`}
              onClick={() => selectTab(id)}
            >
              <Icon size={19} />{label}
            </button>
          ))}
        </div>
        {activeTab !== 'overview' && (
          <div className="mt-3 flex items-center rounded-2xl border border-white/12 bg-[#101a27]/90 px-4 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.24)]">
            <div className="flex flex-1 items-center justify-around">
              {[
                ['C1', l1Count],
                ['C2', l2Count],
                ['C3', l3Count],
              ].map(([label, value]) => (
                <div key={label as string} className="min-w-0 flex-1 text-center">
                  <p className="text-lg font-semibold leading-none text-amber-300">{value}</p>
                  <p className="mt-1 text-[11px] font-medium text-slate-400">{label}</p>
                </div>
              ))}
            </div>
            <span className="mx-3 h-9 w-px bg-white/12" />
            <button
              type="button"
              className="flex h-10 min-w-10 flex-shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-white/6 px-2 text-amber-300"
              onClick={() => setGuideOpen(true)}
              aria-label={t('team.guide.title')}
            >
              <CircleHelp size={18} />
              <span className="ml-1 text-[11px] font-medium">{t('team.guideEntry')}</span>
            </button>
            <span className="mx-3 h-9 w-px bg-white/12" />
            <button type="button" className="text-slate-400" onClick={() => changePeriod(prevPeriod(period))}>
              <ChevronLeft size={17} />
            </button>
            <button type="button" className="mx-1 flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold text-white" onClick={() => changePeriod(period)}>
              <CalendarDays size={20} className="text-white" />
              <span className="max-w-[88px] truncate">{periodLabel}</span>
            </button>
            <button type="button" className={`${period >= currentPeriod() ? 'text-slate-700' : 'text-slate-400'}`} disabled={period >= currentPeriod()} onClick={() => changePeriod(nextPeriod(period))}>
              <ChevronRight size={17} />
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 px-4 pb-8 pt-4">
        {activeTab === 'overview' && (
          <div className="space-y-5">
            <section>
              <h2 className={sectionTitleClass}>{t('team.sectionShareMore')}</h2>
              <div className="grid grid-cols-7 gap-2">
                {sharePlatforms.map(({ id, label, icon }) => (
                  <button
                    key={id}
                    type="button"
                    className="min-w-0 active:scale-95"
                    onClick={() => shareToPlatform(id)}
                  >
                    {id === 'copy'
                      ? (
                        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#fbbf24,#f59e0b)] text-[#07111c] shadow-[0_8px_18px_rgba(245,158,11,0.28)]">
                          <Link2 size={24} strokeWidth={2.5} />
                        </span>
                      )
                      : <img src={icon} alt="" className="mx-auto h-11 w-11" />}
                    <span className="mt-1 block truncate text-center text-[11px] font-medium text-slate-200">{label}</span>
                  </button>
                ))}
              </div>
              {copyTip && <p className="mt-2 text-center text-xs font-bold text-amber-300">{t('team.copied')}</p>}
            </section>

            <section>
              <h2 className={sectionTitleClass}>{t('team.sectionStructure')}</h2>
              <img src={circleStructureImage} alt="3-Circle Structure" className="w-full rounded-2xl" />
            </section>

            <section>
              <h2 className={sectionTitleClass}>{t('team.sectionRates')}</h2>
              <div className="space-y-3">
                {rateCards.map(({ level, title, desc, rate, icon: Icon, cls }) => (
                  <div key={level} className={`flex items-center gap-3 rounded-2xl border bg-[#101824] p-3 ${cls}`}>
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-current/10">
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${levelColors[level].badge}`}>C{level}</span>
                        <p className="truncate text-sm font-black text-white">{title}</p>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-slate-400">{desc}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black leading-none">{rate}%</p>
                      <p className="mt-1 text-[9px] text-slate-400">{t('team.rewardRate')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {!isAgent && (
              <button
                ref={openCtaRef}
                type="button"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-[#08111f] font-black text-sm disabled:opacity-60 shadow-[0_12px_26px_rgba(245,158,11,0.26)]"
                style={openCtaShake ? { animation: 'team-open-shake 1240ms ease-in-out' } : undefined}
                disabled={enabling}
                onClick={() => void onEnable()}
              >
                <Zap size={15} />
                {enabling ? t('bonuses.promos.agent.activating') : t('bonuses.promos.agent.cta')}
              </button>
            )}
          </div>
        )}

        {activeTab === 'circle' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-[#101824] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <h2 className={sectionTitleClass}>Settled</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['C1', `${l1Rate}%`, summary?.l1Cents ?? 0],
                  ['C2', `${l2Rate}%`, summary?.l2Cents ?? 0],
                  ['C3', `${l3Rate}%`, summary?.l3Cents ?? 0],
                  [t('team.total'), periodLabel, summary?.totalCents ?? 0],
                ].map(([label, sub, cents]) => (
                  <div key={label as string} className={metricCardClass}>
                    <p className="text-[11px] font-medium text-slate-400">{label as string} · {sub as string}</p>
                    <p className="mt-1 text-[17px] font-semibold leading-none text-white">{phpDisplay(cents as number)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(255,255,255,0.04))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                <span className="text-sm font-medium text-slate-300">{t('team.settled')}</span>
                <span className="text-lg font-semibold text-amber-300">{phpDisplay(summary?.paidCents ?? 0)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              {treeView && (
                <>
                  <button type="button" className="rounded-xl bg-amber-400/15 px-3 py-2 text-xs font-black text-amber-300" onClick={expandAll}>{t('team.expandAll')}</button>
                  <button type="button" className="rounded-xl bg-slate-700/50 px-3 py-2 text-xs font-black text-slate-300" onClick={() => setExpandedIds(new Set())}>{t('team.collapse')}</button>
                </>
              )}
              <button type="button"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-700/50 text-slate-300"
                onClick={() => treeView ? setTreeView(false) : switchToTree()}>
                {treeView ? <SlidersHorizontal size={17} /> : <GitBranch size={17} />}
              </button>
            </div>

            {treeView && (
              <div className="rounded-2xl bg-[#07111c] pb-2">
                {treeLoading ? (
                  <div className="space-y-2 pt-1">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-xl bg-white/6" style={{ marginLeft: (i % 3) * 20 }} />
                    ))}
                  </div>
                ) : !treeData || treeData.l1Members.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-[#101824] py-12 text-center text-slate-400">
                    <GitBranch size={40} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm">{t('team.noDownlines')}</p>
                  </div>
                ) : treeData.l1Members.map((m) => (
                  <TreeNodeRow key={m.userId} node={m} depth={1} expandedIds={expandedIds} onToggle={toggleExpand} />
                ))}
              </div>
            )}

            {!treeView && (
              <div className="space-y-2">
                {commLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/6" />)
                ) : !commItems.length ? (
                  <div className="rounded-2xl border border-white/10 bg-[#101824] py-8 text-center text-slate-400">
                    <TrendingUp size={36} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm">{t('team.noCommissions')}</p>
                  </div>
                ) : commItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl bg-[#101824] px-3 py-3">
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full flex-shrink-0 ${levelBadge[item.level]}`}>C{item.level}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm leading-none mb-1">{item.displayName}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {t('team.turnover')} {item.currencyBreakdown?.length ? breakdownDisplay(item.currencyBreakdown) : turnoverDisplay(item.turnoverCents)} × {item.ratePct}%
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-black text-sm leading-none ${item.phpEquivCents < 0 ? 'text-red-400' : 'text-amber-300'}`}>{phpDisplay(item.phpEquivCents)}</p>
                      <p className={`text-[9px] mt-1 ${statusColor[item.status] ?? 'text-slate-400'}`}>{item.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'rewards' && (
          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 ${(teamWallet?.availableCents ?? 0) < 0 ? 'border-red-500/25 bg-red-950/25' : 'border-white/10 bg-[#101824]'}`}>
              <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                {(teamWallet?.availableCents ?? 0) < 0 ? t('team.debtLabel') : t('team.available')}
              </p>
              <p className={`text-center text-[2.5rem] font-semibold leading-none ${(teamWallet?.availableCents ?? 0) < 0 ? 'text-red-400' : 'text-amber-300'}`}>
                {phpDisplay(teamWallet?.availableCents ?? 0)}
              </p>
              <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-400">
                <span>{t('team.frozen')}: {phpDisplay(teamWallet?.frozenCents ?? 0)}</span>
                <span className="text-slate-600">•</span>
                <span>{t('team.lifetime')}: {phpDisplay(teamWallet?.lifetimeEarnedCents ?? 0)}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/10 pt-5">
                <div className={`${metricCardClass} text-center`}>
                  <div className="text-lg font-semibold leading-none text-white">{phpDisplay(summary?.totalCents ?? 0)}</div>
                  <div className="mt-2 text-xs text-slate-400">{t('team.periodEarned', { period: periodLabel })}</div>
                </div>
                <div className={`${metricCardClass} text-center`}>
                  <div className="text-lg font-semibold leading-none text-amber-300">{phpDisplay(summary?.paidCents ?? 0)}</div>
                  <div className="mt-2 text-xs text-slate-400">{t('team.periodSettled', { period: periodLabel })}</div>
                </div>
              </div>
            </div>

            <div>
              {(teamWallet?.availableCents ?? 0) < 0 ? (
                <div className="mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                  <p className="text-xs font-bold text-red-400 mb-1">{t('team.debtLabel')}</p>
                  <p className="text-[11px] text-red-300/80 leading-relaxed">
                    {t('team.debtWarning', { amount: phpDisplay(Math.abs(teamWallet!.availableCents)) })}
                  </p>
                </div>
              ) : (
                <div className="mb-4 rounded-2xl border border-white/10 bg-[#121b2b] p-4">
                  <p className={sectionTitleClass}>{t('team.withdrawAmount')}</p>
                  <div className="flex gap-3">
                    <div className="flex-1 relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">₱</span>
                      <input type="number" value={withdrawInput} placeholder={t('team.minWithdrawPhp')} min="100" step="1"
                        className="h-12 w-full rounded-xl border border-white/10 bg-[#06101a] pl-9 pr-3 text-base font-medium text-white outline-none focus:ring-1 focus:ring-amber-500"
                        onChange={(e) => setWithdrawInput(e.target.value)} />
                    </div>
                    <button type="button" className="h-12 rounded-xl border border-amber-400/20 bg-amber-400/10 px-5 text-sm font-semibold text-amber-300"
                      onClick={() => setWithdrawInput(String(Math.max(0, (teamWallet?.availableCents ?? 0)) / 100))}>
                      {t('team.max')}
                    </button>
                  </div>
                  {withdrawError && <p className="text-red-400 text-xs mt-1.5">{withdrawError}</p>}
                  <p className="text-slate-400 text-xs mt-3">{t('team.withdrawHint')}</p>
                </div>
              )}
              {kycApproved === false ? (
                <button
                  type="button"
                  className="w-full py-3.5 rounded-xl font-semibold text-base flex items-center justify-center gap-2 bg-amber-500 text-[#08111f]"
                  onClick={() => setKycOpen(true)}
                >
                  <ShieldCheck size={18} />
                  {t('kyc.required')}
                </button>
              ) : (
                <button type="button"
                  className={`w-full py-3.5 rounded-xl font-semibold text-base transition-opacity ${(withdrawing || (teamWallet?.availableCents ?? 0) < 0) ? 'bg-amber-500/50 text-black/50' : 'bg-amber-500 text-[#08111f]'}`}
                  disabled={withdrawing || (teamWallet?.availableCents ?? 0) < 0}
                  onClick={() => void submitWithdraw()}>
                  {withdrawing ? t('team.withdrawing') : t('team.withdrawSubmit')}
                </button>
              )}
            </div>

            {/* 提现记录 */}
            <div>
              <p className={sectionTitleClass}>{t('team.withdrawHistory')}</p>
              {wdLoading ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/6 mb-2" />)
              ) : !withdrawals.length ? (
                <div className="rounded-2xl border border-white/10 bg-[#101824] py-10 text-center text-slate-400">
                  <ClipboardList size={38} className="mx-auto mb-3 opacity-45" />
                  <p className="text-sm">{t('team.noWithdrawals')}</p>
                </div>
              ) : withdrawals.map((wd) => {
                const StatusIcon = wd.status === 'approved' ? CheckCircle2 : wd.status === 'rejected' ? XCircle : Clock
                return (
                  <div key={wd.id} className="flex items-center gap-3 bg-[#101824] rounded-xl px-3 py-3 mb-2">
                    <StatusIcon size={18} className={`flex-shrink-0 ${statusColor[wd.status] ?? 'text-slate-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm leading-none mb-0.5">{phpDisplay(wd.amountCents)}</p>
                      <p className="text-slate-400 text-[10px]">{new Date(wd.createdAt).toLocaleDateString()}</p>
                      {wd.rejectReason && <p className="text-red-400 text-[10px] mt-0.5">{wd.rejectReason}</p>}
                    </div>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${wd.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : wd.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                      {wd.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div className="h-4" />{/* 底部留白 */}
      </div>

      {/* 3-Circle Rewards guide */}
      {guideOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setGuideOpen(false)}>
          <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" />
          <div
            className="relative bg-background rounded-t-2xl max-h-[88vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="w-9 h-1 rounded-full bg-foreground/15" />
            </div>
            <div className="flex items-center justify-between px-4 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                  <CircleHelp size={16} className="text-amber-400" />
                </div>
                <h2 className="font-display font-black text-sm text-foreground truncate">{t('team.guide.title')}</h2>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-secondary/80 flex items-center justify-center flex-shrink-0"
                onClick={() => setGuideOpen(false)}
              >
                <X size={15} className="text-muted-foreground" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-6 pt-1 space-y-3.5 page-scroll">
              {guideSections.map((s, i) => (
                <div key={i} className="rounded-xl bg-secondary/40 px-3.5 py-3 border border-border/50">
                  {s.heading && (
                    <p className="text-amber-400/90 font-bold text-xs mb-1.5">{s.heading}</p>
                  )}
                  <p className="text-[12px] text-foreground/70 leading-[1.65] whitespace-pre-line">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <KycModal open={kycOpen} onClose={onKycClose} onApproved={onKycApproved} />
    </div>
  )
}
