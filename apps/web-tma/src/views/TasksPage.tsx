import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarDays, Check, Sparkles, Star, Users, type LucideIcon,
} from 'lucide-react'
import {
  fetchTaskCenter, claimTask, claimSocialTask,
  type TaskCenter, type TaskCard,
} from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { ApiError } from '@/api/client'
import BindModal from '@/components/auth/BindModal'
import taskHero from '@/assets/tasks/task-hero.webp'
import iconBirthday from '@/assets/tasks/icon-birthday.webp'
import iconClaimable from '@/assets/tasks/icon-claimable.webp'
import iconDownload from '@/assets/tasks/icon-download.webp'
import iconGame from '@/assets/tasks/icon-game.webp'
import iconInvite from '@/assets/tasks/icon-invite.webp'
import iconPhone from '@/assets/tasks/icon-phone.webp'
import iconProfile from '@/assets/tasks/icon-profile.webp'
import iconRewards from '@/assets/tasks/icon-rewards.webp'
import iconWallet from '@/assets/tasks/icon-wallet.webp'

export type TaskPath = 'newbie' | 'daily' | 'social'

const PATHS: TaskPath[] = ['newbie', 'daily', 'social']
const EMPTY_CENTER: TaskCenter = { groups: { newbie: [], daily: [], achievement: [], social: [] } }

