import { Tag } from 'antd'

export function verdictTag(v: string | null) {
  if (v === 'pass') return <Tag color="green">自动通过</Tag>
  if (v === 'manual') return <Tag color="orange">转人工</Tag>
  return <Tag>未审核</Tag>
}

export function ruleVerdictTag(v: string) {
  const map: Record<string, { color: string; label: string }> = {
    pass: { color: 'green', label: '通过' },
    manual: { color: 'orange', label: '命中' },
    skipped: { color: 'default', label: '已禁用' },
    error: { color: 'red', label: '异常' },
  }
  const m = map[v] ?? { color: 'default', label: v }
  return <Tag color={m.color}>{m.label}</Tag>
}

export function wdStatusLabel(s: string) {
  return ({ pending: '待审核', processing: '处理中', completed: '已完成', rejected: '已拒绝', admin_rejected: '管理员拒绝', failed: '失败' } as Record<string, string>)[s] ?? s
}

// PHP 分 → 元
export const toPhp = (cents: number) => `PHP ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 等值`
