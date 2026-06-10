import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Copy, Share2, Link2, Wallet, TrendingUp, CheckCircle2, Clock, XCircle, ChevronRight, GitBranch, List } from 'lucide-react'
import { fetchTeamTree, type TeamTreeNode } from '@/api/promotion'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

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

const statusColor: Record<string, string> = {
  pending: 'text-amber-400', paid: 'text-emerald-400',
  voided: 'text-muted-foreground', approved: 'text-emerald-400', rejected: 'text-red-400',
}
const levelBadge: Record<number, string> = {
  1: 'bg-amber-500/20 text-amber-400',
  2: 'bg-blue-500/20 text-blue-400',
  3: 'bg-purple-500/20 text-purple-400',
}

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
        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge}`}>L{depth}</span>
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-sm font-medium text-foreground truncate leading-none mb-0.5">{node.displayName}</p>
          {node.turnoverCents !== 0 && (
            <p className="text-[10px] leading-none text-muted-foreground">{t('team.turnover')} {turnoverDisplay(node.turnoverCents)}</p>
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
export default function TeamCenterPage() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const store = usePromotionStore()

  const [activeTab, setActiveTab] = useState<'earnings' | 'withdraw'>('earnings')
  const [period, setPeriod] = useState(currentPeriod)
  const [copyTip, setCopyTip] = useState(false)
  const [withdrawInput, setWithdrawInput] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')

  // 树形视图状态
  const [treeView, setTreeView] = useState(true)
  const [treeData, setTreeData] = useState<{ l1Members: TeamTreeNode[] } | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

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
    void Promise.all([
      store.loadTeamStatus(),
      store.loadTeamCommissions(period),
      store.loadTeamWallet(),
      store.loadTeamWithdrawals(1),
      loadTree(period),
    ])
  }, [])

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
    const text = encodeURIComponent(`Join BetoGo — use my code ${inviteCode}!\n${telegramLink}`)
    window.open(`https://t.me/share/url?url=${encodeURIComponent(telegramLink)}&text=${text}`, '_blank')
  }
  async function shareToWeb() {
    const shareData = { title: 'BetoGo', text: `Join BetoGo — use my code ${inviteCode}!`, url: webShareLink }
    if (navigator.share) { try { await navigator.share(shareData) } catch { /* cancelled */ } }
    else { await copyWebLink() }
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
    else setWithdrawError(res.message ?? t('team.withdrawFailed'))
  }

  // ── 数据引用 ──────────────────────────────────────────────────────────────────
  const teamStatus   = store.teamStatus
  const teamWallet   = store.teamWallet
  const summary      = store.teamCommissionSummary
  const commItems    = store.teamCommissionItems
  const commLoading  = store.teamCommissionLoading
  const withdrawals  = store.teamWithdrawals
  const wdLoading    = store.teamWithdrawalsLoading

  const tabs = [
    { id: 'earnings' as const, label: t('team.tabEarnings'), Icon: TrendingUp },
    { id: 'withdraw' as const, label: t('team.tabWithdraw'), Icon: Wallet },
  ]

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">

      {/* ── 邀请码区 ── */}
      <div className="px-4 py-4 amber-hero-bg border-b border-border flex-shrink-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80 mb-2">{t('team.myReferralCode')}</p>
        <div className="flex items-center gap-2 bg-foreground/8 rounded-xl px-3 py-2 border border-amber-500/20 mb-3">
          <span className="flex-1 font-black text-amber-400 tracking-widest text-sm">{inviteCode}</span>
          <button type="button" className="text-muted-foreground hover:text-amber-400 transition-colors" onClick={copyWebLink}><Copy size={15} /></button>
        </div>
        {copyTip && <p className="text-center text-xs text-amber-400 -mt-1 mb-2">{t('team.copied')}</p>}
        <div className="flex gap-2">
          <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm" onClick={shareToTelegram}><Share2 size={14} />{t('team.shareOnTelegram')}</button>
          <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-500/50 text-amber-400 font-black text-sm" onClick={() => void shareToWeb()}><Link2 size={14} />{t('team.shareLink')}</button>
        </div>
      </div>

      {/* ── L1/L2/L3 人数 + 月份导航 ── */}
      <div className="flex items-center px-4 py-2.5 border-b border-border flex-shrink-0 gap-4">
        <div className="flex gap-5">
          {([1, 2, 3] as const).map((lvl) => (
            <div key={lvl} className="text-center">
              <div className="text-base font-black text-amber-400 leading-none">
                {teamStatus?.[`l${lvl}Count` as 'l1Count' | 'l2Count' | 'l3Count'] ?? 0}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">L{lvl}</div>
            </div>
          ))}
        </div>
        <div className="flex-1 flex items-center justify-end gap-1">
          <button type="button" className="p-1.5 text-muted-foreground hover:text-amber-400 transition-colors" onClick={() => changePeriod(prevPeriod(period))}>
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-bold text-foreground min-w-[76px] text-center">{formatPeriod(period, i18n.language)}</span>
          <button type="button" className={`p-1.5 transition-colors ${period >= currentPeriod() ? 'text-border' : 'text-muted-foreground hover:text-amber-400'}`} disabled={period >= currentPeriod()} onClick={() => changePeriod(nextPeriod(period))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── Tab 栏 ── */}
      <div className="flex border-b border-border flex-shrink-0">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button"
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors ${activeTab === id ? 'text-amber-400 border-b-2 border-amber-400 -mb-px' : 'text-muted-foreground'}`}
            onClick={() => setActiveTab(id)}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── 内容区 ── */}
      <div className="flex-1 min-h-0 overflow-y-auto page-scroll">

        {/* ══ 团队收益 Tab ══ */}
        {activeTab === 'earnings' && (
          <>
            {/* 佣金汇总卡片 */}
            <div className="px-4 pt-4 pb-3">
              <div className="amber-card-bg rounded-2xl border border-amber-500/20 p-3">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-base leading-none">{phpDisplay(summary?.l1Cents ?? 0)}</div>
                    <div className="text-foreground/50 text-[9px] mt-0.5">L1 · {teamStatus?.ratePlan?.l1RatePct ?? 25}%</div>
                  </div>
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-base leading-none">{phpDisplay(summary?.l2Cents ?? 0)}</div>
                    <div className="text-foreground/50 text-[9px] mt-0.5">L2 · {teamStatus?.ratePlan?.l2RatePct ?? 8}%</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-foreground/6 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-base leading-none">{phpDisplay(summary?.l3Cents ?? 0)}</div>
                    <div className="text-foreground/50 text-[9px] mt-0.5">L3 · {teamStatus?.ratePlan?.l3RatePct ?? 3}%</div>
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
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${levelBadge[item.level]}`}>L{item.level}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-bold text-xs leading-none mb-0.5">{item.displayName}</p>
                      <p className="text-[10px] text-muted-foreground">{t('team.turnover')} {turnoverDisplay(item.turnoverCents)} × {item.ratePct}%</p>
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
        {activeTab === 'withdraw' && (
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
              <button type="button"
                className={`w-full py-3 rounded-xl font-black text-sm transition-opacity ${(withdrawing || (teamWallet?.availableCents ?? 0) < 0) ? 'bg-amber-500/50 text-black/50' : 'bg-amber-500 text-black'}`}
                disabled={withdrawing || (teamWallet?.availableCents ?? 0) < 0}
                onClick={() => void submitWithdraw()}>
                {withdrawing ? t('team.withdrawing') : t('team.withdrawSubmit')}
              </button>
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
      </div>
    </div>
  )
}
