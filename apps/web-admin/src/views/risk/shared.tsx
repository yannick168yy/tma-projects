import { Tag, Tooltip } from 'antd'
import type { RiskAction, RiskTagMeta } from '../../api'

const ACTION_TONE: Record<RiskAction, { color: string; label: string; hint: string }> = {
  tag_only: { color: 'default', label: '仅打标', hint: '影子模式：只记录，不干预用户' },
  limit:    { color: 'orange',  label: '限制',   hint: '限额/限频' },
  escalate: { color: 'gold',    label: '转审核', hint: '交给审核模块人工复核，风控自己不处置' },
  deny:     { color: 'red',     label: '拒绝',   hint: '直接阻断本次操作' },
}

export function actionTag(action: string) {
  const tone = ACTION_TONE[action as RiskAction]
  if (!tone) return <Tag>{action}</Tag>
  return <Tooltip title={tone.hint}><Tag color={tone.color}>{tone.label}</Tag></Tooltip>
}

export function tagLabel(tagCode: string, meta?: Record<string, RiskTagMeta>) {
  const info = meta?.[tagCode]
  if (!info) return <Tag>{tagCode}</Tag>
  return <Tooltip title={info.desc}><Tag color="volcano">{info.name}</Tag></Tooltip>
}

export function sourceTag(source: string) {
  return <Tag color={source === 'manual' ? 'blue' : 'default'}>{source === 'manual' ? '人工' : '自动'}</Tag>
}

/** 风险分越高越红 */
export function scoreTag(score: number) {
  const color = score >= 70 ? 'red' : score >= 50 ? 'orange' : score > 0 ? 'gold' : 'green'
  return <Tag color={color}>{score}</Tag>
}
