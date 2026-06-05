import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Copy, Share2, Link2, Users, Wallet, TrendingUp, CheckCircle2, Clock, XCircle, ChevronRight, GitBranch, List } from 'lucide-react'
import { fetchTeamTree, type TeamTreeNode } from '@/api/promotion'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

function TreeNodeRow({ node, depth, expandedIds, onToggle }: {
  node: TeamTreeNode
  depth: 1 | 2 | 3
  expandedIds: Set<string>
  onToggle: (id: string) => void
}) {
  const isExpanded = expandedIds.has(node.userId)
  const hasKids = node.children.length > 0
  const badge = depth === 1 ? 'bg-amber-500/20 text-amber-400' : depth === 2 ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
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
        <span className="flex-1 text-sm font-medium text-foreground truncate">{node.displayName}</span>
        {node.thisMonthCents > 0 && (
          <span className="text-amber-400 font-black text-xs flex-shrink-0 pr-3">{phpDisplay(node.thisMonthCents)}</span>
        )}
      </div>
      {hasKids && isExpanded && node.children.map((child) => (
        <TreeNodeRow key={child.userId} node={child} depth={Math.min(depth + 1, 3) as 2 | 3} expandedIds={expandedIds} onToggle={onToggle} />
      ))}
    </>
  )
}