export default function TasksPage({ initialPath = 'newbie', onNavigate }: { initialPath?: TaskPath; onNavigate?: (target: string) => void }) {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const [center, setCenter] = useState<TaskCenter | null>(null)
  const [activePath, setActivePath] = useState<TaskPath>('newbie')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({})
  const [bindOpen, setBindOpen] = useState(false)

  const load = useCallback(async () => {
    try { setCenter(await fetchTaskCenter()) } catch { setCenter(EMPTY_CENTER) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setActivePath(initialPath) }, [initialPath])

  const groups = center?.groups ?? EMPTY_CENTER.groups
  const allCards = useMemo(
    () => [...groups.newbie, ...groups.daily, ...groups.achievement, ...groups.social],
    [groups],
  )

  const pathCards = useMemo(() => {
    const growthIds = new Set(allCards.filter((card) => card.reward.type === 'growth').map((card) => card.id))
    const dailyMilestones = groups.achievement.filter((card) => card.id.startsWith('agg_checkin_ms'))
    return {
      newbie: groups.newbie.filter((card) => !growthIds.has(card.id)),
      daily: [...groups.daily, ...dailyMilestones].filter((card) => !growthIds.has(card.id)),
      social: groups.social.filter((card) => !growthIds.has(card.id)),
    } satisfies Record<TaskPath, TaskCard[]>
  }, [allCards, groups])

  const summary = useMemo(() => {
    const claimable = allCards.filter((card) => card.status === 'claimable')
    let cash = 0
    let cashCurrency = 'PHP'
    let spins = 0
    let growth = 0
    for (const card of claimable) {
      if (card.reward.type === 'cash') {
        cash += card.reward.amount
        cashCurrency = card.reward.currency || cashCurrency
      } else if (card.reward.type === 'spin') {
        spins += card.reward.spin
      } else if (card.reward.type === 'growth') {
        growth += card.reward.amount
      }
    }
    return {
      total: allCards.length,
      done: allCards.filter((card) => card.status === 'done').length,
      claimable: claimable.length,
      cash,
      cashCurrency,
      spins,
      growth,
    }
  }, [allCards])

  // 原生/聚合卡按稳定 id 查 i18n（缺失回落后端中文标题）；社群卡是后台自定义文案，直接用后端值
  function cardTitle(card: TaskCard): string {
    if (card.id.startsWith('agg_checkin_ms')) return t('tasks.item.checkin_ms.title', { n: card.progress?.target ?? 0 })
    return t(`tasks.item.${card.id}.title`, { defaultValue: card.title })
  }
  function cardSubtitle(card: TaskCard): string {
    if (card.id.startsWith('agg_checkin_ms')) return t('tasks.item.checkin_ms.subtitle', { defaultValue: card.subtitle })
    return t(`tasks.item.${card.id}.subtitle`, { defaultValue: card.subtitle })
  }

  function rewardText(card: TaskCard): string {
    const r = card.reward
    if (r.type === 'cash') return r.amount > 0 ? `+${formatCurrencyAmount(r.currency, r.amount)}` : ''
    if (r.type === 'spin') return r.spin > 0 ? t('tasks.rewardSpin', { n: r.spin }) : ''
    return r.amount > 0 ? t('tasks.rewardGrowth', { n: r.amount }) : ''
  }

  async function afterSuccess(msg: string) {
    alert(msg)
    await Promise.all([load(), useWalletStore.getState().refresh()])
  }

  // 原生任务领取
  async function onClaimNative(card: TaskCard) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (busyId) return
    setBusyId(card.id)
    try {
      await claimTask(card.id)
      await afterSuccess(t('tasks.claimSuccess', { reward: rewardText(card) }))
    } catch (e) {
      alert(e instanceof ApiError ? e.message : t('tasks.claimFailed'))
    } finally { setBusyId(null) }
  }

  // 社群任务领取（bind_only / tg_member / code_redeem / manual_review）
  async function onClaimSocial(card: TaskCard) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (busyId) return
    const kind = card.action.kind
    const input: { code?: string; screenshotUrl?: string } = {}
    if (kind === 'code_redeem') {
      const code = (codeInputs[card.id] ?? '').trim()
      if (!code) { alert(t('tasks.codeRequired')); return }
      input.code = code
    }
    if (kind === 'manual_review') {
      const url = window.prompt(t('tasks.screenshotPrompt')) ?? ''
      if (!url.trim()) return
      input.screenshotUrl = url.trim()
    }
    setBusyId(card.id)
    try {
      const res = await claimSocialTask(card.id, input)
      if (res.status === 'pending_review') { alert(t('tasks.submittedReview')); await load() }
      else await afterSuccess(t('tasks.claimSuccess', { reward: rewardText(card) }))
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : ''
      if (msg === 'need_bind_telegram') { setBindOpen(true); return }
      if (msg === 'not_member') { alert(t('tasks.notMember')); return }
      if (msg === 'bad_code') { alert(t('tasks.badCode')); return }
      alert(msg || t('tasks.claimFailed'))
    } finally { setBusyId(null) }
  }

  function onCardAction(card: TaskCard) {
    if (card.action.kind === 'open_module') {
      if (card.action.target === 'bind_profile') { setBindOpen(true); return }
      onNavigate?.(card.action.target ?? '')
      return
    }
    if (card.group === 'social') { void onClaimSocial(card); return }
    void onClaimNative(card)
  }

  function actionLabel(card: TaskCard): string {
    const busy = busyId === card.id
    if (card.status === 'done') return t('tasks.done')
    if (busy) return t('tasks.claiming')
    if (card.status === 'locked') return t('tasks.todo')
    if (card.action.kind === 'open_module') return t('tasks.go')
    if (card.action.kind === 'bind_telegram') return t('tasks.bind')
    if (card.action.kind === 'goto') return t('tasks.verify')
    if (card.action.kind === 'manual_review') return t('tasks.submit')
    return t('tasks.claim')
  }

  function taskIcon(card: TaskCard): string {
    if (card.id === 'profile_complete') return iconProfile
    if (card.id === 'first_game') return iconGame
    if (card.id === 'invite_milestone') return iconInvite
    if (card.id === 'agg_trial') return iconPhone
    if (card.id === 'agg_appdl') return iconDownload
    if (card.id === 'agg_firstdep' || card.id === 'daily_deposit') return iconWallet
    if (card.id === 'agg_birthday') return iconBirthday
    if (card.id === 'daily_login' || card.id === 'agg_checkin' || card.id.startsWith('agg_checkin_ms')) return iconRewards
    if (card.group === 'social') return iconInvite
    return iconClaimable
  }

  function renderSummary() {
    const rewardParts = [
      summary.cash > 0 ? formatCurrencyAmount(summary.cashCurrency, summary.cash) : '',
      summary.spins > 0 ? t('tasks.rewardSpin', { n: summary.spins }).replace('+', '') : '',
      summary.growth > 0 ? t('tasks.rewardGrowth', { n: summary.growth }).replace('+', '') : '',
    ].filter(Boolean)
    const progressPct = summary.total > 0 ? Math.min(100, Math.round(summary.done / summary.total * 100)) : 0

    return (
      <section className="relative overflow-hidden px-3 pb-3 pt-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(255,185,28,0.3),transparent_31%),radial-gradient(circle_at_40%_38%,rgba(255,190,34,0.1),transparent_30%)]" />
        {/* 素材 411x400 带 alpha：统计卡区域已挖空+底部渐隐，底边藏在统计卡后手臂完整露出 */}
        <img
          src={taskHero}
          alt=""
          className="pointer-events-none absolute right-0 top-0 h-auto w-[46%] max-w-[186px]"
        />
        <div className="pointer-events-none absolute right-0 top-0 h-[172px] w-[52%] bg-gradient-to-l from-transparent via-transparent to-[#050403]" />
        <div className="relative">
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-[#ffd21c]">
            <Sparkles size={12} fill="currentColor" strokeWidth={2.8} />
            {t('tasks.tree.todayPath')}
            <Sparkles size={12} fill="currentColor" strokeWidth={2.8} />
          </p>
          <h1 className="mt-1.5 text-[29px] font-black leading-none text-white [text-shadow:0_2px_16px_rgba(255,255,255,0.18)]">
            {t('tasks.pageTitle')}
          </h1>
          <div className="mt-3 flex max-w-[190px] items-center gap-2.5">
            <div className="h-[10px] flex-1 overflow-hidden rounded-full bg-black/72 shadow-[inset_0_1px_4px_rgba(255,196,31,0.16)]">
              <div className="h-full rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000]" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="rounded-full bg-[#ffd21d] px-2.5 py-1 text-[13px] font-black leading-none text-[#211300] shadow-[0_8px_22px_rgba(255,185,20,0.32)]">
              {summary.done}/{summary.total}
            </div>
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <SummaryTile icon={iconClaimable} label={t('tasks.tree.claimable')} value={String(summary.claimable)} />
          <SummaryTile icon={iconRewards} label={t('tasks.tree.rewards')} value={rewardParts.length ? rewardParts.join(' · ') : '-'} />
        </div>
      </section>
    )
  }

  function renderTabs() {
    const tabIcons = { newbie: Star, daily: CalendarDays, social: Users } satisfies Record<TaskPath, LucideIcon>
    return (
      <div className="sticky top-0 z-20 bg-[#050403]/94 px-3 py-2 backdrop-blur">
        <div className="flex rounded-[16px] bg-[#16110a] p-[5px]">
          {PATHS.map((path, i) => {
            const active = activePath === path
            const prevActive = i > 0 && activePath === PATHS[i - 1]
            const Icon = tabIcons[path]
            return (
              <div key={path} className="flex min-w-0 flex-1 items-center">
                {i > 0 && <span className={`h-[18px] w-px flex-shrink-0 bg-[#8a6a35]/45 ${active || prevActive ? 'opacity-0' : ''}`} />}
                <button
                  type="button"
                  onClick={() => setActivePath(path)}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-1 py-2 text-[13px] font-black transition-colors ${active ? 'bg-gradient-to-b from-[#ffdb37] to-[#ffc400] text-[#241600] shadow-[0_5px_16px_rgba(255,193,17,0.34)]' : 'text-[#f3e5cb]'}`}
                >
                  {path === 'daily'
                    ? <CalendarSolid size={16} className={active ? '' : 'text-[#e0b878]'} punch={active ? '#ffd230' : '#16110a'} />
                    : <Icon size={16} className={active ? '' : 'text-[#e0b878]'} fill="currentColor" strokeWidth={2.4} />}
                  {t(`tasks.path.${path}`)}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderTaskNode(card: TaskCard, index: number, total: number) {
    const done = card.status === 'done'
    const busy = busyId === card.id
    const isClaimable = card.status === 'claimable'
    const isMilestone = Boolean(card.progress) || card.group === 'achievement'
    const kind = card.action.kind
    const showCode = kind === 'code_redeem' && !done
    const disabled = done || busy || (kind === 'claim' && !isClaimable)
    const reward = rewardText(card)
    const buttonLabel = reward || actionLabel(card)
    const progressPct = card.progress ? Math.min(100, Math.round((card.progress.current / Math.max(1, card.progress.target)) * 100)) : 0
    const icon = taskIcon(card)
    const buttonTone = done ? 'bg-gradient-to-b from-[#27d85d] to-[#09963b] text-white shadow-[0_7px_18px_rgba(12,189,74,0.25)]'
      : 'bg-gradient-to-b from-[#ff961f] to-[#ff6500] text-white shadow-[0_7px_18px_rgba(255,101,0,0.28)]'

    return (
      <div key={card.id} className="relative flex gap-2.5">
        <div className="flex w-[38px] flex-shrink-0 flex-col items-center">
          {done ? (
            <span className="z-[1] mt-[6px] flex h-[33px] w-[33px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_38%_30%,#33c96a,#0a9440)] text-white shadow-[0_0_16px_rgba(0,189,80,0.5)]">
              <Check size={19} strokeWidth={4.2} />
            </span>
          ) : (
            <span className="z-[1] mt-[8px] flex h-[29px] w-[29px] items-center justify-center rounded-full border border-[#8a6425]/60 bg-[#14100a] text-[#d2a878] shadow-[0_0_10px_rgba(255,190,40,0.12)]">
              <LockSolid size={13} />
            </span>
          )}
          {index < total - 1 && <span className="h-full min-h-[24px] w-px bg-gradient-to-b from-[#ffc31e]/72 via-[#7d520d]/70 to-[#7d520d]/30" />}
        </div>

        <div className="mb-1.5 min-w-0 flex-1 rounded-[11px] border border-[#6d480f]/45 bg-[#0a0906]/90 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,206,89,0.05)]">
          <div className="flex items-center gap-2.5">
            <img src={icon} alt="" className="h-[44px] w-[44px] flex-shrink-0 rounded-[9px]" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                {isMilestone && <span className="flex-shrink-0 rounded-full border border-[#81550f]/80 bg-black/42 px-1.5 py-0.5 text-[8px] font-black uppercase leading-none text-[#ffd21d]">{t('tasks.tree.milestone')}</span>}
                <p className="truncate text-[13px] font-black leading-tight text-[#fff8ea]">{cardTitle(card)}</p>
              </div>
              {cardSubtitle(card) && <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-[#e8d5b5]">{cardSubtitle(card)}</p>}
              {card.progress && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-[#1c1710] shadow-[inset_0_1px_3px_rgba(0,0,0,0.65)]">
                    <div className="h-full rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000]" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="min-w-[26px] text-[11px] font-black text-[#f0dfc5]">{card.progress.current}/{card.progress.target}</span>
                </div>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {card.group === 'social' && kind === 'goto' && card.action.url && !done && (
                <a href={card.action.url} target="_blank" rel="noreferrer"
                  className="rounded-full border border-[#ffc31e]/50 px-2 py-1 text-[10px] font-black text-[#ffd78a] active:scale-95">
                  {t('tasks.go')}
                </a>
              )}
              <button
                type="button"
                onClick={() => onCardAction(card)}
                disabled={disabled}
                className={`min-w-[64px] rounded-full px-2.5 py-1.5 text-[12px] font-black leading-none active:scale-95 disabled:cursor-default ${!done && disabled ? 'opacity-95' : ''} ${buttonTone}`}
              >
                {buttonLabel}
              </button>
            </div>
          </div>

          {showCode && (
            <div className="mt-2 flex gap-2 pl-[46px]">
              <input
                value={codeInputs[card.id] ?? ''}
                onChange={(e) => setCodeInputs((s) => ({ ...s, [card.id]: e.target.value }))}
                placeholder={t('tasks.codePlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-[#8c5c12]/70 bg-black/48 px-3 py-1.5 text-[12px] text-amber-50 placeholder:text-amber-200/40 outline-none"
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderPath() {
    const cards = pathCards[activePath]
    const totalNodes = cards.length
    return (
      <section className="px-3 pb-10 pt-1">
        <div className="mb-2.5 flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[14px] font-black uppercase tracking-[0.18em] text-[#ffd21d]">
              <Sparkles size={12} fill="currentColor" />
              {t(`tasks.path.${activePath}`)}
              <Sparkles size={12} fill="currentColor" />
            </p>
            <p className="mt-0.5 text-[11px] text-[#eeddbf]">{t(`tasks.pathSub.${activePath}`)}</p>
          </div>
          <span className="mt-0.5 rounded-full border border-[#8a5b13]/70 bg-black/38 px-2.5 py-1 text-[12px] font-black leading-none text-[#f0dfc5]">
            {cards.filter((card) => card.status === 'done').length}/{cards.length}
          </span>
        </div>
        {totalNodes === 0 ? (
          <div className="rounded-[13px] border border-[#7f520f]/55 bg-[#080806]/86 px-4 py-8 text-center">
            <Sparkles size={26} className="mx-auto text-[#ffd21d]" />
            <p className="mt-2 text-sm font-bold text-[#f0dfc5]">{t('tasks.empty')}</p>
          </div>
        ) : (
          <div>
            {cards.map((card, index) => renderTaskNode(card, index, totalNodes))}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="page-main min-h-screen pb-4" style={{ background: 'linear-gradient(180deg,#050403 0%,#080603 42%,#040302 100%)' }}>
      {renderSummary()}
      {renderTabs()}
      {renderPath()}
      <BindModal open={bindOpen} onClose={() => { setBindOpen(false); void load() }} />
    </div>
  )
}

function SummaryTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[11px] border border-[#8a5b13]/50 bg-[#0d0b08] px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,206,89,0.06)]">
      <img src={icon} alt="" className="h-[34px] w-[34px] flex-shrink-0 rounded-full" />
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium leading-tight text-[#f0dfc5]">{label}</span>
        <span className="mt-0.5 block truncate text-[14px] font-black leading-none text-[#ffd21d]">{value}</span>
      </span>
    </div>
  )
}

// 设计稿时间线锁=实心挂锁，lucide 无实心变体，手写路径
function LockSolid({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 1.5A5.5 5.5 0 0 0 6.5 7v3.06A3.5 3.5 0 0 0 4 13.4v5.1A3.5 3.5 0 0 0 7.5 22h9a3.5 3.5 0 0 0 3.5-3.5v-5.1a3.5 3.5 0 0 0-2.5-3.34V7A5.5 5.5 0 0 0 12 1.5Zm3.3 8.4H8.7V7a3.3 3.3 0 0 1 6.6 0v2.9Z" />
      <circle cx="12" cy="14.8" r="1.55" fill="#14100a" />
      <rect x="11.25" y="15.4" width="1.5" height="2.7" rx="0.75" fill="#14100a" />
    </svg>
  )
}

// 设计稿 Daily 图标=实心日历（lucide 描边版填色后细节会糊掉），punch=镂空点颜色需跟随所在底色
function CalendarSolid({ size, className, punch }: { size: number; className?: string; punch: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="currentColor" d="M7 1.6c.72 0 1.3.58 1.3 1.3v.9h7.4v-.9a1.3 1.3 0 0 1 2.6 0v.94A3.1 3.1 0 0 1 21 6.9V19a3.1 3.1 0 0 1-3.1 3.1H6.1A3.1 3.1 0 0 1 3 19V6.9a3.1 3.1 0 0 1 2.7-3.06V2.9c0-.72.58-1.3 1.3-1.3Z" />
      <rect x="3" y="7.7" width="18" height="1.5" fill={punch} />
      <circle cx="8.2" cy="12.8" r="1.1" fill={punch} /><circle cx="12" cy="12.8" r="1.1" fill={punch} /><circle cx="15.8" cy="12.8" r="1.1" fill={punch} />
      <circle cx="8.2" cy="17" r="1.1" fill={punch} /><circle cx="12" cy="17" r="1.1" fill={punch} />
    </svg>
  )
}
