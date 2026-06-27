import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Copy, Share2, Link2, Wallet, TrendingUp, CheckCircle2, Clock, XCircle, ChevronRight, GitBranch, CircleHelp, X, ShieldCheck, Users, Zap, Network, CalendarDays, ClipboardList, SlidersHorizontal } from 'lucide-react'
import KycModal from '@/components/wallet/KycModal'
import { useKycGate } from '@/hooks/useKycGate'
import { fetchTeamTree, type TeamTreeNode, type CurrencyBreakdownItem } from '@/api/promotion'
import { translateApiError } from '@/utils/translateApiError'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'
import threeCircleHero from '@/assets/home/promos/three-circle-hero.webp'

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

function CircleStructure({ l1Count, l2Count, l3Count }: { l1Count: number; l2Count: number; l3Count: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#111827]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/8 px-3 py-1 text-[10px] font-bold text-emerald-300">
          C1 / Direct Friends
        </div>
        <div className="rounded-full border border-emerald-400/30 bg-black/20 px-2.5 py-1 text-[9px] font-bold text-emerald-300">
          Qualified bets {'->'} rewards
        </div>
      </div>
      <div className="grid grid-cols-[0.85fr_1.15fr] gap-3">
        <div className="flex flex-col justify-center border-r border-white/10 pr-3">
          <p className="text-3xl font-black leading-none text-emerald-300">{l1Count}</p>
          <p className="mt-1 text-xs font-bold text-white">Friends</p>
          <p className="mt-3 text-[10px] text-slate-400">C2: {l2Count} · C3: {l3Count}</p>
        </div>
        <div className="relative h-36">
          <div className="absolute left-1/2 top-1 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-emerald-300 text-[#0b121f] shadow-[0_0_22px_rgba(110,231,183,0.45)]">
            <Users size={18} />
          </div>
          <div className="absolute left-[24%] top-[50px] h-px w-[26%] -rotate-12 border-t border-dashed border-emerald-300/45" />
          <div className="absolute right-[24%] top-[50px] h-px w-[26%] rotate-12 border-t border-dashed border-emerald-300/45" />
          {[
            ['C1', 'left-[14%] top-[54px]', 'border-emerald-400/50 text-emerald-300'],
            ['C1', 'right-[14%] top-[54px]', 'border-emerald-400/50 text-emerald-300'],
            ['C2', 'left-[17%] top-[93px]', 'border-blue-400/50 text-blue-300'],
            ['C2', 'right-[17%] top-[93px]', 'border-blue-400/35 text-blue-300 opacity-50 border-dashed'],
            ['C3', 'left-[4%] top-[124px]', 'border-amber-400/50 text-amber-300'],
            ['C3', 'left-[33%] top-[124px]', 'border-amber-400/50 text-amber-300'],
            ['C3', 'right-[4%] top-[124px]', 'border-purple-400/35 text-purple-300 opacity-50 border-dashed'],
            ['C3', 'right-[33%] top-[124px]', 'border-purple-400/35 text-purple-300 opacity-50 border-dashed'],
          ].map(([label, pos, cls]) => (
            <span key={`${label}-${pos}`} className={`absolute ${pos} rounded-lg border bg-black/25 px-2 py-1 text-[10px] font-black ${cls}`}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[9.5px] font-bold text-slate-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-300" />C1 Direct friends</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-400" />C2 Friends of C1</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-300" />C3 Friends of C2</span>
      </div>
    </div>
  )
}

// ── 页面主体 ──────────────────────────────────────────────────────────────────
export default function TeamCenterPage({ onClose }: { onClose?: () => void }) {
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

  // ── 分享 ─────────────────────────────────────────────────────────────────────
  async function copyWebLink() {
    await navigator.clipboard.writeText(webShareLink).catch(() => {})
    setCopyTip(true); setTimeout(() => setCopyTip(false), 1800)
  }
  function shareToTelegram() {
    const text = encodeURIComponent(`Join my 3-Circle Rewards on BetoGo — use my code ${inviteCode}!\n${telegramLink}`)
    window.open(`https://t.me/share/url?url=${encodeURIComponent(telegramLink)}&text=${text}`, '_blank')
  }
  async function shareToWeb() {
    const shareData = { title: 'BetoGo', text: `Join my 3-Circle Rewards on BetoGo — use my code ${inviteCode}!`, url: webShareLink }
    if (navigator.share) { try { await navigator.share(shareData) } catch { /* cancelled */ } }
    else { await copyWebLink() }
  }

  async function onEnable() {
    if (!user) {
      await ensureLoggedIn(t('auth.signInProfile'))
      return
    }
    setEnabling(true)
    const res = await store.enableAgent()
    setEnabling(false)
    if (res.ok) setActiveTab('circle')
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
    { level: 1, title: 'Circle 1 Friends', desc: 'Friends you invite directly — rewards from their bets.', rate: l1Rate, icon: Users, cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
    { level: 2, title: 'Circle 2 Friends', desc: 'Friends invited by your C1 — rewards from their bets.', rate: l2Rate, icon: Users, cls: 'border-blue-500/20 bg-blue-500/10 text-blue-300' },
    { level: 3, title: 'Circle 3 Friends', desc: 'Friends invited by your C2 — rewards from their bets.', rate: l3Rate, icon: Users, cls: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  ]

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
      <div className="relative overflow-hidden rounded-b-[1.75rem] pb-7">
        <img src={threeCircleHero} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#fff0cf]/90 via-[#fff0cf]/56 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[#07111c]" />
        <div className="relative px-4 pt-[calc(var(--app-safe-top)+1rem)]">
          <div className="mb-6 flex items-center gap-3">
            {onClose && (
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[#111827] text-white shadow-lg active:scale-95"
                onClick={onClose}
              >
                <ChevronLeft size={23} />
              </button>
            )}
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/45 bg-white/35 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-amber-700 backdrop-blur-sm">
              <Network size={15} />
              3-Circle Rewards
            </div>
          </div>

          <div className="max-w-[245px]">
            <h1 className="font-display text-[2.25rem] font-black leading-[0.98] text-[#08111f] drop-shadow-[0_1px_0_rgba(255,255,255,0.22)]">
              {t('team.heroTitle')}
            </h1>
            <p className="mt-3 text-[14px] font-semibold leading-relaxed text-[#172033]/85">{t('team.heroDesc')}</p>
          </div>

          {inviteCode ? (
            <div className="mt-4 flex w-[250px] items-center gap-2 rounded-xl bg-[#202431] px-3 py-3 text-white shadow-[0_12px_28px_rgba(0,0,0,0.2)]">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-white/55">{t('team.myReferralCode')}</p>
                <p className="font-display text-lg font-black tracking-[0.18em] text-amber-300 truncate">{inviteCode}</p>
              </div>
              <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-300" onClick={copyWebLink}>
                <Copy size={19} />
              </button>
            </div>
          ) : null}
          {copyTip && <p className="mt-1 w-[250px] text-center text-xs font-bold text-amber-700">{t('team.copied')}</p>}

          <div className="mt-4 flex gap-2">
            {inviteCode ? (
              <>
                <button type="button" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-black text-[#08111f] shadow-[0_10px_24px_rgba(245,158,11,0.32)] active:scale-[0.98]" onClick={shareToTelegram}>
                  <Share2 size={16} />{t('team.shareOnTelegram')}
                </button>
                <button type="button" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-400/60 bg-[#07111c]/80 text-sm font-black text-amber-300 active:scale-[0.98]" onClick={() => void shareToWeb()}>
                  <Link2 size={16} />{t('team.shareLink')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-black text-[#08111f] disabled:opacity-60"
                disabled={enabling}
                onClick={() => void onEnable()}
              >
                <Zap size={16} />{enabling ? t('bonuses.promos.agent.activating') : t('bonuses.promos.agent.cta')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="sticky z-20 bg-[#07111c]/96 px-4 pt-3 backdrop-blur" style={{ top: 'var(--app-header-height)' }}>
        <div className="flex items-center rounded-2xl border border-white/10 bg-[#101a27]/90 px-4 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.28)]">
          <div className="flex flex-1 items-center justify-around">
            {[
              ['C1', l1Count, 'text-emerald-300'],
              ['C2', l2Count, 'text-blue-300'],
              ['C3', l3Count, 'text-purple-300'],
            ].map(([label, value, cls]) => (
              <div key={label as string} className="min-w-0 flex-1 text-center">
                <p className={`text-xl font-black leading-none ${cls}`}>{value}</p>
                <p className="mt-1 text-[11px] font-medium text-slate-400">{label}</p>
              </div>
            ))}
          </div>
          <span className="mx-3 h-9 w-px bg-white/10" />
          <button
            type="button"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.35)]"
            onClick={() => setGuideOpen(true)}
            aria-label={t('team.guide.title')}
          >
            <CircleHelp size={19} />
          </button>
          {activeTab !== 'overview' && (
            <>
              <span className="mx-3 h-9 w-px bg-white/10" />
              <button type="button" className="text-slate-400" onClick={() => changePeriod(prevPeriod(period))}>
                <ChevronLeft size={17} />
              </button>
              <button type="button" className="mx-1 flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold text-white" onClick={() => changePeriod(period)}>
                <CalendarDays size={17} className="text-slate-300" />
                <span className="max-w-[86px] truncate">{periodLabel}</span>
              </button>
              <button type="button" className={`${period >= currentPeriod() ? 'text-slate-700' : 'text-slate-400'}`} disabled={period >= currentPeriod()} onClick={() => changePeriod(nextPeriod(period))}>
                <ChevronRight size={17} />
              </button>
            </>
          )}
        </div>

        <div className="mt-3 flex border-b border-white/10">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[12px] font-bold transition-colors ${activeTab === id ? 'text-amber-300 border-b-2 border-amber-400 -mb-px' : 'text-slate-400'}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={20} />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 px-4 pb-8 pt-4">
        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-violet-400/20 bg-violet-500/20">
              {[
                [Link2, 'Share Link', 'Invite friends'],
                [Users, 'Grow 3 Circles', 'C1 -> C2 -> C3'],
                [Wallet, 'Earn by Rates', 'Get rewards'],
              ].map(([Icon, title, desc], i) => {
                const ItemIcon = Icon as typeof Link2
                return (
                  <div key={title as string} className={`px-2 py-4 text-center ${i > 0 ? 'border-l border-white/15' : ''}`}>
                    <ItemIcon size={18} className="mx-auto mb-2 text-amber-300" />
                    <p className="text-[11px] font-black text-white">{title as string}</p>
                    <p className="mt-0.5 text-[9px] text-slate-300">{desc as string}</p>
                  </div>
                )
              })}
            </div>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <Network size={18} className="text-amber-300" />
                <h2 className="font-display text-base font-black text-white">3-Circle Structure</h2>
              </div>
              <CircleStructure l1Count={l1Count} l2Count={l2Count} l3Count={l3Count} />
            </section>

            <section>
              <h2 className="mb-3 font-display text-base font-black text-white">Circle Reward Rates</h2>
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
                      <p className="mt-1 text-[9px] text-slate-400">Reward Rate</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-[#08111f] font-black text-sm disabled:opacity-60"
              disabled={enabling}
              onClick={() => isAgent ? setActiveTab('circle') : void onEnable()}
            >
              <Zap size={15} />
              {isAgent ? t('bonuses.promos.agent.ctaActive') : enabling ? t('bonuses.promos.agent.activating') : t('bonuses.promos.agent.cta')}
            </button>
          </div>
        )}

        {activeTab === 'circle' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-400/20 bg-[#101824] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="rounded-xl bg-white/6 p-3 text-center">
                  <div className="text-amber-300 font-black text-xl leading-none">{phpDisplay(summary?.l1Cents ?? 0)}</div>
                  <div className="text-slate-400 text-xs mt-1">C1 · {l1Rate}%</div>
                </div>
                <div className="rounded-xl bg-white/6 p-3 text-center">
                  <div className="text-blue-300 font-black text-xl leading-none">{phpDisplay(summary?.l2Cents ?? 0)}</div>
                  <div className="text-slate-400 text-xs mt-1">C2 · {l2Rate}%</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-white/6 p-3 text-center">
                  <div className="text-purple-300 font-black text-xl leading-none">{phpDisplay(summary?.l3Cents ?? 0)}</div>
                  <div className="text-slate-400 text-xs mt-1">C3 · {l3Rate}%</div>
                </div>
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/14 p-3 text-center">
                  <div className="text-amber-300 font-black text-xl leading-none">{phpDisplay(summary?.totalCents ?? 0)}</div>
                  <div className="text-amber-100/60 text-xs mt-1">{t('team.total')}</div>
                </div>
              </div>
              <div className="mt-3 border-t border-amber-400/15 pt-3 text-center">
                <span className="text-sm text-slate-400">{t('team.settled')} </span>
                <span className="text-sm font-black text-emerald-300">{phpDisplay(summary?.paidCents ?? 0)}</span>
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
            <div className={`rounded-2xl border p-4 ${(teamWallet?.availableCents ?? 0) < 0 ? 'border-red-500/25 bg-red-950/25' : 'border-amber-400/20 bg-[#101824]'}`}>
              <p className="mb-2 text-center text-[11px] font-black uppercase tracking-[0.22em] text-amber-300/80">
                {(teamWallet?.availableCents ?? 0) < 0 ? t('team.debtLabel') : t('team.available')}
              </p>
              <p className={`text-center text-5xl font-black leading-none ${(teamWallet?.availableCents ?? 0) < 0 ? 'text-red-400' : 'text-amber-300'}`}>
                {phpDisplay(teamWallet?.availableCents ?? 0)}
              </p>
              <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-300">
                <span>{t('team.frozen')}: {phpDisplay(teamWallet?.frozenCents ?? 0)}</span>
                <span className="text-amber-300">•</span>
                <span>{t('team.lifetime')}: {phpDisplay(teamWallet?.lifetimeEarnedCents ?? 0)}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-amber-400/15 pt-5">
                <div className="rounded-xl bg-white/6 p-3 text-center">
                  <div className="text-amber-300 font-black text-xl leading-none">{phpDisplay(summary?.totalCents ?? 0)}</div>
                  <div className="text-slate-300 text-xs mt-2">{t('team.periodEarned', { period: periodLabel })}</div>
                </div>
                <div className="rounded-xl bg-white/6 p-3 text-center">
                  <div className="text-emerald-300 font-black text-xl leading-none">{phpDisplay(summary?.paidCents ?? 0)}</div>
                  <div className="text-slate-300 text-xs mt-2">{t('team.periodSettled', { period: periodLabel })}</div>
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
                  <p className="mb-3 text-lg font-black text-white">{t('team.withdrawAmount')}</p>
                  <div className="flex gap-3">
                    <div className="flex-1 relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-lg">₱</span>
                      <input type="number" value={withdrawInput} placeholder={t('team.minWithdrawPhp')} min="100" step="1"
                        className="h-14 w-full rounded-xl border border-white/10 bg-[#06101a] pl-9 pr-3 text-lg font-bold text-white outline-none focus:ring-1 focus:ring-amber-500"
                        onChange={(e) => setWithdrawInput(e.target.value)} />
                    </div>
                    <button type="button" className="h-14 rounded-xl bg-amber-500/25 px-5 text-sm font-black text-amber-300"
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
                  className="w-full py-4 rounded-xl font-black text-base flex items-center justify-center gap-2 bg-amber-500 text-[#08111f]"
                  onClick={() => setKycOpen(true)}
                >
                  <ShieldCheck size={18} />
                  {t('kyc.required')}
                </button>
              ) : (
                <button type="button"
                  className={`w-full py-4 rounded-xl font-black text-base transition-opacity ${(withdrawing || (teamWallet?.availableCents ?? 0) < 0) ? 'bg-amber-500/50 text-black/50' : 'bg-amber-500 text-[#08111f]'}`}
                  disabled={withdrawing || (teamWallet?.availableCents ?? 0) < 0}
                  onClick={() => void submitWithdraw()}>
                  {withdrawing ? t('team.withdrawing') : t('team.withdrawSubmit')}
                </button>
              )}
            </div>

            {/* 提现记录 */}
            <div>
              <p className="mb-3 text-lg font-black text-white">{t('team.withdrawHistory')}</p>
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
