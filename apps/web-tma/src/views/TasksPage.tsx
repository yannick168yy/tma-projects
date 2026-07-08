import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchTaskCenter, claimTask, claimSocialTask,
  type TaskCenter, type TaskCard, type TaskGroup,
} from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { ApiError } from '@/api/client'
import BindModal from '@/components/auth/BindModal'

const GROUP_ORDER: TaskGroup[] = ['newbie', 'daily', 'achievement', 'social']

export default function TasksPage() {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const [center, setCenter] = useState<TaskCenter | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({})
  const [bindOpen, setBindOpen] = useState(false)

  const load = useCallback(async () => {
    try { setCenter(await fetchTaskCenter()) } catch { setCenter({ groups: { newbie: [], daily: [], achievement: [], social: [] } }) }
  }, [])
  useEffect(() => { void load() }, [load])

  function rewardText(card: TaskCard): string {
    const r = card.reward
    if (r.type === 'cash') return `+${formatCurrencyAmount(r.currency, r.amount)}`
    if (r.type === 'spin') return t('tasks.rewardSpin', { n: r.spin })
    return t('tasks.rewardGrowth', { n: r.amount })
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

  function renderCard(card: TaskCard) {
    const done = card.status === 'done'
    const busy = busyId === card.id
    const isSocial = card.group === 'social'
    const showCode = isSocial && card.action.kind === 'code_redeem' && !done

    return (
      <div key={card.id} className="mx-4 mt-3 rounded-2xl border border-amber-300/25 bg-[#0c0905]/75 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-amber-50 font-black text-sm truncate">{card.title}</p>
            {card.subtitle && <p className="text-amber-200/70 text-xs mt-0.5 truncate">{card.subtitle}</p>}
            <p className="text-amber-300 text-xs font-bold mt-1">{rewardText(card)}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {isSocial && card.action.kind === 'goto' && card.action.url && !done && (
              <a href={card.action.url} target="_blank" rel="noreferrer"
                className="rounded-full border border-amber-300/40 px-4 py-2 text-xs font-black text-amber-200 active:scale-95">
                {t('tasks.go')}
              </a>
            )}
            <button
              type="button"
              onClick={() => void (isSocial ? onClaimSocial(card) : onClaimNative(card))}
              disabled={done || busy || (!isSocial && card.status !== 'claimable')}
              className="rounded-full bg-gradient-to-b from-amber-300 to-yellow-500 px-5 py-2 text-xs font-black text-[#2a1a05] disabled:opacity-40"
            >
              {done ? t('tasks.done')
                : busy ? t('tasks.claiming')
                : card.action.kind === 'bind_telegram' ? t('tasks.bind')
                : isSocial && card.action.kind === 'goto' ? t('tasks.verify')
                : isSocial && card.action.kind === 'manual_review' ? t('tasks.submit')
                : !isSocial && card.status === 'locked' ? t('tasks.todo')
                : t('tasks.claim')}
            </button>
          </div>
        </div>
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
    )
  }

  const groups = center?.groups
  const nonEmpty = groups && GROUP_ORDER.some((g) => groups[g].length > 0)

  return (
    <div className="page-main min-h-screen pb-10 pt-3">
      <h1 className="px-4 text-lg font-black text-amber-50">{t('tasks.pageTitle')}</h1>
      {!nonEmpty && <p className="px-4 mt-8 text-center text-sm text-amber-200/60">{t('tasks.empty')}</p>}
      {groups && GROUP_ORDER.map((g) => (
        groups[g].length > 0 && (
          <section key={g} className="mt-4">
            <p className="px-4 text-xs font-black uppercase tracking-wide text-amber-300/80">{t(`tasks.group.${g}`)}</p>
            {groups[g].map(renderCard)}
          </section>
        )
      ))}
      <BindModal open={bindOpen} onClose={() => { setBindOpen(false); void load() }} />
    </div>
  )
}
