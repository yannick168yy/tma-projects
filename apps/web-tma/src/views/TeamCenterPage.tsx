import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Copy, Share2, Link2, Wallet, TrendingUp, CheckCircle2, Clock, XCircle, ChevronRight, GitBranch, List, CircleHelp, X, ShieldCheck, Users, Zap, Network } from 'lucide-react'
import KycModal from '@/components/wallet/KycModal'
import { useKycGate } from '@/hooks/useKycGate'
import { fetchTeamTree, type TeamTreeNode, type CurrencyBreakdownItem } from '@/api/promotion'
import { translateApiError } from '@/utils/translateApiError'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'
import referralPeople from '@/assets/home/promos/referral-people.webp'

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
  const badge = depth === 1 ? 'bg-amber-500/20 text-amber-400'
    : depth === 2 ? 'bg-blue-500/20 text-blue-400'
    : 'bg-purple-500/20 text-purple-400'
  return (
    <>
      <div
        className={`flex items-center gap-2 py-2.5 border-b border-border/30 ${hasKids ? 'active:bg-secondary/50' : ''}`}
        style={{ paddingLeft: (depth - 1) * 16 + 12 }}
        onClick={() => hasKids && onToggle(node.userId)}
      >
        {hasKids
          ? <ChevronRight size={12} className={`text-muted-foreground flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
          : <span className="w-3 flex-shrink-0" />}
        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge}`}>C{depth}</span>
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-sm font-medium text-foreground truncate leading-none mb-0.5">{node.displayName}</p>
          {(node.turnoverCents !== 0 || node.currencyBreakdown?.length > 0) && (
            <p className="text-[10px] leading-none text-muted-foreground">
              {t('team.turnover')} {node.currencyBreakdown?.length > 0 ? breakdownDisplay(node.currencyBreakdown) : turnoverDisplay(node.turnoverCents)}
            </p>
          )}
        </div>
        {node.thisMonthCents !== 0 && (
          <span className="font-black text-xs flex-shrink-0 pr-3 text-amber-400">{phpDisplay(node.thisMonthCents)}</span>
        )}
      </div>
      {hasKids && isExpanded && node.children.map((child) => (
        <TreeNodeRow key={child.userId} node={child} depth={Math.min(depth + 1, 3) as 2 | 3} expandedIds={expandedIds} onToggle={onToggle} />
      ))}
    </>
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

  const tabs = [
    { id: 'overview' as const, label: t('team.tabOverview'), Icon: Network },
    { id: 'circle' as const, label: t('team.tabTeam'), Icon: Users },
    { id: 'rewards' as const, label: t('team.tabEarnings'), Icon: Wallet },
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
    <div className="bg-background flex flex-col">

      {/* ── 顶部状态区 ── */}
      <div className="px-4 py-4 amber-hero-bg border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          {onClose && (
            <button
              type="button"
              className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/25 text-foreground border border-white/10 active:scale-95 transition-transform"
              onClick={onClose}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">3-Circle Rewards</p>
        </div>
        <h1 className="font-display text-2xl font-black leading-none text-foreground">{t('team.heroTitle')}</h1>
        <p className="mt-1.5 text-xs font-semibold leading-relaxed text-muted-foreground">
          {t('team.heroDesc')}
        </p>
        {isAgent && inviteCode ? (
          <>
            <div className="mt-3 flex items-center gap-2 bg-foreground/8 rounded-xl px-3 py-2 border border-amber-500/20">
              <span className="text-[10px] text-muted-foreground">{t('team.myReferralCode')}</span>
              <span className="flex-1 font-black text-amber-400 tracking-widest text-sm text-right">{inviteCode}</span>
              <button type="button" className="text-muted-foreground hover:text-amber-400 transition-colors" onClick={copyWebLink}><Copy size={15} /></button>
            </div>
            {copyTip && <p className="text-center text-xs text-amber-400 mt-1">{t('team.copied')}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm" onClick={shareToTelegram}><Share2 size={14} />{t('team.shareOnTelegram')}</button>
              <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-500/50 text-amber-400 font-black text-sm" onClick={() => void shareToWeb()}><Link2 size={14} />{t('team.shareLink')}</button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-black font-black text-sm disabled:opacity-60"
            disabled={enabling}
            onClick={() => void onEnable()}
          >
            <Zap size={15} />
            {enabling ? t('bonuses.promos.agent.activating') : t('bonuses.promos.agent.cta')}
          </button>
        )}
      </div>

      {/* Circle counts + tab */}
      <div className="sticky z-20 bg-background" style={{ top: 'var(--app-header-height)' }}>
      <div className="flex items-center px-4 py-2.5 border-b border-border gap-4">
        <div className="flex gap-5">
          {([1, 2, 3] as const).map((lvl) => (
            <div key={lvl} className="text-center">
              <div className="text-base font-black text-amber-400 leading-none">
                {teamStatus?.[`l${lvl}Count` as 'l1Count' | 'l2Count' | 'l3Count'] ?? 0}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">C{lvl}</div>
            </div>
          ))}
        </div>
        <div className="flex-1 flex items-center justify-end gap-1 min-w-0">
          <button
            type="button"
            className="relative flex-shrink-0 group mr-0.5"
            onClick={() => setGuideOpen(true)}
            aria-label={t('team.guide.title')}
          >
            <span
              className="pointer-events-none absolute -inset-0.5 rounded-full bg-amber-400/25 blur-[4px] opacity-60 group-hover:opacity-100 transition-opacity"
              aria-hidden
            />
            <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-amber-500/50 bg-gradient-to-br from-amber-500/35 via-amber-500/12 to-amber-950/20 shadow-[0_0_12px_rgba(251,191,36,0.22)] ring-1 ring-amber-400/20 transition-transform active:scale-90 group-hover:border-amber-400/70 group-hover:shadow-[0_0_14px_rgba(251,191,36,0.35)]">
              <CircleHelp size={13.5} className="text-amber-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" strokeWidth={2.25} />
            </span>
          </button>
          <span className="h-3.5 w-px bg-border/80 flex-shrink-0" aria-hidden />
          {activeTab !== 'overview' && (
            <>
              <button type="button" className="p-1.5 text-muted-foreground hover:text-amber-400 transition-colors" onClick={() => changePeriod(prevPeriod(period))}>
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-foreground min-w-[72px] text-center truncate">{formatPeriod(period, i18n.language)}</span>
              <button type="button" className={`p-1.5 transition-colors ${period >= currentPeriod() ? 'text-border' : 'text-muted-foreground hover:text-amber-400'}`} disabled={period >= currentPeriod()} onClick={() => changePeriod(nextPeriod(period))}>
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Tab 栏 ── */}
      <div className="flex border-b border-border">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button"
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors ${activeTab === id ? 'text-amber-400 border-b-2 border-amber-400 -mb-px' : 'text-muted-foreground'}`}
            onClick={() => setActiveTab(id)}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
      </div>{/* end sticky wrapper */}

      {/* ── 内容区（document scroll）── */}
      <div className="min-h-0">

        {activeTab === 'overview' && (
          <div className="px-4 pt-4 pb-6 space-y-4">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="absolute inset-0 bg-[radial-gradient(60%_42%_at_85%_12%,rgba(34,197,94,0.16)_0%,transparent_70%),radial-gradient(52%_40%_at_8%_28%,rgba(56,189,248,0.10)_0%,transparent_70%)]" />
              <div className="relative px-4 pt-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">{t('team.overviewEyebrow')}</p>
                <h2 className="mt-1 font-display text-xl font-black text-foreground">{t('team.overviewTitle')}</h2>
                <p className="mt-1.5 text-xs font-semibold leading-relaxed text-muted-foreground">
                  {t('team.overviewDesc')}
                </p>
              </div>
              <img src={referralPeople} alt="" className="relative mx-auto -mt-2 w-full max-w-[360px]" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { level: 'C1', label: t('team.overviewC1'), rate: l1Rate, cls: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' },
                { level: 'C2', label: t('team.overviewC2'), rate: l2Rate, cls: 'border-blue-500/25 bg-blue-500/10 text-blue-300' },
                { level: 'C3', label: t('team.overviewC3'), rate: l3Rate, cls: 'border-amber-500/25 bg-amber-500/10 text-amber-300' },
              ].map((item) => (
                <div key={item.level} className={`rounded-2xl border p-3 text-center ${item.cls}`}>
                  <p className="font-display text-sm font-black">{item.level}</p>
                  <p className="mt-1 text-2xl font-black leading-none">{item.rate}%</p>
                  <p className="mt-1 text-[9px] font-semibold text-foreground/60">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-border bg-secondary p-4">
              <div className="flex items-center gap-2 mb-3">
                <Network size={15} className="text-amber-400" />
                <p className="font-display text-sm font-black text-foreground">{t('team.overviewHowTitle')}</p>
              </div>
              <div className="space-y-3">
                {[
                  ['01', t('team.overviewStep1Title'), t('team.overviewStep1Desc')],
                  ['02', t('team.overviewStep2Title'), t('team.overviewStep2Desc')],
                  ['03', t('team.overviewStep3Title'), t('team.overviewStep3Desc')],
                ].map(([step, title, desc]) => (
                  <div key={step} className="flex gap-3">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-[10px] font-black text-amber-400">{step}</span>
                    <div>
                      <p className="text-sm font-bold text-foreground">{title}</p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-black font-black text-sm disabled:opacity-60"
              disabled={enabling}
              onClick={() => isAgent ? setActiveTab('circle') : void onEnable()}
            >
              <Zap size={15} />
              {isAgent ? t('bonuses.promos.agent.ctaActive') : enabling ? t('bonuses.promos.agent.activating') : t('bonuses.promos.agent.cta')}
            </button>
          </div>
        )}

        {/* Circle rewards tab */}
        {activeTab === 'circle' && (
          <>
            {/* Rewards summary */}
            <div className="px-4 pt-4 pb-3">
              <div className="amber-card-bg rounded-2xl border border-amber-500/20 p-3">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-base leading-none">{phpDisplay(summary?.l1Cents ?? 0)}</div>
                    <div className="text-foreground/50 text-[9px] mt-0.5">C1 · {teamStatus?.ratePlan?.l1RatePct ?? 25}%</div>
                  </div>
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-base leading-none">{phpDisplay(summary?.l2Cents ?? 0)}</div>
                    <div className="text-foreground/50 text-[9px] mt-0.5">C2 · {teamStatus?.ratePlan?.l2RatePct ?? 8}%</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-base leading-none">{phpDisplay(summary?.l3Cents ?? 0)}</div>
                    <div className="text-foreground/50 text-[9px] mt-0.5">C3 · {teamStatus?.ratePlan?.l3RatePct ?? 3}%</div>
                  </div>
                  <div className="bg-amber-500/20 rounded-xl p-2 text-center border border-amber-500/30">
                    <div className="text-amber-300 font-black text-base leading-none">{phpDisplay(summary?.totalCents ?? 0)}</div>
                    <div className="text-amber-300/60 text-[9px] mt-0.5">{t('team.total')}</div>
                  </div>
                </div>
                {(summary?.paidCents ?? 0) > 0 && (
                  <div className="mt-2 pt-2 border-t border-amber-500/20 text-center">
                    <span className="text-[10px] text-muted-foreground">{t('team.settled')} </span>
                    <span className="text-[10px] font-bold text-emerald-400">{phpDisplay(summary!.paidCents)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 视图切换控件 */}
            <div className="flex items-center justify-end gap-2 px-4 pb-2">
              {treeView && (
                <>
                  <button type="button" className="text-[11px] font-bold text-amber-400 px-2 py-1 bg-amber-500/10 rounded-lg" onClick={expandAll}>{t('team.expandAll')}</button>
                  <button type="button" className="text-[11px] font-bold text-muted-foreground px-2 py-1 bg-secondary rounded-lg" onClick={() => setExpandedIds(new Set())}>{t('team.collapse')}</button>
                </>
              )}
              <button type="button"
                className="p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-amber-400 transition-colors"
                onClick={() => treeView ? setTreeView(false) : switchToTree()}>
                {treeView ? <List size={15} /> : <GitBranch size={15} />}
              </button>
            </div>

            {/* 树形视图 */}
            {treeView && (
              <div className="pb-4">
                {treeLoading ? (
                  <div className="px-4 space-y-1 pt-1">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-10 animate-pulse rounded-lg bg-secondary" style={{ marginLeft: (i % 3) * 16 }} />
                    ))}
                  </div>
                ) : !treeData || treeData.l1Members.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <GitBranch size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{t('team.noDownlines')}</p>
                  </div>
                ) : treeData.l1Members.map((m) => (
                  <TreeNodeRow key={m.userId} node={m} depth={1} expandedIds={expandedIds} onToggle={toggleExpand} />
                ))}
              </div>
            )}

            {/* 收益明细列表 */}
            {!treeView && (
              <div className="px-4 space-y-2 pb-4">
                {commLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)
                ) : !commItems.length ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <TrendingUp size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{t('team.noCommissions')}</p>
                  </div>
                ) : commItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-secondary rounded-xl px-3 py-2.5">
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${levelBadge[item.level]}`}>C{item.level}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-bold text-xs leading-none mb-0.5">{item.displayName}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t('team.turnover')} {item.currencyBreakdown?.length ? breakdownDisplay(item.currencyBreakdown) : turnoverDisplay(item.turnoverCents)} × {item.ratePct}%
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-black text-sm leading-none ${item.phpEquivCents < 0 ? 'text-red-400' : 'text-amber-400'}`}>{phpDisplay(item.phpEquivCents)}</p>
                      <p className={`text-[9px] mt-0.5 ${statusColor[item.status] ?? 'text-muted-foreground'}`}>{item.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══ 提现 Tab ══ */}
        {activeTab === 'rewards' && (
          <>
            {/* 钱包大卡 */}
            <div className="px-4 pt-4 pb-3">
              <div className={`rounded-2xl border p-4 ${(teamWallet?.availableCents ?? 0) < 0 ? 'bg-gradient-to-br from-red-900/30 to-transparent border-red-500/20' : 'amber-card-bg border-amber-500/20'}`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/70 mb-1 text-center">
                  {(teamWallet?.availableCents ?? 0) < 0 ? t('team.debtLabel') : t('team.available')}
                </p>
                <p className={`text-4xl font-black leading-none text-center mb-2 ${(teamWallet?.availableCents ?? 0) < 0 ? 'text-red-400' : 'text-amber-400'}`}>{phpDisplay(teamWallet?.availableCents ?? 0)}</p>
                <div className="flex justify-center gap-4 text-[10px] text-muted-foreground">
                  <span>{t('team.frozen')}: {phpDisplay(teamWallet?.frozenCents ?? 0)}</span>
                  <span>{t('team.lifetime')}: {phpDisplay(teamWallet?.lifetimeEarnedCents ?? 0)}</span>
                </div>
                {/* 月份维度 */}
                <div className="mt-3 pt-3 border-t border-amber-500/20 grid grid-cols-2 gap-2">
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-bold text-sm leading-none">{phpDisplay(summary?.totalCents ?? 0)}</div>
                    <div className="text-white/40 text-[9px] mt-0.5">{t('team.periodEarned', { period: formatPeriod(period, i18n.language) })}</div>
                  </div>
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-emerald-400 font-bold text-sm leading-none">{phpDisplay(summary?.paidCents ?? 0)}</div>
                    <div className="text-white/40 text-[9px] mt-0.5">{t('team.periodSettled', { period: formatPeriod(period, i18n.language) })}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 提现表单 */}
            <div className="px-4 pb-4">
              {(teamWallet?.availableCents ?? 0) < 0 ? (
                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 mb-3">
                  <p className="text-xs font-bold text-red-400 mb-1">{t('team.debtLabel')}</p>
                  <p className="text-[11px] text-red-300/80 leading-relaxed">
                    {t('team.debtWarning', { amount: phpDisplay(Math.abs(teamWallet!.availableCents)) })}
                  </p>
                </div>
              ) : (
                <div className="bg-secondary rounded-2xl p-4 mb-3">
                  <p className="text-xs font-bold text-foreground mb-2">{t('team.withdrawAmount')}</p>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">₱</span>
                      <input type="number" value={withdrawInput} placeholder={t('team.minWithdrawPhp')} min="100" step="1"
                        className="w-full bg-background rounded-xl pl-7 pr-3 py-2.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-amber-500 border border-border"
                        onChange={(e) => setWithdrawInput(e.target.value)} />
                    </div>
                    <button type="button" className="px-3 py-2.5 bg-amber-500/20 text-amber-400 rounded-xl text-xs font-bold"
                      onClick={() => setWithdrawInput(String(Math.max(0, (teamWallet?.availableCents ?? 0)) / 100))}>
                      {t('team.max')}
                    </button>
                  </div>
                  {withdrawError && <p className="text-red-400 text-xs mt-1.5">{withdrawError}</p>}
                  <p className="text-muted-foreground text-[10px] mt-1.5">{t('team.withdrawHint')}</p>
                </div>
              )}
              {kycApproved === false ? (
                <button
                  type="button"
                  className="w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 bg-amber-500 text-black"
                  onClick={() => setKycOpen(true)}
                >
                  <ShieldCheck size={16} />
                  {t('kyc.required')}
                </button>
              ) : (
                <button type="button"
                  className={`w-full py-3 rounded-xl font-black text-sm transition-opacity ${(withdrawing || (teamWallet?.availableCents ?? 0) < 0) ? 'bg-amber-500/50 text-black/50' : 'bg-amber-500 text-black'}`}
                  disabled={withdrawing || (teamWallet?.availableCents ?? 0) < 0}
                  onClick={() => void submitWithdraw()}>
                  {withdrawing ? t('team.withdrawing') : t('team.withdrawSubmit')}
                </button>
              )}
            </div>

            {/* 提现记录 */}
            <div className="px-4 pb-6">
              <p className="text-xs font-bold text-foreground mb-2">{t('team.withdrawHistory')}</p>
              {wdLoading ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary mb-2" />)
              ) : !withdrawals.length ? (
                <div className="py-6 text-center text-muted-foreground text-xs">{t('team.noWithdrawals')}</div>
              ) : withdrawals.map((wd) => {
                const StatusIcon = wd.status === 'approved' ? CheckCircle2 : wd.status === 'rejected' ? XCircle : Clock
                return (
                  <div key={wd.id} className="flex items-center gap-3 bg-secondary rounded-xl px-3 py-3 mb-2">
                    <StatusIcon size={18} className={`flex-shrink-0 ${statusColor[wd.status] ?? 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-bold text-sm leading-none mb-0.5">{phpDisplay(wd.amountCents)}</p>
                      <p className="text-muted-foreground text-[10px]">{new Date(wd.createdAt).toLocaleDateString()}</p>
                      {wd.rejectReason && <p className="text-red-400 text-[10px] mt-0.5">{wd.rejectReason}</p>}
                    </div>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${wd.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : wd.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                      {wd.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
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