interface Props { onClose: () => void }

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function phpDisplay(cents: number) {
  return '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const statusColor: Record<string, string> = { pending: 'text-amber-400', paid: 'text-emerald-400', voided: 'text-muted-foreground', approved: 'text-emerald-400', rejected: 'text-red-400' }
const levelBadge: Record<number, string> = { 1: 'bg-amber-500/20 text-amber-400', 2: 'bg-blue-500/20 text-blue-400', 3: 'bg-purple-500/20 text-purple-400' }

export default function TeamCenterPage({ onClose }: Props) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const store = usePromotionStore()
  const [activeTab, setActiveTab] = useState<'team' | 'commissions' | 'withdraw'>('team')
  const [activeLevel, setActiveLevel] = useState<1 | 2 | 3>(1)
  const [copyTip, setCopyTip] = useState(false)
  const [withdrawInput, setWithdrawInput] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [commissionPeriod, setCommissionPeriod] = useState(currentPeriod)
  const [treeView, setTreeView] = useState(false)
  const [treeData, setTreeData] = useState<{ l1Members: TeamTreeNode[] } | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treePeriod, setTreePeriod] = useState(currentPeriod)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const inviteCode = user?.inviteCode ?? ''
  const telegramLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const webShareLink = useMemo(() => buildInviteWebLink(inviteCode), [inviteCode])

  useEffect(() => {
    void Promise.all([
      store.loadTeamStatus(),
      store.loadTeamDownlines(1, 1),
      store.loadTeamDownlines(2, 1),
      store.loadTeamDownlines(3, 1),
      store.loadTeamCommissions(commissionPeriod),
      store.loadTeamWallet(),
      store.loadTeamWithdrawals(1),
    ])
  }, [])

  useEffect(() => {
    if (!store.teamDownlines[activeLevel].length) void store.loadTeamDownlines(activeLevel, 1)
  }, [activeLevel])

  useEffect(() => { void store.loadTeamCommissions(commissionPeriod) }, [commissionPeriod])

  async function loadTree(period: string) {
    setTreeLoading(true)
    setTreeData(null)
    try {
      const data = await fetchTeamTree(period)
      setTreeData(data)
      setExpandedIds(new Set(data.l1Members.map((m) => m.userId)))
    } catch { /* fail silently */ }
    finally { setTreeLoading(false) }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function expandAllTree() {
    if (!treeData) return
    const ids = new Set<string>()
    for (const l1 of treeData.l1Members) {
      ids.add(l1.userId)
      for (const l2 of l1.children) ids.add(l2.userId)
    }
    setExpandedIds(ids)
  }

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

  const teamStatus = store.teamStatus
  const teamWallet = store.teamWallet
  const downlines = store.teamDownlines[activeLevel]
  const downlineTotal = store.teamDownlineTotals[activeLevel]
  const downlinePage = store.teamDownlinePages[activeLevel]
  const downlineLoading = store.teamDownlineLoading
  const hasMoreDownlines = downlines.length < downlineTotal
  const commissionSummary = store.teamCommissionSummary
  const commissionItems = store.teamCommissionItems
  const commissionLoading = store.teamCommissionLoading
  const withdrawals = store.teamWithdrawals
  const withdrawalsLoading = store.teamWithdrawalsLoading

  const tabs = [
    { id: 'team' as const, label: t('team.tabTeam'), Icon: Users },
    { id: 'commissions' as const, label: t('team.tabCommissions'), Icon: TrendingUp },
    { id: 'withdraw' as const, label: t('team.tabWithdraw'), Icon: Wallet },
  ]

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 flex-shrink-0">
        <button type="button" className="flex-shrink-0 text-muted-foreground" onClick={onClose}><ChevronLeft size={22} /></button>
        <h2 className="flex-1 text-sm font-bold text-foreground">{t('team.title')}</h2>
        <span className="text-xs font-black text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">AGENT</span>
      </div>

      <div className="px-4 py-4 bg-gradient-to-br from-[#78350f]/40 via-[#92400e]/20 to-transparent border-b border-border flex-shrink-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80 mb-2">{t('team.myReferralCode')}</p>
        <div className="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2 border border-amber-500/20 mb-3">
          <span className="flex-1 font-black text-amber-400 tracking-widest text-sm">{inviteCode}</span>
          <button type="button" className="text-muted-foreground hover:text-amber-400 transition-colors" onClick={copyWebLink}><Copy size={15} /></button>
        </div>
        {copyTip && <p className="text-center text-xs text-amber-400 -mt-1 mb-2">{t('team.copied')}</p>}
        <div className="flex gap-2">
          <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm" onClick={shareToTelegram}><Share2 size={14} />{t('team.shareOnTelegram')}</button>
          <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-500/50 text-amber-400 font-black text-sm" onClick={() => void shareToWeb()}><Link2 size={14} />{t('team.shareLink')}</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-0 border-b border-border flex-shrink-0">
        {([1, 2, 3] as const).map((lvl) => (
          <div key={lvl} className={`py-3 text-center ${lvl < 3 ? 'border-r border-border' : ''}`}>
            <div className="text-lg font-black text-amber-400 leading-none">{teamStatus?.[`l${lvl}Count` as 'l1Count' | 'l2Count' | 'l3Count'] ?? 0}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">L{lvl}</div>
          </div>
        ))}
      </div>

      <div className="flex border-b border-border flex-shrink-0">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors ${activeTab === id ? 'text-amber-400 border-b-2 border-amber-400 -mb-px' : 'text-muted-foreground'}`} onClick={() => setActiveTab(id)}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto page-scroll">
        {activeTab === 'team' && (
          <>
            {!treeView ? (
              <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                <div className="flex flex-1 gap-2">
                  {([1, 2, 3] as const).map((lvl) => (
                    <button key={lvl} type="button" className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-colors ${activeLevel === lvl ? 'bg-amber-500 text-black' : 'bg-secondary text-muted-foreground'}`} onClick={() => setActiveLevel(lvl)}>
                      L{lvl} ({teamStatus?.[`l${lvl}Count` as 'l1Count' | 'l2Count' | 'l3Count'] ?? 0})
                    </button>
                  ))}
                </div>
                <button type="button" className="flex-shrink-0 p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-amber-400 transition-colors" onClick={() => { setTreeView(true); if (!treeData) void loadTree(treePeriod) }}>
                  <GitBranch size={15} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                <input
                  type="month"
                  value={treePeriod}
                  className="flex-1 bg-secondary text-foreground rounded-xl px-3 py-1.5 text-sm border border-border outline-none focus:ring-1 focus:ring-amber-500"
                  onChange={(e) => { setTreePeriod(e.target.value); void loadTree(e.target.value) }}
                />
                <button type="button" className="text-[11px] font-bold text-amber-400 px-2 py-1.5 bg-amber-500/10 rounded-lg flex-shrink-0" onClick={expandAllTree}>全展</button>
                <button type="button" className="text-[11px] font-bold text-muted-foreground px-2 py-1.5 bg-secondary rounded-lg flex-shrink-0" onClick={() => setExpandedIds(new Set())}>折叠</button>
                <button type="button" className="flex-shrink-0 p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-amber-400 transition-colors" onClick={() => setTreeView(false)}>
                  <List size={15} />
                </button>
              </div>
            )}

            {!treeView ? (
              <div className="px-4 space-y-2 pb-4">
                {downlineLoading && !downlines.length ? (
                  Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)
                ) : !downlines.length ? (
                  <div className="py-12 text-center text-muted-foreground"><Users size={36} className="mx-auto mb-3 opacity-30" /><p className="text-sm">{t('team.noDownlines')}</p></div>
                ) : (
                  <>
                    {downlines.map((dl) => (
                      <div key={dl.userId} className="flex items-center gap-3 bg-secondary rounded-xl px-3 py-3">
                        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0"><span className="text-amber-400 font-black text-sm">{(dl.displayName || '?')[0]}</span></div>
                        <div className="flex-1 min-w-0"><p className="text-foreground font-bold text-sm leading-none mb-0.5">{dl.displayName}</p><p className="text-muted-foreground text-[10px]">{new Date(dl.registeredAt).toLocaleDateString()}</p></div>
                        <div className="flex-shrink-0">
                          {dl.activated ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">{t('team.activated')}</span>
                            : <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{t('team.pending')}</span>}
                        </div>
                      </div>
                    ))}
                    {hasMoreDownlines && !downlineLoading && (
                      <button type="button" className="w-full py-2.5 text-xs font-bold text-amber-400 bg-amber-500/10 rounded-xl" onClick={() => void store.loadTeamDownlines(activeLevel, downlinePage + 1)}>{t('team.loadMore')}</button>
                    )}
                    {downlineLoading && <div className="text-center text-xs text-muted-foreground py-2">Loading...</div>}
                  </>
                )}
              </div>
            ) : (
              <div className="pb-4">
                {treeLoading ? (
                  <div className="px-4 space-y-1 pt-2">
                    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-secondary" style={{ marginLeft: (i % 3) * 16 }} />)}
                  </div>
                ) : !treeData || treeData.l1Members.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground"><GitBranch size={36} className="mx-auto mb-3 opacity-30" /><p className="text-sm">{t('team.noDownlines')}</p></div>
                ) : (
                  treeData.l1Members.map((m) => (
                    <TreeNodeRow key={m.userId} node={m} depth={1} expandedIds={expandedIds} onToggle={toggleExpand} />
                  ))
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'commissions' && (
          <>
            <div className="px-4 pt-4 pb-3">
              <input type="month" value={commissionPeriod} className="w-full bg-secondary text-foreground rounded-xl px-3 py-2 text-sm border border-border outline-none focus:ring-1 focus:ring-amber-500" onChange={(e) => setCommissionPeriod(e.target.value)} />
            </div>
            <div className="px-4 pb-3">
              <div className="bg-gradient-to-br from-[#78350f]/30 to-transparent rounded-2xl border border-amber-500/20 p-3">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-black/20 rounded-xl p-2 text-center"><div className="text-amber-400 font-black text-base leading-none">{phpDisplay(commissionSummary?.l1Cents ?? 0)}</div><div className="text-white/50 text-[9px] mt-0.5">L1 · 25%</div></div>
                  <div className="bg-black/20 rounded-xl p-2 text-center"><div className="text-amber-400 font-black text-base leading-none">{phpDisplay(commissionSummary?.l2Cents ?? 0)}</div><div className="text-white/50 text-[9px] mt-0.5">L2 · 8%</div></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/20 rounded-xl p-2 text-center"><div className="text-amber-400 font-black text-base leading-none">{phpDisplay(commissionSummary?.l3Cents ?? 0)}</div><div className="text-white/50 text-[9px] mt-0.5">L3 · 3%</div></div>
                  <div className="bg-amber-500/20 rounded-xl p-2 text-center border border-amber-500/30"><div className="text-amber-300 font-black text-base leading-none">{phpDisplay(commissionSummary?.totalCents ?? 0)}</div><div className="text-amber-300/60 text-[9px] mt-0.5">{t('team.total')}</div></div>
                </div>
              </div>
            </div>
            <div className="px-4 space-y-2 pb-4">
              {commissionLoading ? (
                Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)
              ) : !commissionItems.length ? (
                <div className="py-8 text-center text-muted-foreground"><TrendingUp size={36} className="mx-auto mb-3 opacity-30" /><p className="text-sm">{t('team.noCommissions')}</p></div>
              ) : commissionItems.map((item, i) => (
                <div key={i} className="flex items-center gap-3 bg-secondary rounded-xl px-3 py-2.5">
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${levelBadge[item.level]}`}>L{item.level}</span>
                  <div className="flex-1 min-w-0"><p className="text-foreground font-bold text-xs leading-none mb-0.5">{item.displayName}</p><p className="text-muted-foreground text-[10px]">GGR {phpDisplay(item.ggrCents)} × {item.ratePct}%</p></div>
                  <div className="text-right flex-shrink-0"><p className="text-amber-400 font-black text-sm leading-none">{phpDisplay(item.commissionCents)}</p><p className={`text-[9px] mt-0.5 ${statusColor[item.status] ?? 'text-muted-foreground'}`}>{item.status}</p></div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'withdraw' && (
          <>
            <div className="px-4 pt-4 pb-3">
              <div className="bg-gradient-to-br from-[#78350f]/30 to-transparent rounded-2xl border border-amber-500/20 p-4 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/70 mb-1">{t('team.available')}</p>
                <p className="text-4xl font-black text-amber-400 leading-none mb-2">{phpDisplay(teamWallet?.availableCents ?? 0)}</p>
                <div className="flex justify-center gap-4 text-[10px] text-muted-foreground">
                  <span>{t('team.frozen')}: {phpDisplay(teamWallet?.frozenCents ?? 0)}</span>
                  <span>{t('team.lifetime')}: {phpDisplay(teamWallet?.lifetimeEarnedCents ?? 0)}</span>
                </div>
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className="bg-secondary rounded-2xl p-4 mb-3">
                <p className="text-xs font-bold text-foreground mb-2">{t('team.withdrawAmount')}</p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">₱</span>
                    <input type="number" value={withdrawInput} placeholder={`${t('team.minWithdraw')} ₱50`} min="50" step="1" className="w-full bg-background rounded-xl pl-7 pr-3 py-2.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-amber-500 border border-border" onChange={(e) => setWithdrawInput(e.target.value)} />
                  </div>
                  <button type="button" className="px-3 py-2.5 bg-amber-500/20 text-amber-400 rounded-xl text-xs font-bold" onClick={() => setWithdrawInput(String((teamWallet?.availableCents ?? 0) / 100))}>{t('team.max')}</button>
                </div>
                {withdrawError && <p className="text-red-400 text-xs mt-1.5">{withdrawError}</p>}
                <p className="text-muted-foreground text-[10px] mt-1.5">{t('team.withdrawHint')}</p>
              </div>
              <button type="button" className={`w-full py-3 rounded-xl font-black text-sm transition-opacity ${withdrawing ? 'bg-amber-500/50 text-black/50' : 'bg-amber-500 text-black'}`} disabled={withdrawing} onClick={() => void submitWithdraw()}>
                {withdrawing ? t('team.withdrawing') : t('team.withdrawSubmit')}
              </button>
            </div>
            <div className="px-4 pb-6">
              <p className="text-xs font-bold text-foreground mb-2">{t('team.withdrawHistory')}</p>
              {withdrawalsLoading ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary mb-2" />)
              ) : !withdrawals.length ? (
                <div className="py-6 text-center text-muted-foreground text-xs">{t('team.noWithdrawals')}</div>
              ) : withdrawals.map((wd) => {
                const StatusIcon = wd.status === 'approved' ? CheckCircle2 : wd.status === 'rejected' ? XCircle : Clock
                return (
                  <div key={wd.id} className="flex items-center gap-3 bg-secondary rounded-xl px-3 py-3 mb-2">
                    <StatusIcon size={18} className={`flex-shrink-0 ${statusColor[wd.status] ?? 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0"><p className="text-foreground font-bold text-sm leading-none mb-0.5">{phpDisplay(wd.amountCents)}</p><p className="text-muted-foreground text-[10px]">{new Date(wd.createdAt).toLocaleDateString()}</p>{wd.rejectReason && <p className="text-red-400 text-[10px] mt-0.5">{wd.rejectReason}</p>}</div>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${wd.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : wd.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{wd.status}</span>
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
