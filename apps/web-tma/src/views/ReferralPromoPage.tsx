import { useEffect, useState, useMemo } from 'react'
import { ChevronLeft, Copy, Share2, Users, TrendingUp, Wallet, CheckCircle2, ChevronRight } from 'lucide-react'
import { fetchTeamStatus } from '@/api/promotion'
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
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<TeamAgentStatus | null>(null)
  const [copied, setCopied] = useState(false)

  const inviteCode = user?.inviteCode ?? ''
  const telegramLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const webShareLink = useMemo(() => buildInviteWebLink(inviteCode), [inviteCode])

  useEffect(() => {
    if (!user) return
    fetchTeamStatus().then(setStatus).catch(() => null)
  }, [user])

  const l1 = status?.ratePlan.l1RatePct ?? null
  const l2 = status?.ratePlan.l2RatePct ?? null
  const l3 = status?.ratePlan.l3RatePct ?? null

  function onShare() {
    const text = `加入 BetoGo，用我的邀请码 ${inviteCode} 注册，一起赚钱！\n${telegramLink}`
    if (navigator.share) {
      void navigator.share({ title: 'BetoGo 三级分销', text, url: webShareLink })
    } else {
      void navigator.clipboard.writeText(telegramLink).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  function onCopyLink() {
    void navigator.clipboard.writeText(telegramLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-y-auto">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),16px)] pb-3 flex-shrink-0 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center active:scale-90 transition-transform"
        >
          <ChevronLeft size={18} className="text-foreground" />
        </button>
        <h1 className="font-display font-black text-base text-foreground">三级分销</h1>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden px-4 pt-6 pb-10 flex-shrink-0">
        {/* 背景装饰 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute top-8 -left-20 w-56 h-56 rounded-full bg-blue-500/8 blur-3xl" />
          <div className="absolute bottom-0 right-8 w-40 h-40 rounded-full bg-purple-500/10 blur-2xl" />
        </div>
        {/* 金字塔图示 */}
        <div className="relative flex flex-col items-center mb-6 gap-1.5">
          <div className="w-16 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <span className="text-[10px] font-black text-amber-900">你</span>
          </div>
          <div className="w-px h-3 bg-gradient-to-b from-amber-400/60 to-blue-400/60" />
          <div className="w-28 h-10 rounded-xl bg-gradient-to-br from-blue-400/80 to-blue-600/80 flex items-center justify-center gap-1 shadow-lg shadow-blue-500/20">
            <Users size={11} className="text-blue-100" />
            <span className="text-[10px] font-black text-blue-100">L1 直邀好友</span>
          </div>
          <div className="w-px h-3 bg-gradient-to-b from-blue-400/60 to-purple-400/60" />
          <div className="w-40 h-10 rounded-xl bg-gradient-to-br from-purple-400/70 to-purple-600/70 flex items-center justify-center gap-1 shadow-lg shadow-purple-500/20">
            <Users size={11} className="text-purple-100" />
            <span className="text-[10px] font-black text-purple-100">L2 好友的好友</span>
          </div>
          <div className="w-px h-3 bg-gradient-to-b from-purple-400/60 to-pink-400/60" />
          <div className="w-52 h-10 rounded-xl bg-gradient-to-br from-rose-400/60 to-pink-600/60 flex items-center justify-center gap-1 shadow-lg shadow-rose-500/20">
            <Users size={11} className="text-rose-100" />
            <span className="text-[10px] font-black text-rose-100">L3 第三层下线</span>
          </div>
        </div>
        <div className="relative text-center">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1">被动收入计划</p>
          <h2 className="font-display font-black text-3xl text-foreground leading-tight">
            邀请赚钱<br />
            <span className="text-primary">三层通吃</span>
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">好友下注，你躺赚佣金。好友再邀好友，收益持续叠加。</p>
        </div>
      </div>

      {/* 费率卡 */}
      <div className="px-4 space-y-3 flex-shrink-0">
        <h3 className="font-display font-black text-xs text-muted-foreground uppercase tracking-widest">佣金费率</h3>
        {[
          {
            level: 1, label: '直邀好友', desc: '你亲自邀请的玩家每次下注',
            color: 'from-amber-500/20 to-amber-600/10', badge: 'bg-amber-500/20 text-amber-400',
            border: 'border-amber-500/20', icon: 'text-amber-400', rate: l1,
          },
          {
            level: 2, label: '好友的好友', desc: 'L1 好友邀请的玩家每次下注',
            color: 'from-blue-500/20 to-blue-600/10', badge: 'bg-blue-500/20 text-blue-400',
            border: 'border-blue-500/20', icon: 'text-blue-400', rate: l2,
          },
          {
            level: 3, label: '第三层下线', desc: 'L2 下线再邀请的玩家下注',
            color: 'from-purple-500/20 to-purple-600/10', badge: 'bg-purple-500/20 text-purple-400',
            border: 'border-purple-500/20', icon: 'text-purple-400', rate: l3,
          },
        ].map((tier) => (
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
            <div className="text-right flex-shrink-0">
              {tier.rate !== null ? (
                <>
                  <span className={`text-2xl font-black font-display ${tier.icon}`}>{tier.rate}%</span>
                  <p className="text-[10px] text-muted-foreground">佣金率</p>
                </>
              ) : (
                <div className="w-12 h-6 rounded animate-pulse bg-white/10" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 团队快照（已登录且有数据时显示） */}
      {status && (status.l1Count > 0 || status.lifetimeEarnedCents > 0) && (
        <div className="mx-4 mt-5 rounded-2xl bg-card border border-border overflow-hidden flex-shrink-0">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-primary" />
              <span className="font-display font-black text-sm text-foreground">我的团队</span>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] text-primary font-bold active:opacity-60"
              onClick={onOpenTeamCenter}
            >
              查看详情 <ChevronRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border">
            {[
              { label: 'L1 人数', value: String(status.l1Count) },
              { label: '全部下线', value: String(status.l1Count + status.l2Count + status.l3Count) },
              { label: '累计收益', value: phpDisplay(status.lifetimeEarnedCents) },
            ].map((item) => (
              <div key={item.label} className="py-3 px-2 text-center">
                <p className="text-base font-black text-foreground">{item.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 三步流程 */}
      <div className="px-4 mt-5 flex-shrink-0">
        <h3 className="font-display font-black text-xs text-muted-foreground uppercase tracking-widest mb-3">如何开始</h3>
        <div className="space-y-3">
          {[
            { step: '01', title: '复制专属邀请链接', desc: '点击下方按钮，一键复制你的专属邀请地址' },
            { step: '02', title: '分享给 Telegram 好友', desc: '把链接发给好友，他们通过你的链接注册即绑定关系' },
            { step: '03', title: '好友下注，你持续收益', desc: '好友每次下注，佣金自动结算到你的代理钱包' },
          ].map((item) => (
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

      {/* 邀请码展示 */}
      {inviteCode && (
        <div className="mx-4 mt-5 rounded-2xl bg-secondary border border-border p-4 flex items-center gap-3 flex-shrink-0">
          <Wallet size={16} className="text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground">我的邀请码</p>
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
            <span className="text-[11px] font-bold text-primary">{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      )}

      {/* CTA 按钮 */}
      <div className="px-4 mt-5 mb-[max(env(safe-area-inset-bottom),24px)] space-y-3 flex-shrink-0">
        <button
          type="button"
          onClick={onShare}
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 font-black text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-amber-500/30"
        >
          <Share2 size={16} />
          分享邀请链接，开始赚佣金
        </button>
        <button
          type="button"
          onClick={onOpenTeamCenter}
          className="w-full h-11 rounded-2xl bg-secondary border border-border text-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <TrendingUp size={15} className="text-primary" />
          查看团队中心
        </button>
      </div>
    </div>
  )
}
