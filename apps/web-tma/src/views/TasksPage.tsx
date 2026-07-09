import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, Crown, Lock, Milestone, Sparkles } from 'lucide-react'
import {
  fetchTaskCenter, claimTask, claimSocialTask,
  type TaskCenter, type TaskCard,
} from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { ApiError } from '@/api/client'
import BindModal from '@/components/auth/BindModal'

export type TaskPath = 'newbie' | 'daily' | 'growth' | 'social'

const PATHS: TaskPath[] = ['newbie', 'daily', 'growth', 'social']
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
      growth: allCards.filter((card) => card.reward.type === 'growth'),
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

  function renderSummary() {
    const rewardParts = [
      summary.cash > 0 ? formatCurrencyAmount(summary.cashCurrency, summary.cash) : '',
      summary.spins > 0 ? t('tasks.rewardSpin', { n: summary.spins }).replace('+', '') : '',
      summary.growth > 0 ? t('tasks.rewardGrowth', { n: summary.growth }).replace('+', '') : '',
    ].filter(Boolean)
    const progressPct = summary.total > 0 ? Math.min(100, Math.round(summary.done / summary.total * 100)) : 0

    return (
      <section className="mx-4 mt-3 overflow-hidden rounded-2xl border border-amber-300/30 bg-gradient-to-br from-[#241605] via-[#0c0905] to-[#050403] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-300/80">{t('tasks.tree.todayPath')}</p>
            <h1 className="mt-1 text-xl font-black text-amber-50">{t('tasks.pageTitle')}</h1>
          </div>
          <div className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-[#241604]">
            {summary.done}/{summary.total}
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/35">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-yellow-500" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SummaryTile label={t('tasks.tree.claimable')} value={String(summary.claimable)} />
          <SummaryTile label={t('tasks.tree.rewards')} value={rewardParts.length ? rewardParts.join(' · ') : '—'} />
        </div>
      </section>
    )
  }

  function renderTabs() {
    return (
      <div className="sticky top-0 z-10 bg-[#050403]/92 px-4 py-3 backdrop-blur">
        <div className="grid grid-cols-4 rounded-xl border border-amber-300/18 bg-black/25 p-1">
          {PATHS.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => setActivePath(path)}
              className={`rounded-lg px-1 py-2 text-[10px] font-black transition-colors ${activePath === path ? 'bg-amber-300 text-[#241604]' : 'text-amber-100/58'}`}
            >
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
    const locked = card.status === 'locked'
    const isClaimable = card.status === 'claimable'
    const isMilestone = Boolean(card.progress) || card.group === 'achievement'
    const kind = card.action.kind
    const showCode = kind === 'code_redeem' && !done
    const disabled = done || busy || (kind === 'claim' && !isClaimable)
    const reward = rewardText(card)
    const progressPct = card.progress ? Math.min(100, Math.round((card.progress.current / Math.max(1, card.progress.target)) * 100)) : 0
    const NodeIcon = done ? CheckCircle2 : locked ? Lock : isMilestone ? Milestone : Circle
    const nodeTone = done ? 'text-emerald-300 border-emerald-300/35 bg-emerald-300/10'
      : isClaimable ? 'text-amber-300 border-amber-300/55 bg-amber-300/12'
        : 'text-amber-100/45 border-amber-300/18 bg-black/28'

    return (
      <div key={card.id} className="relative flex gap-3">
        <div className="flex w-8 flex-shrink-0 flex-col items-center">
          <span className={`z-[1] flex h-8 w-8 items-center justify-center rounded-full border ${nodeTone}`}>
            <NodeIcon size={16} />
          </span>
          {index < total - 1 && <span className="mt-1 h-full min-h-8 w-px bg-gradient-to-b from-amber-300/35 to-amber-300/8" />}
        </div>

        <div className={`mb-3 min-w-0 flex-1 rounded-2xl border px-4 py-3.5 ${isClaimable ? 'border-amber-300/35 bg-[#110c05]' : 'border-amber-300/18 bg-[#0c0905]/76'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {isMilestone && <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300">{t('tasks.tree.milestone')}</span>}
                <p className="truncate text-sm font-black text-amber-50">{cardTitle(card)}</p>
              </div>
              {cardSubtitle(card) && <p className="mt-0.5 line-clamp-2 text-xs text-amber-200/62">{cardSubtitle(card)}</p>}
              {reward && <p className="mt-1 text-xs font-bold text-amber-300">{reward}</p>}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {card.group === 'social' && kind === 'goto' && card.action.url && !done && (
                <a href={card.action.url} target="_blank" rel="noreferrer"
                  className="rounded-full border border-amber-300/40 px-3 py-2 text-xs font-black text-amber-200 active:scale-95">
                  {t('tasks.go')}
                </a>
              )}
              <button
                type="button"
                onClick={() => onCardAction(card)}
                disabled={disabled}
                className={`min-w-[68px] rounded-full px-4 py-2 text-xs font-black active:scale-95 disabled:opacity-45 ${isClaimable ? 'bg-gradient-to-b from-amber-300 to-yellow-500 text-[#2a1a05]' : 'border border-amber-300/25 text-amber-100/70'}`}
              >
                {actionLabel(card)}
              </button>
            </div>
          </div>

          {card.progress && (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-yellow-500" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-[11px] font-bold text-amber-200/70">{card.progress.current}/{card.progress.target}</span>
            </div>
          )}

          {showCode && (
            <div className="mt-2.5 flex gap-2">
              <input
                value={codeInputs[card.id] ?? ''}
                onChange={(e) => setCodeInputs((s) => ({ ...s, [card.id]: e.target.value }))}
                placeholder={t('tasks.codePlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-amber-300/20 bg-black/40 px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/40 outline-none"
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderVipNode(index: number, total: number) {
    return (
      <div className="relative flex gap-3">
        <div className="flex w-8 flex-shrink-0 flex-col items-center">
          <span className="z-[1] flex h-8 w-8 items-center justify-center rounded-full border border-amber-300/55 bg-amber-300/12 text-amber-300">
            <Crown size={16} />
          </span>
          {index < total - 1 && <span className="mt-1 h-full min-h-8 w-px bg-gradient-to-b from-amber-300/35 to-amber-300/8" />}
        </div>
        <div className="mb-3 min-w-0 flex-1 rounded-2xl border border-amber-300/22 bg-[#0c0905]/76 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-amber-50">{t('tasks.tree.vipTitle')}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-amber-200/62">{t('tasks.tree.vipSub')}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.('vip_center')}
              className="flex-shrink-0 rounded-full bg-gradient-to-b from-amber-300 to-yellow-500 px-4 py-2 text-xs font-black text-[#2a1a05] active:scale-95"
            >
              {t('tasks.tree.vipBtn')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderPath() {
    const cards = pathCards[activePath]
    const hasVipNode = activePath === 'growth'
    const totalNodes = cards.length + (hasVipNode ? 1 : 0)
    return (
      <section className="px-4 pb-10">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-amber-300/80">{t(`tasks.path.${activePath}`)}</p>
            <p className="mt-0.5 text-xs text-amber-100/45">{t(`tasks.pathSub.${activePath}`)}</p>
          </div>
          <span className="rounded-full border border-amber-300/20 px-2.5 py-1 text-[11px] font-black text-amber-200/70">
            {cards.filter((card) => card.status === 'done').length}/{cards.length}
          </span>
        </div>
        {totalNodes === 0 ? (
          <div className="rounded-2xl border border-amber-300/18 bg-[#0c0905]/76 px-4 py-8 text-center">
            <Sparkles size={26} className="mx-auto text-amber-300/70" />
            <p className="mt-2 text-sm font-bold text-amber-100/60">{t('tasks.empty')}</p>
          </div>
        ) : (
          <div>
            {cards.map((card, index) => renderTaskNode(card, index, totalNodes))}
            {hasVipNode && renderVipNode(cards.length, totalNodes)}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="page-main min-h-screen pb-4 pt-3" style={{ background: 'linear-gradient(180deg,#050403 0%,#080603 42%,#040302 100%)' }}>
      {renderSummary()}
      {renderTabs()}
      {renderPath()}
      <BindModal open={bindOpen} onClose={() => { setBindOpen(false); void load() }} />
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-black/28 px-3 py-2">
      <p className="truncate text-[10px] font-bold text-amber-100/45">{label}</p>
      <p className="mt-0.5 truncate text-sm font-black text-amber-300">{value}</p>
    </div>
  )
}
