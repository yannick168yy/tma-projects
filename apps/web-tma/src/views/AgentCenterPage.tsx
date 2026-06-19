import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Users, Wallet, TrendingUp, Link2, Bot, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { getAgentCenter, type AgentCenter } from '@/api/agent'

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  const abs = Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (val < 0 ? '-₱' : '₱') + abs
}

export default function AgentCenterPage({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AgentCenter | null>(null)

  useEffect(() => {
    let alive = true
    getAgentCenter()
      .then((d) => { if (alive) setData(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const statusMeta = (s: string) => {
    if (s === 'paid') return { icon: CheckCircle2, cls: 'text-emerald-400', label: t('agentCenter.statusPaid') }
    if (s === 'voided') return { icon: XCircle, cls: 'text-muted-foreground', label: t('agentCenter.statusVoided') }
    return { icon: Clock, cls: 'text-amber-400', label: t('agentCenter.statusPending') }
  }

  return (
    <div className="page-main min-h-full pb-24">
      <div
        className="relative overflow-hidden px-4 pb-5 pt-3"
        style={{ background: 'linear-gradient(150deg, #063b36 0%, #0f5132 48%, #18181b 100%)' }}
      >
        <button type="button" className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white" onClick={onClose}>
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-black text-white">{t('agentCenter.title')}</h1>
        {data && <p className="mt-1 text-sm text-white/60">{data.agent.name}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-primary"><TrendingUp size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.rateLabel')}</span></div>
            <p className="text-base font-black text-primary">{data?.agent.ggrRatePct ?? 0}%</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-cyan-200"><Users size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.usersLabel')}</span></div>
            <p className="text-base font-black text-cyan-100">{data?.userCount ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-emerald-300"><Wallet size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.lifetimeLabel')}</span></div>
            <p className="text-base font-black text-emerald-200">{phpDisplay(data?.summary.lifetime_commission_cents ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-amber-300"><Clock size={13} /><span className="text-[10px] font-black uppercase text-white/45">{t('agentCenter.pendingLabel')}</span></div>
            <p className="text-base font-black text-amber-200">{phpDisplay(data?.summary.pending_cents ?? 0)}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-5 px-4">
        <section>
          <h3 className="mb-2.5 px-1 font-display text-sm font-black uppercase text-foreground">{t('agentCenter.channelsTitle')}</h3>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">…</div>
            ) : data && data.channels.length > 0 ? (
              data.channels.map((c, i) => (
                <div key={`${c.channel_type}-${c.channel_value}`} className={`flex items-center gap-3 px-4 py-3 ${i < data.channels.length - 1 ? 'border-b border-border' : ''}`}>
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
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
          <h3 className="mb-2.5 px-1 font-display text-sm font-black uppercase text-foreground">{t('agentCenter.commissionsTitle')}</h3>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-2 text-[10px] font-black uppercase text-muted-foreground">
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
