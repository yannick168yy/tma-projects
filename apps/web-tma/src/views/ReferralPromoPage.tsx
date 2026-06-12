import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Copy, Share2, Users, TrendingUp, Wallet, CheckCircle2, ChevronRight, Send, Zap, Info } from 'lucide-react'
import { fetchTeamStatus, enableAgent } from '@/api/promotion'
import type { TeamAgentStatus } from '@/types/api'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'

interface Props {
  onClose: () => void
  onOpenTeamCenter: () => void
}

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  return '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReferralPromoPage({ onClose, onOpenTeamCenter }: Props) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<TeamAgentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [enabling, setEnabling] = useState(false)
  const [copied, setCopied] = useState(false)

  const inviteCode = user?.inviteCode ?? ''
  const telegramLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const webShareLink = useMemo(() => buildInviteWebLink(inviteCode), [inviteCode])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    fetchTeamStatus()
      .then(setStatus)
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [user])

  const isAgent = status?.isAgent ?? false
  const isActivated = status?.activated ?? false
  const l1 = status?.ratePlan.l1RatePct ?? null
  const l2 = status?.ratePlan.l2RatePct ?? null
  const l3 = status?.ratePlan.l3RatePct ?? null

  async function onEnable() {
    setEnabling(true)
    try {
      await enableAgent()
      const updated = await fetchTeamStatus()
      setStatus(updated)
    } catch { /* ignore */ }
    finally { setEnabling(false) }
  }

  function onCopyLink() {
    void navigator.clipboard.writeText(telegramLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function onShareNative() {
    if (navigator.share) {
      void navigator.share({ title: 'BetoGo', text: telegramLink, url: webShareLink })
    } else {
      onCopyLink()
    }
  }

  function onShareTelegram() {
    const text = encodeURIComponent(`Join BetoGo — use my code ${inviteCode}!\n${telegramLink}`)
    const url = `https://t.me/share/url?url=${encodeURIComponent(telegramLink)}&text=${text}`
    window.open(url, '_blank')
  }

  const tiers = [
    {
      level: 1,
      label: t('referralPromo.l1Label'),
      desc: t('referralPromo.l1Desc'),
      pyramidLabel: t('referralPromo.pyramidL1'),
      color: 'from-amber-500/20 to-amber-600/10',
      badge: 'bg-amber-500/20 text-amber-400',
      border: 'border-amber-500/20',
      icon: 'text-amber-400',
      rate: l1,
    },
    {
      level: 2,
      label: t('referralPromo.l2Label'),
      desc: t('referralPromo.l2Desc'),
      pyramidLabel: t('referralPromo.pyramidL2'),
      color: 'from-blue-500/20 to-blue-600/10',
      badge: 'bg-blue-500/20 text-blue-400',
      border: 'border-blue-500/20',
      icon: 'text-blue-400',
      rate: l2,
    },
    {
      level: 3,
      label: t('referralPromo.l3Label'),
      desc: t('referralPromo.l3Desc'),
      pyramidLabel: t('referralPromo.pyramidL3'),
      color: 'from-purple-500/20 to-purple-600/10',
      badge: 'bg-purple-500/20 text-purple-400',
      border: 'border-purple-500/20',
      icon: 'text-purple-400',
      rate: l3,
    },
  ]

  const steps = [
    { step: '01', title: t('referralPromo.step1Title'), desc: t('referralPromo.step1Desc') },
    { step: '02', title: t('referralPromo.step2Title'), desc: t('referralPromo.step2Desc') },
    { step: '03', title: t('referralPromo.step3Title'), desc: t('referralPromo.step3Desc') },
  ]

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-y-auto">
      {/* 顶栏 — 用 --app-safe-top 避免与 TMA 关闭按钮重叠 */}
      <div
        className="flex items-center gap-3 px-4 pb-3 flex-shrink-0 bg-background/80 backdrop-blur-sm sticky top-0 z-10"
        style={{ paddingTop: 'calc(var(--app-safe-top) + 8px)' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center active:scale-90 transition-transform"
        >
          <ChevronLeft size={18} className="text-foreground" />
        </button>
        <h1 className="font-display font-black text-base text-foreground">{t('referralPromo.title')}</h1>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden px-4 pt-6 pb-10 flex-shrink-0">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute top-8 -left-20 w-56 h-56 rounded-full bg-blue-500/8 blur-3xl" />
          <div className="absolute bottom-0 right-8 w-40 h-40 rounded-full bg-purple-500/10 blur-2xl" />
        </div>
        {/* 金字塔示意 */}
        <div className="relative flex flex-col items-center mb-6 gap-1.5">
          <div className="w-16 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <span className="text-[10px] font-black text-amber-900">{t('referralPromo.pyramidYou')}</span>
          </div>
          <div className="w-px h-3 bg-gradient-to-b from-amber-400/60 to-blue-400/60" />
          <div className="w-28 h-10 rounded-xl bg-gradient-to-br from-blue-400/80 to-blue-600/80 flex items-center justify-center gap-1 shadow-lg shadow-blue-500/20">
            <Users size={11} className="text-blue-100" />
            <span className="text-[10px] font-black text-blue-100">{tiers[0].pyramidLabel}</span>
          </div>
          <div className="w-px h-3 bg-gradient-to-b from-blue-400/60 to-purple-400/60" />
          <div className="w-40 h-10 rounded-xl bg-gradient-to-br from-purple-400/70 to-purple-600/70 flex items-center justify-center gap-1 shadow-lg shadow-purple-500/20">
            <Users size={11} className="text-purple-100" />
            <span className="text-[10px] font-black text-purple-100">{tiers[1].pyramidLabel}</span>
          </div>
          <div className="w-px h-3 bg-gradient-to-b from-purple-400/60 to-pink-400/60" />
          <div className="w-52 h-10 rounded-xl bg-gradient-to-br from-rose-400/60 to-pink-600/60 flex items-center justify-center gap-1 shadow-lg shadow-rose-500/20">
            <Users size={11} className="text-rose-100" />
            <span className="text-[10px] font-black text-rose-100">{tiers[2].pyramidLabel}</span>
          </div>
        </div>
        <div className="relative text-center">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{t('referralPromo.subtitle')}</p>
          <h2 className="font-display font-black text-3xl text-foreground leading-tight">
            {t('referralPromo.heading1')}<br />
            <span className="text-primary">{t('referralPromo.heading2')}</span>
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('referralPromo.heroParagraph')}</p>
        </div>
      </div>

      {/* 费率卡 */}
      <div className="px-4 space-y-3 flex-shrink-0">
        <h3 className="font-display font-black text-xs text-muted-foreground uppercase tracking-widest">{t('referralPromo.ratesTitle')}</h3>
        {tiers.map((tier) => (
          <div
            key={tier.level}
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-r ${tier.color} border ${tier.border} p-4 flex items-center justify-between`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tier.badge} flex-shrink-0`}>
                <Users size={16} className={tier.icon} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${tier.badge}`}>L{tier.level}</span>
                  <span className="text-sm font-black text-foreground">{tier.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{tier.desc}</p>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-2">
              {tier.rate !== null ? (
                <>
                  <span className={`text-2xl font-black font-display ${tier.icon}`}>{tier.rate}%</span>
                  <p className="text-[10px] text-muted-foreground">{t('referralPromo.rateLabel')}</p>
                </>
              ) : (
                <div className="w-12 h-6 rounded animate-pulse bg-white/10" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── 已开启：团队快照 + 邀请码 + 分享 CTA ── */}
      {!loading && isAgent && (
        <>
          {/* 团队快照 */}
          {status && (status.l1Count > 0 || status.lifetimeEarnedCents > 0) && (
            <div className="mx-4 mt-5 rounded-2xl bg-card border border-border overflow-hidden flex-shrink-0">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp size={14} className="text-primary" />
                  <span className="font-display font-black text-sm text-foreground">{t('referralPromo.teamTitle')}</span>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-primary font-bold active:opacity-60"
                  onClick={onOpenTeamCenter}
                >
                  {t('referralPromo.teamDetails')} <ChevronRight size={12} />
                </button>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border">
                {[
                  { label: t('referralPromo.teamL1'), value: String(status.l1Count) },
                  { label: t('referralPromo.teamTotal'), value: String(status.l1Count + status.l2Count + status.l3Count) },
                  { label: t('referralPromo.teamEarned'), value: phpDisplay(status.lifetimeEarnedCents) },
                ].map((item) => (
                  <div key={item.label} className="py-3 px-2 text-center">
                    <p className="text-base font-black text-foreground">{item.value}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 未激活提示 */}
          {!isActivated && (
            <div className="mx-4 mt-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 flex items-start gap-2.5 flex-shrink-0">
              <Info size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300/80 leading-relaxed">{t('referralPromo.notActivatedHint')}</p>
            </div>
          )}

          {/* 邀请码展示 */}
          {inviteCode && (
            <div className="mx-4 mt-5 rounded-2xl bg-secondary border border-border p-4 flex items-center gap-3 flex-shrink-0">
              <Wallet size={16} className="text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground">{t('referralPromo.codeLabel')}</p>
                <p className="font-display font-black text-primary tracking-widest text-base truncate">{inviteCode}</p>
              </div>
              <button
                type="button"
                onClick={onCopyLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 active:scale-95 transition-transform"
              >
                {copied
                  ? <CheckCircle2 size={13} className="text-emerald-400" />
                  : <Copy size={13} className="text-primary" />}
                <span className="text-[11px] font-bold text-primary">{copied ? t('referralPromo.copied') : t('referralPromo.copy')}</span>
              </button>
            </div>
          )}

          {/* 分享 CTA */}
          <div className="px-4 mt-5 flex-shrink-0" style={{ paddingBottom: 'calc(var(--app-safe-bottom) + 8px)' }}>
            <button
              type="button"
              onClick={onShareNative}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 font-black text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-amber-500/30"
            >
              <Share2 size={16} />
              {t('referralPromo.ctaShare')}
            </button>
            <button
              type="button"
              onClick={onShareTelegram}
              className="mt-3 w-full h-11 rounded-2xl border border-blue-500/30 bg-blue-500/10 text-blue-400 font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <Send size={15} />
              {t('referralPromo.ctaTelegram')}
            </button>
            <button
              type="button"
              onClick={onOpenTeamCenter}
              className="mt-3 w-full h-11 rounded-2xl bg-secondary border border-border text-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <TrendingUp size={15} className="text-primary" />
              {t('referralPromo.ctaTeam')}
            </button>
          </div>
        </>
      )}

      {/* ── 未开启：三步流程 + 开启 CTA ── */}
      {!loading && !isAgent && (
        <>
          <div className="px-4 mt-5 flex-shrink-0">
            <h3 className="font-display font-black text-xs text-muted-foreground uppercase tracking-widest mb-3">{t('referralPromo.stepsTitle')}</h3>
            <div className="space-y-3">
              {steps.map((item) => (
                <div key={item.step} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="font-display font-black text-[10px] text-primary">{item.step}</span>
                  </div>
                  <div className="pt-0.5">
                    <p className="text-sm font-bold text-foreground">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 开启 CTA */}
          <div className="px-4 mt-6 flex-shrink-0" style={{ paddingBottom: 'calc(var(--app-safe-bottom) + 8px)' }}>
            <div className="rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-600/5 border border-amber-500/20 p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={14} className="text-primary" />
                <span className="font-display font-black text-sm text-foreground">{t('referralPromo.enableTitle')}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{t('referralPromo.enableDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => void onEnable()}
              disabled={enabling}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 font-black text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-amber-500/30 disabled:opacity-60 disabled:pointer-events-none"
            >
              <Zap size={16} />
              {enabling ? t('referralPromo.enabling') : t('referralPromo.enableCta')}
            </button>
          </div>
        </>
      )}

      {/* 加载中骨架 */}
      {loading && (
        <div className="px-4 mt-5 space-y-3 flex-shrink-0" style={{ paddingBottom: 'calc(var(--app-safe-bottom) + 8px)' }}>
          <div className="h-12 rounded-2xl animate-pulse bg-white/8" />
          <div className="h-11 rounded-2xl animate-pulse bg-white/5" />
        </div>
      )}
    </div>
  )
}
