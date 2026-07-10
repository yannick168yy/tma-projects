import type { TFunction } from 'i18next'
import type { TaskCard } from '@/api/tasks'
import { formatCurrencyAmount } from '@/stores/wallet'

// 原生/聚合卡按稳定 id 查 i18n（缺失回落后端中文标题）；社群卡是后台自定义文案，直接用后端值
export function cardTitle(t: TFunction, card: TaskCard): string {
  if (card.id.startsWith('agg_checkin_ms')) return t('tasks.item.checkin_ms.title', { n: card.progress?.target ?? 0 })
  return t(`tasks.item.${card.id}.title`, { defaultValue: card.title })
}

export function cardSubtitle(t: TFunction, card: TaskCard): string {
  if (card.id.startsWith('agg_checkin_ms')) return t('tasks.item.checkin_ms.subtitle', { defaultValue: card.subtitle })
  return t(`tasks.item.${card.id}.subtitle`, { defaultValue: card.subtitle })
}

export function rewardText(t: TFunction, card: TaskCard): string {
  const r = card.reward
  if (r.type === 'cash') return r.amount > 0 ? `+${formatCurrencyAmount(r.currency, r.amount)}` : ''
  if (r.type === 'spin') return r.spin > 0 ? t('tasks.rewardSpin', { n: r.spin }) : ''
  return r.amount > 0 ? t('tasks.rewardGrowth', { n: r.amount }) : ''
}
