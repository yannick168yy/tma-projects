import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarDays, Check, Lock, Sparkles, Star, Users, type LucideIcon,
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
      <section className="relative overflow-hidden px-3 pb-3 pt-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(255,185,28,0.34),transparent_31%),radial-gradient(circle_at_40%_38%,rgba(255,190,34,0.12),transparent_30%)]" />
        <img
          src={taskHero}
          alt=""
          className="pointer-events-none absolute right-[-18px] top-0 h-[172px] w-[214px] object-cover object-left-top opacity-95"
        />
        <div className="pointer-events-none absolute right-0 top-0 h-[180px] w-[56%] bg-gradient-to-l from-transparent via-transparent to-[#050403]" />
        <div className="relative">
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-[#ffd21c]">
            <Sparkles size={12} fill="currentColor" strokeWidth={2.8} />
            {t('tasks.tree.todayPath')}
            <Sparkles size={12} fill="currentColor" strokeWidth={2.8} />
          </p>
          <h1 className="mt-2 text-[30px] font-black leading-none text-white [text-shadow:0_2px_16px_rgba(255,255,255,0.18)]">
            {t('tasks.pageTitle')}
          </h1>
          <div className="mt-7 flex max-w-[202px] items-center gap-3">
            <div className="h-[11px] flex-1 overflow-hidden rounded-full bg-black/72 shadow-[inset_0_1px_4px_rgba(255,196,31,0.16)]">
              <div className="h-full rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000]" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="rounded-full bg-[#ffd21d] px-3 py-1.5 text-[15px] font-black leading-none text-[#211300] shadow-[0_8px_22px_rgba(255,185,20,0.32)]">
              {summary.done}/{summary.total}
            </div>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2.5">
          <SummaryTile icon={iconClaimable} label={t('tasks.tree.claimable')} value={String(summary.claimable)} />
          <SummaryTile icon={iconRewards} label={t('tasks.tree.rewards')} value={rewardParts.length ? rewardParts.join(' · ') : '-'} />
        </div>
      </section>
    )
  }

  function renderTabs() {
    const tabIcons = { newbie: Star, daily: CalendarDays, social: Users } satisfies Record<TaskPath, LucideIcon>
    return (
      <div className="sticky top-0 z-20 bg-[#050403]/94 px-3 py-2.5 backdrop-blur">
        <div className="grid grid-cols-3 overflow-hidden rounded-[14px] border border-[#8a5b13]/55 bg-black/38 p-1 shadow-[0_0_24px_rgba(255,174,22,0.08)]">
          {PATHS.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => setActivePath(path)}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-[11px] px-1.5 py-2.5 text-[13px] font-black transition-colors ${activePath === path ? 'bg-gradient-to-b from-[#ffe15a] to-[#ffc000] text-[#1c1300] shadow-[0_5px_16px_rgba(255,193,17,0.34)]' : 'text-[#d8b889]'}`}
            >
              {(() => {
                const Icon = tabIcons[path]
                return <Icon size={17} fill={activePath === path ? 'currentColor' : 'none'} strokeWidth={2.7} />
              })()}
              {t(`tasks.path.${path}`)}
            </button>
          ))}
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
      <div key={card.id} className="relative flex gap-3">
        <div className="flex w-[43px] flex-shrink-0 flex-col items-center">
          <span className={`z-[1] mt-[9px] flex h-[31px] w-[31px] items-center justify-center rounded-full border ${done ? 'border-[#15b653]/70 bg-[#05a647] text-white shadow-[0_0_18px_rgba(0,189,80,0.42)]' : 'border-[#875714]/80 bg-[#14100a] text-[#d2b083]'}`}>
            {done ? <Check size={19} strokeWidth={4} /> : <Lock size={14} strokeWidth={2.6} />}
          </span>
          {index < total - 1 && <span className="h-full min-h-[36px] w-px bg-gradient-to-b from-[#ffc31e]/72 via-[#7d520d]/70 to-[#7d520d]/30" />}
        </div>

        <div className="mb-2.5 min-w-0 flex-1 rounded-[10px] border border-[#7f520f]/55 bg-[#080806]/86 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,206,89,0.06)]">
          <div className="flex items-center gap-2.5">
            <img src={icon} alt="" className="h-[46px] w-[46px] flex-shrink-0 rounded-[9px]" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                {isMilestone && <span className="flex-shrink-0 rounded-full border border-[#81550f]/80 bg-black/42 px-1.5 py-0.5 text-[8px] font-black uppercase leading-none text-[#ffd21d]">{t('tasks.tree.milestone')}</span>}
                <p className="truncate text-[15px] font-black leading-tight text-[#fff8ea]">{cardTitle(card)}</p>
              </div>
              {cardSubtitle(card) && <p className="mt-0.5 line-clamp-2 text-[12px] font-medium leading-snug text-[#f0dfc5]">{cardSubtitle(card)}</p>}
              {card.progress && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[#1c1710] shadow-[inset_0_1px_3px_rgba(0,0,0,0.65)]">
                    <div className="h-full rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000]" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="min-w-[30px] text-[12px] font-black text-[#f0dfc5]">{card.progress.current}/{card.progress.target}</span>
                </div>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {card.group === 'social' && kind === 'goto' && card.action.url && !done && (
                <a href={card.action.url} target="_blank" rel="noreferrer"
                  className="rounded-full border border-[#ffc31e]/50 px-2.5 py-1.5 text-[11px] font-black text-[#ffd78a] active:scale-95">
                  {t('tasks.go')}
                </a>
              )}
              <button
                type="button"
                onClick={() => onCardAction(card)}
                disabled={disabled}
                className={`min-w-[76px] rounded-full px-3 py-2 text-[13px] font-black leading-none active:scale-95 disabled:cursor-default ${!done && disabled ? 'opacity-95' : ''} ${buttonTone}`}
              >
                {buttonLabel}
              </button>
            </div>
          </div>

          {showCode && (
            <div className="mt-2.5 flex gap-2 pl-[56px]">
              <input
                value={codeInputs[card.id] ?? ''}
                onChange={(e) => setCodeInputs((s) => ({ ...s, [card.id]: e.target.value }))}
                placeholder={t('tasks.codePlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-[#8c5c12]/70 bg-black/48 px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/40 outline-none"
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
      <section className="px-3 pb-10">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[18px] font-black uppercase tracking-[0.12em] text-[#ffd21d]">
              <Sparkles size={14} fill="currentColor" />
              {t(`tasks.path.${activePath}`)}
              <Sparkles size={14} fill="currentColor" />
            </p>
            <p className="mt-0.5 text-[13px] text-[#f0dfc5]">{t(`tasks.pathSub.${activePath}`)}</p>
          </div>
          <span className="mt-1 rounded-full border border-[#8a5b13]/70 bg-black/38 px-3 py-1.5 text-[14px] font-black leading-none text-[#f0dfc5]">
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
    <div className="flex min-w-0 items-center gap-2.5 rounded-[13px] border border-[#8a5b13]/55 bg-black/54 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,206,89,0.06)]">
      <img src={icon} alt="" className="h-[44px] w-[44px] flex-shrink-0 rounded-full" />
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium leading-tight text-[#f0dfc5]">{label}</span>
        <span className="mt-0.5 block truncate text-[18px] font-black leading-none text-[#ffd21d]">{value}</span>
      </span>
    </div>
  )
}
