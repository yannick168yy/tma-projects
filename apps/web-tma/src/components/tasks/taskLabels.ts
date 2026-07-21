import type { TFunction } from 'i18next'
import type { TaskCard } from '@/api/tasks'
import { formatCurrencyAmount } from '@/stores/wallet'

// 原生/聚合卡按稳定 id 查 i18n（缺失回落后端中文标题）；社群卡是后台自定义文案，直接用后端值
export function cardTitle(t: TFunction, card: TaskCard): string {
  if (card.id.startsWith('agg_checkin_ms')) return t('tasks.item.checkin_ms.title', { n: card.progress?.target ?? 0 })
  // 存款阶梯标题带配置化门槛，按卡片币种格式化（多币种：USDT 显示 USDT 门槛与符号）
  if (card.id.startsWith('daily_deposit_t')) {
    const amt = formatCurrencyAmount(card.reward.currency, card.progress?.target ?? 0)
    return t('tasks.item.daily_deposit_tier.title', { n: amt, defaultValue: card.title })
  }
  // 投注挑战标题带笔数（次数，与币种无关）
  if (card.id === 'daily_bets') return t('tasks.item.daily_bets.title', { n: card.progress?.target ?? 0, defaultValue: card.title })
  return t(`tasks.item.${card.id}.title`, { defaultValue: card.title })
}

export function cardSubtitle(t: TFunction, card: TaskCard): string {
  if (card.id.startsWith('agg_checkin_ms')) return t('tasks.item.checkin_ms.subtitle', { defaultValue: card.subtitle })
  if (card.id.startsWith('daily_deposit_t')) return t('tasks.item.daily_deposit_tier.subtitle', { i: card.id.slice(-1), defaultValue: card.subtitle })
  if (card.id === 'daily_bets') return t('tasks.item.daily_bets.subtitle', { defaultValue: card.subtitle })
  return t(`tasks.item.${card.id}.subtitle`, { defaultValue: card.subtitle })
}

export function rewardText(t: TFunction, card: TaskCard): string {
  const r = card.reward
  if (card.id === 'agg_firstdep' && r.type === 'cash' && r.amount > 0) {
    const amount = r.currency === 'PHP'
      ? `₱${Math.round(r.amount).toLocaleString('en-PH')}`
      : `${Math.round(r.amount).toLocaleString('en-US')} ${r.currency}`
    return `up to ${amount}`
  }
  if (r.type === 'cash') return r.amount > 0 ? `+${formatCurrencyAmount(r.currency, r.amount)}` : ''
  if (r.type === 'spin') return r.spin > 0 ? t('tasks.rewardSpin', { n: r.spin }) : ''
  return r.amount > 0 ? t('tasks.rewardGrowth', { n: r.amount }) : ''
}
