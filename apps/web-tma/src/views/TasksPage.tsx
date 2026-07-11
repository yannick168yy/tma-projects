import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarDays, Check, ChevronRight, Sparkles, Star, Users, type LucideIcon,
} from 'lucide-react'
import {
  fetchTaskCenter, claimTask, claimSocialTask, TASKS_REFRESH_EVENT,
  type TaskCenter, type TaskCard,
} from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { useActiveTaskStore } from '@/stores/activeTask'
import { ApiError } from '@/api/client'
import BindModal from '@/components/auth/BindModal'
import { cardSubtitle as labelSubtitle, cardTitle as labelTitle, rewardText as labelReward } from '@/components/tasks/taskLabels'
import { fetchVipProgress } from '@/api/vip'
import { fetchRebateProgress } from '@/api/rebate'
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

// 金色花瓣粒子：位置/尺寸/节奏错开，呼应 hero 图里的飘落花瓣
const PETALS: React.CSSProperties[] = [
  { left: '12%', width: 9,  height: 13, animationDuration: '8.5s',  animationDelay: '0s' },
  { left: '32%', width: 7,  height: 10, animationDuration: '10.5s', animationDelay: '2.2s' },
  { left: '55%', width: 11, height: 15, animationDuration: '9s',    animationDelay: '4.1s' },
  { left: '74%', width: 8,  height: 11, animationDuration: '11.5s', animationDelay: '1.3s' },
  { left: '90%', width: 9,  height: 13, animationDuration: '9.8s',  animationDelay: '5.4s' },
]
const STAYS_ON_TASKS_PAGE = new Set(['checkin', 'trial_bonus', 'app_download', 'deposit'])

