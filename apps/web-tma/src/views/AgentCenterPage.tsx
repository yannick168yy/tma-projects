import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Users, Wallet, TrendingUp, Link2, Bot, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { getAgentCenter, getAgentUsers, type AgentCenter, type AgentUser } from '@/api/agent'

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  const abs = Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (val < 0 ? '-₱' : '₱') + abs
}

export default function AgentCenterPage({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AgentCenter | null>(null)
  const [users, setUsers] = useState<AgentUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)

  useEffect(() => {
    let alive = true
    getAgentCenter()
      .then((d) => { if (alive) setData(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    getAgentUsers(1, 50)
      .then((r) => { if (alive) setUsers(r.items) })
      .catch(() => {})
      .finally(() => { if (alive) setUsersLoading(false) })
    return () => { alive = false }
  }, [])

  const statusMeta = (s: string) => {
    if (s === 'paid') return { icon: CheckCircle2, cls: 'text-primary', label: t('agentCenter.statusPaid') }
    if (s === 'voided') return { icon: XCircle, cls: 'text-muted-foreground', label: t('agentCenter.statusVoided') }
    return { icon: Clock, cls: 'text-amber-400', label: t('agentCenter.statusPending') }
  }

  return (
    <div className="page-main min-h-full pb-24">
      <div
        className="relative overflow-hidden border-b border-primary/20 px-4 pb-5 pt-3 shadow-[0_18px_45px_rgba(0,0,0,0.35)]"
        style={{ background: 'radial-gradient(120% 80% at 50% -10%, rgba(255,184,0,0.24) 0%, rgba(255,184,0,0.08) 42%, transparent 70%), linear-gradient(150deg, #07090f 0%, #15100a 52%, #080b14 100%)' }}
      >
        <button type="button" className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-black/25 text-primary" onClick={onClose}>
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-black text-white">{t('agentCenter.title')}</h1>
        {data && <p className="mt-1 text-sm font-bold text-primary/80">{data.agent.name}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-primary/20 bg-black/25 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-primary"><TrendingUp size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.rateLabel')}</span></div>
            <p className="text-base font-black text-primary">{data?.agent.ggrRatePct ?? 0}%</p>
          </div>
          <div className="rounded-xl border border-primary/20 bg-black/25 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-primary"><Users size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.usersLabel')}</span></div>
            <p className="text-base font-black text-amber-100">{data?.userCount ?? 0}</p>
          </div>
          <div className="rounded-xl border border-primary/20 bg-black/25 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-primary"><Wallet size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.lifetimeLabel')}</span></div>
            <p className="text-base font-black text-amber-100">{phpDisplay(data?.summary.lifetime_commission_cents ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-primary/20 bg-black/25 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-primary"><Clock size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.pendingLabel')}</span></div>
            <p className="text-base font-black text-amber-200">{phpDisplay(data?.summary.pending_cents ?? 0)}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-5 px-4">
        <section>
          <h3 className="mb-2.5 px-1 font-display text-sm font-black uppercase text-foreground">{t('agentCenter.channelsTitle')}</h3>
          <div className="overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-[0_12px_30px_rgba(0,0,0,0.22)]">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">…</div>
            ) : data && data.channels.length > 0 ? (
              data.channels.map((c, i) => (
                <div key={`${c.channel_type}-${c.channel_value}`} className={`flex items-center gap-3 px-4 py-3 ${i < data.channels.length - 1 ? 'border-b border-border' : ''}`}>
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                    {c.channel_type === 'bot' ? <Bot size={17} /> : <Link2 size={17} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{c.channel_value}</p>
                    <p className="text-xs text-muted-foreground">{c.channel_type === 'bot' ? t('agentCenter.channelBot') : t('agentCenter.channelDomain')}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t('agentCenter.noChannels')}</div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-2.5 flex items-end justify-between px-1">
            <h3 className="font-display text-sm font-black uppercase text-foreground">{t('agentCenter.usersTitle')}</h3>
            <span className="text-[10px] font-bold uppercase text-muted-foreground">{t('agentCenter.usersGgrHint')}</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-[0_12px_30px_rgba(0,0,0,0.22)]">
            <div className="flex items-center gap-2 border-b border-primary/10 bg-primary/8 px-4 py-2 text-[10px] font-black uppercase text-muted-foreground">
              <span className="flex-1">{t('agentCenter.colUser')}</span>
              <span className="w-28 text-right">{t('agentCenter.colMonthGgr')}</span>
            </div>
            {usersLoading ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">…</div>
            ) : users.length > 0 ? (
              users.map((u) => (
                <div key={u.user_id} className="flex items-center gap-2 border-b border-border px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{u.display_name || u.user_id}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(u.bound_at).toLocaleDateString()}</p>
                  </div>
                  <span className={`w-28 text-right text-sm font-black ${u.ggr_cents < 0 ? 'text-rose-400' : 'text-primary'}`}>{phpDisplay(u.ggr_cents)}</span>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t('agentCenter.noUsers')}</div>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2.5 px-1 font-display text-sm font-black uppercase text-foreground">{t('agentCenter.commissionsTitle')}</h3>
          <div className="overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-[0_12px_30px_rgba(0,0,0,0.22)]">
            <div className="flex items-center gap-2 border-b border-primary/10 bg-primary/8 px-4 py-2 text-[10px] font-black uppercase text-muted-foreground">
              <span className="flex-1">{t('agentCenter.colPeriod')}</span>
              <span className="w-24 text-right">{t('agentCenter.colGgr')}</span>
              <span className="w-24 text-right">{t('agentCenter.colCommission')}</span>
            </div>
            {data && data.commissions.length > 0 ? (
              data.commissions.map((c) => {
                const sm = statusMeta(c.status)
                const StatusIcon = sm.icon
                return (
                  <div key={c.period} className="flex items-center gap-2 border-b border-border px-4 py-3 last:border-b-0">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-foreground">{c.period}</p>
                      <span className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold ${sm.cls}`}><StatusIcon size={11} />{sm.label}</span>
                    </div>
                    <span className="w-24 text-right text-sm font-semibold text-foreground">{phpDisplay(c.ggr_cents)}</span>
                    <span className="w-24 text-right text-sm font-black text-primary">{phpDisplay(c.commission_cents)}</span>
                  </div>
                )
              })
            ) : (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t('agentCenter.noCommissions')}</div>
            )}
          </div>
        </section>

        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">{t('agentCenter.note')}</p>
      </div>
    </div>
  )
}