export default function TasksPage({ initialPath = 'newbie', onNavigate }: { initialPath?: TaskPath; onNavigate?: (target: string) => void }) {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const [center, setCenter] = useState<TaskCenter | null>(null)
  const [activePath, setActivePath] = useState<TaskPath>('newbie')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [justClaimedId, setJustClaimedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({})
  const [bindOpen, setBindOpen] = useState(false)
  const startActiveTask = useActiveTaskStore((s) => s.start)
  const clearActiveTask = useActiveTaskStore((s) => s.clear)

  const prevStatusRef = useRef<Map<string, string> | null>(null)
  const load = useCallback(async () => {
    try {
      const next = await fetchTaskCenter()
      const flat = [...next.groups.newbie, ...next.groups.daily, ...next.groups.achievement, ...next.groups.social]
      // 状态从非 done → done 的卡（在签到/体验金等模块内完成后回来），触发绿勾达成动效
      const prev = prevStatusRef.current
      if (prev) {
        const newlyDone = flat.find((c) => c.status === 'done' && prev.has(c.id) && prev.get(c.id) !== 'done')
        if (newlyDone) setJustClaimedId(newlyDone.id)
      }
      prevStatusRef.current = new Map(flat.map((c) => [c.id, c.status]))
      setCenter(next)
    } catch { setCenter(EMPTY_CENTER) }
  }, [])
  useEffect(() => { void load() }, [load])
  // 模块弹层（签到/体验金/充值/装机）关闭后刷新任务状态
  useEffect(() => {
    const onRefresh = () => { void load() }
    window.addEventListener(TASKS_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(TASKS_REFRESH_EVENT, onRefresh)
  }, [load])
  useEffect(() => { setActivePath(initialPath) }, [initialPath])
  // 回到任务中心即视为这一轮跟随结束，卡片本身已展示进度与领取入口
  useEffect(() => { clearActiveTask() }, [clearActiveTask])

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

  const cardTitle = (card: TaskCard) => labelTitle(t, card)
  // 设计稿：邀请卡只留标题+进度条，不显示副标题
  const cardSubtitle = (card: TaskCard) => (card.id === 'invite_milestone' ? '' : labelSubtitle(t, card))
  const rewardText = (card: TaskCard) => labelReward(t, card)

  // 页内 toast 取代原生 alert：不打断操作流，成功带金币入场动效
  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast({ msg, kind })
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current) }, [])

  async function afterSuccess(msg: string) {
    showToast(msg, 'ok')
    await Promise.all([load(), useWalletStore.getState().refresh()])
  }

  // 原生任务领取
  async function onClaimNative(card: TaskCard) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (busyId) return
    setBusyId(card.id)
    try {
      await claimTask(card.id)
      setJustClaimedId(card.id)
      await afterSuccess(t('tasks.claimSuccess', { reward: rewardText(card) }))
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t('tasks.claimFailed'), 'err')
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
      if (!code) { showToast(t('tasks.codeRequired'), 'err'); return }
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
      if (res.status === 'pending_review') { showToast(t('tasks.submittedReview'), 'ok'); await load() }
      else { setJustClaimedId(card.id); await afterSuccess(t('tasks.claimSuccess', { reward: rewardText(card) })) }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : ''
      if (msg === 'need_bind_telegram') { setBindOpen(true); return }
      if (msg === 'not_member') { showToast(t('tasks.notMember'), 'err'); return }
      if (msg === 'bad_code') { showToast(t('tasks.badCode'), 'err'); return }
      showToast(msg || t('tasks.claimFailed'), 'err')
    } finally { setBusyId(null) }
  }

  function onCardAction(card: TaskCard) {
    if (card.action.kind === 'open_module') {
      if (card.action.target === 'bind_profile') { setBindOpen(true); return }
      // 这些 target 只在任务页上开模态/弹层，用户没离开任务中心，不需要任务条
      if (!STAYS_ON_TASKS_PAGE.has(card.action.target ?? '')) startActiveTask(card)
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
    if (card.id === 'agg_firstdep' || card.id.startsWith('daily_deposit')) return iconWallet
    if (card.id === 'daily_bets' || card.id === 'daily_play') return iconGame
    if (card.id === 'agg_birthday') return iconBirthday
    if (card.id === 'agg_checkin' || card.id.startsWith('agg_checkin_ms')) return iconRewards
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
    const [titleFirst, ...titleRestArr] = t('tasks.pageTitle').split(' ')
    const titleParts = { first: titleFirst, rest: titleRestArr.join(' ') }

    return (
      <section className="relative pb-3">
        {/* hero 可视区=50vh-半卡高：统计卡中线跨机型都压在屏高 50% 分界线，上下内容跟随该区移动 */}
        <div className="relative h-[calc(50vh-25px)] max-h-[470px] min-h-[300px] overflow-hidden">
          <img
            src={taskHero}
            alt=""
            className="task-kenburns pointer-events-none absolute inset-0 h-full w-full object-cover object-top"
          />
          {/* 金色花瓣飘落粒子 */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {PETALS.map((style, i) => <span key={i} className="task-petal" style={style} />)}
          </div>
          {/* 图底纯色渐变过渡到页面底色（无模糊），锚定图底自动跟随 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[90px] bg-gradient-to-b from-transparent via-[#050403]/45 to-[#050403]" />
          {/* 标题块锚定图底，跨机型与统计卡保持固定间距 */}
          <div className="absolute inset-x-0 bottom-[34px] px-5">
            <p className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.18em] text-[#ffb81c] [text-shadow:0_1px_6px_rgba(60,30,0,0.65)]">
              <Sparkles size={9} fill="currentColor" strokeWidth={2.8} className="task-sparkle" />
              {t('tasks.tree.todayPath')}
              <Sparkles size={9} fill="currentColor" strokeWidth={2.8} className="task-sparkle-alt" />
            </p>
            {/* 设计稿 Task 偏小 Center 偏大；中文等无空格标题保持单行；字号控宽避开人物 */}
            <h1 className="mt-1 font-black leading-[0.92] text-[#1f1305]">
              {titleParts.rest ? (
                <>
                  <span className="block text-[22px]">{titleParts.first}</span>
                  <span className="block text-[31px]">{titleParts.rest}</span>
                </>
              ) : (
                <span className="block text-[27px]">{titleParts.first}</span>
              )}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-[8px] w-[96px] overflow-hidden rounded-full bg-[#221a10]/85 shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]">
                <div className="task-progress-fill task-grow h-full rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000]" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="rounded-full bg-[#ffd21d] px-2 py-1 text-[11px] font-black leading-none text-[#211300] shadow-[0_6px_18px_rgba(60,30,0,0.35)]">
                {summary.done}/{summary.total}
              </div>
            </div>
          </div>
        </div>
        {/* 负半卡高上移：卡片上半压 hero、下半压背景 */}
        <div className="relative -mt-[25px] grid grid-cols-[5fr_6fr] gap-2 px-5">
          <SummaryTile icon={iconClaimable} label={t('tasks.tree.claimable')} value={String(summary.claimable)} iconClass={summary.claimable > 0 ? 'task-wiggle' : ''} />
          <SummaryTile icon={iconRewards} label={t('tasks.tree.rewards')} value={rewardParts.length ? rewardParts.join(' · ') : '-'} />
        </div>
      </section>
    )
  }

  function renderTabs() {
    const tabIcons = { newbie: Star, daily: CalendarDays, social: Users } satisfies Record<TaskPath, LucideIcon>
    return (
      <div className="sticky top-0 z-20 bg-[#050403]/94 px-3 py-2 backdrop-blur">
        <div className="relative flex rounded-[16px] bg-[#16110a] p-[5px]">
          {/* 滑动黄胶囊：随选中项平移，按钮自身不再带底色 */}
          <span
            className="pointer-events-none absolute bottom-[5px] top-[5px] rounded-full bg-gradient-to-b from-[#ffdb37] to-[#ffc400] shadow-[0_5px_16px_rgba(255,193,17,0.34)] transition-[left] duration-300 ease-out"
            style={{ width: 'calc((100% - 10px) / 3)', left: `calc(${PATHS.indexOf(activePath)} * (100% - 10px) / 3 + 5px)` }}
          />
          {PATHS.map((path, i) => {
            const active = activePath === path
            const prevActive = i > 0 && activePath === PATHS[i - 1]
            const Icon = tabIcons[path]
            return (
              <div key={path} className="relative flex min-w-0 flex-1 items-center">
                {i > 0 && <span className={`h-[18px] w-px flex-shrink-0 bg-[#8a6a35]/45 transition-opacity ${active || prevActive ? 'opacity-0' : ''}`} />}
                <button
                  type="button"
                  onClick={() => setActivePath(path)}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-1 py-2 text-[13px] font-black transition-colors duration-300 ${active ? 'text-[#241600]' : 'text-[#f3e5cb]'}`}
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
    // MILESTONE 徽章只给成就/邀请里程碑；每日进度卡（存款阶梯/投注挑战）不标，避免标题被挤截断
    const isMilestone = card.group === 'achievement' || card.id === 'invite_milestone'
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
      <div key={card.id} className="task-card-in relative flex gap-2.5" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
        <div className="flex w-[38px] flex-shrink-0 flex-col items-center">
          {done ? (
            <span className={`z-[1] mt-[11px] flex aspect-square h-[29px] w-[29px] flex-shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_38%_30%,#33c96a,#0a9440)] text-white shadow-[0_0_16px_rgba(0,189,80,0.5)] ${justClaimedId === card.id ? 'task-pop-ring' : ''}`}>
              <Check size={16} strokeWidth={4.2} />
            </span>
          ) : (
            <span className="z-[1] mt-[11px] flex aspect-square h-[29px] w-[29px] flex-shrink-0 items-center justify-center rounded-full border border-[#8a6425]/60 bg-[#14100a] text-[#d2a878] shadow-[0_0_10px_rgba(255,190,40,0.12)]">
              <LockSolid size={13} />
            </span>
          )}
          {index < total - 1 && <span className="h-full min-h-[24px] w-px bg-gradient-to-b from-[#ffc31e]/72 via-[#7d520d]/70 to-[#7d520d]/30" />}
        </div>

        <div className="mb-1.5 min-w-0 flex-1 rounded-[12px] border border-[#6d480f]/45 bg-[#0a0906]/90 px-2.5 py-3 shadow-[inset_0_1px_0_rgba(255,206,89,0.05)]">
          <div className="flex items-center gap-2.5">
            <img src={icon} alt="" className="h-[48px] w-[48px] flex-shrink-0 rounded-[10px]" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1">
                <p className="truncate text-[13px] font-black leading-tight text-[#fff8ea]">{cardTitle(card)}</p>
                {isMilestone && <span className="flex-shrink-0 rounded-full border border-[#81550f]/80 bg-black/42 px-1 py-0.5 text-[8px] font-black uppercase leading-none text-[#ffd21d]">{t('tasks.tree.milestone')}</span>}
              </div>
              {cardSubtitle(card) && <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-[#e8d5b5]">{cardSubtitle(card)}</p>}
              {card.progress && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-[#1c1710] shadow-[inset_0_1px_3px_rgba(0,0,0,0.65)]">
                    <div className="task-progress-fill task-grow h-full rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000]" style={{ width: `${progressPct}%` }} />
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
                className={`min-w-[64px] rounded-full px-2.5 py-1.5 text-[12px] font-black leading-none active:scale-95 disabled:cursor-default ${!done && disabled ? 'opacity-95' : ''} ${isClaimable && kind !== 'open_module' && !busy ? 'task-btn-pulse' : ''} ${buttonTone}`}
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
      <section className="px-3 pb-4 pt-1">
        <div className="mb-2.5 flex items-start justify-between px-2">
          <div>
            <p className="flex items-center gap-1.5 text-[14px] font-black uppercase tracking-[0.18em] text-[#ffd21d]">
              <Sparkles size={12} fill="currentColor" className="task-sparkle" />
              {t(`tasks.path.${activePath}`)}
              <Sparkles size={12} fill="currentColor" className="task-sparkle-alt" />
            </p>
            <p className="mt-0.5 text-[11px] text-[#eeddbf]">{t(`tasks.pathSub.${activePath}`)}</p>
          </div>
          <span className="mt-0.5 rounded-full border border-[#8a5b13]/70 bg-black/38 px-2.5 py-1 text-[12px] font-black leading-none text-[#f0dfc5]">
            {cards.filter((card) => card.status === 'done').length}/{cards.length}
          </span>
        </div>
        {activePath === 'daily' && <DailyEarningsCard onNavigate={onNavigate} />}
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
      <TasksFooter />
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
          <div className={`task-toast-in flex max-w-full items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-black shadow-[0_10px_30px_rgba(0,0,0,0.5)] ${toast.kind === 'ok' ? 'border-[#2f7a44] bg-[#122d18] text-[#8dffb5]' : 'border-[#7a2f2a] bg-[#2f1412] text-[#ffb3a8]'}`}>
            <span className="task-coin text-[15px] leading-none">{toast.kind === 'ok' ? '🪙' : '⚠️'}</span>
            <span className="min-w-0 truncate">{toast.msg}</span>
          </div>
        </div>
      )}
      <BindModal open={bindOpen} onClose={() => { setBindOpen(false); void load() }} />
    </div>
  )
}

function SummaryTile({ icon, label, value, iconClass = '' }: { icon: string; label: string; value: string; iconClass?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[12px] bg-[#12100b]/95 px-2.5 py-2 shadow-[0_4px_14px_rgba(0,0,0,0.4)]">
      <img src={icon} alt="" className={`h-[34px] w-[34px] flex-shrink-0 rounded-full ${iconClass}`} />
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium leading-tight text-[#f0e6d2]">{label}</span>
        <span className="mt-0.5 block truncate text-[12px] font-black leading-none text-[#ffd21d]">{value}</span>
      </span>
    </div>
  )
}

// 每日收益聚合卡：洗码可领 + VIP 进度，纯展示跳转，不新增经济（高玩的"每日目标"可视化）
function DailyEarningsCard({ onNavigate }: { onNavigate?: (target: string) => void }) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const [data, setData] = useState<{ rebate: number; currency: string; vipNext: { level: number; need: number } | null } | null>(null)

  useEffect(() => {
    if (!token) { setData(null); return }
    let alive = true
    void (async () => {
      try {
        const [reb, vip] = await Promise.all([fetchRebateProgress(), fetchVipProgress()])
        if (!alive) return
        setData({
          rebate: reb.claimable,
          currency: reb.currency,
          vipNext: vip.nextLevel != null && vip.nextThreshold != null
            ? { level: vip.nextLevel, need: Math.max(0, vip.nextThreshold - vip.totalTurnover) }
            : null,
        })
      } catch { /* 拉不到就不显示 */ }
    })()
    return () => { alive = false }
  }, [token])

  if (!token || !data) return null
  return (
    <div className="mb-2.5 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onNavigate?.('cashback')}
        className="flex min-w-0 items-center justify-between gap-1.5 rounded-[12px] border border-[#6d480f]/45 bg-[#0a0906]/90 px-3 py-2.5 text-left active:scale-[0.98]"
      >
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-medium text-[#d8c7a5]">{t('tasks.earn.rebate')}</span>
          <span className="mt-0.5 block truncate text-[13px] font-black leading-none text-[#ffd21d]">
            {formatCurrencyAmount(data.currency, data.rebate)}
          </span>
        </span>
        <ChevronRight size={14} className="flex-shrink-0 text-[#a98b57]" />
      </button>
      <button
        type="button"
        onClick={() => onNavigate?.('vip_center')}
        className="flex min-w-0 items-center justify-between gap-1.5 rounded-[12px] border border-[#6d480f]/45 bg-[#0a0906]/90 px-3 py-2.5 text-left active:scale-[0.98]"
      >
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-medium text-[#d8c7a5]">{t('tasks.earn.vipLabel')}</span>
          <span className="mt-0.5 block truncate text-[13px] font-black leading-none text-[#ffd21d]">
            {data.vipNext
              ? t('tasks.earn.vipNext', { n: data.vipNext.level, amt: formatCurrencyAmount(data.currency, data.vipNext.need) })
              : t('tasks.earn.vipMax')}
          </span>
        </span>
        <ChevronRight size={14} className="flex-shrink-0 text-[#a98b57]" />
      </button>
    </div>
  )
}

// 页面底部说明区：玩法三步 + 奖励规则，充实列表下方留白
function TasksFooter() {
  const { t } = useTranslation()
  const steps = [
    { title: t('tasks.footer.step1Title'), sub: t('tasks.footer.step1Sub') },
    { title: t('tasks.footer.step2Title'), sub: t('tasks.footer.step2Sub') },
    { title: t('tasks.footer.step3Title'), sub: t('tasks.footer.step3Sub') },
  ]
  const notes = [t('tasks.footer.note1'), t('tasks.footer.note2'), t('tasks.footer.note3'), t('tasks.footer.note4')]
  return (
    <section className="px-5 pb-10">
      <p className="flex items-center gap-1.5 text-[13px] font-black uppercase tracking-[0.16em] text-[#ffd21d]">
        <Sparkles size={11} fill="currentColor" />
        {t('tasks.footer.howTitle')}
      </p>
      <div className="mt-2.5 space-y-2">
        {steps.map((step, i) => (
          <div key={step.title} className="flex items-center gap-3 rounded-[12px] bg-[#0d0b08] px-3 py-2.5">
            <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000] text-[13px] font-black text-[#241600]">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-black leading-tight text-[#fff8ea]">{step.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-[#d8c7a5]">{step.sub}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-5 flex items-center gap-1.5 text-[13px] font-black uppercase tracking-[0.16em] text-[#ffd21d]">
        <Sparkles size={11} fill="currentColor" />
        {t('tasks.footer.notesTitle')}
      </p>
      <ul className="mt-2.5 space-y-1.5 rounded-[12px] bg-[#0d0b08] px-3.5 py-3">
        {notes.map((note) => (
          <li key={note} className="flex gap-2 text-[11px] leading-snug text-[#c9b89a]">
            <span className="mt-[5px] h-[4px] w-[4px] flex-shrink-0 rounded-full bg-[#ffc31e]/80" />
            {note}
          </li>
        ))}
      </ul>
    </section>
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
