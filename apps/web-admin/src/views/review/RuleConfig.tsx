import { useEffect, useState } from 'react'
import { Table, Switch, InputNumber, Button, Space, Card, Tag, message } from 'antd'
import { getReviewConfig, saveReviewConfig, type ReviewConfigItem } from '../../api'

const THRESHOLD_HINT: Record<string, string> = {
  large_profit: '净盈利（PHP分），如 20000000 = 20万',
  high_multiple_profit: '盈利/存款 倍数',
  high_multiple_profit_24h: '近24h 盈利/存款 倍数',
  total_bonus: '优惠总额（PHP分），如 5000000 = 5万',
}

export default function RuleConfig() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<ReviewConfigItem[]>([])

  async function load() {
    setLoading(true)
    try { setRows((await getReviewConfig()).config) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function update(ruleCode: string, patch: Partial<ReviewConfigItem>) {
    setRows((rs) => rs.map((r) => r.ruleCode === ruleCode ? { ...r, ...patch } : r))
  }
  function updateParam(ruleCode: string, key: string, val: number | null) {
    setRows((rs) => rs.map((r) => r.ruleCode === ruleCode ? { ...r, params: { ...(r.params ?? {}), [key]: val ?? 0 } } : r))
  }

  async function save() {
    setSaving(true)
    try {
      await saveReviewConfig(rows.map((r) => ({ ruleCode: r.ruleCode, enabled: r.enabled, threshold: r.threshold, params: r.params })))
      message.success('已保存，实时生效'); await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败（需超级管理员权限）')
    } finally { setSaving(false) }
  }

  const columns = [
    { title: '规则', dataIndex: 'name', width: 130, render: (v: string) => <b>{v}</b> },
    { title: '规则说明', dataIndex: 'desc', width: 280, render: (v: string) => <span style={{ color: '#666', fontSize: 13 }}>{v || '—'}</span> },
    { title: '启用', key: 'enabled', width: 70, render: (_: unknown, r: ReviewConfigItem) => <Switch checked={r.enabled} onChange={(c) => update(r.ruleCode, { enabled: c })} /> },
    { title: '阈值参数', key: 'threshold', render: (_: unknown, r: ReviewConfigItem) => {
      if (r.params) {
        const keys = Object.keys(r.params)
        return <Space wrap>{keys.map((k) => (
          <span key={k}>{k} <InputNumber value={r.params![k]} min={0} style={{ width: 110 }} onChange={(v) => updateParam(r.ruleCode, k, v)} /></span>
        ))}</Space>
      }
      if (r.threshold == null) return <span style={{ color: '#999' }}>无（开关型）</span>
      return <Space>
        <InputNumber value={r.threshold} min={0} style={{ width: 160 }} onChange={(v) => update(r.ruleCode, { threshold: v })} />
        {THRESHOLD_HINT[r.ruleCode] && <span style={{ color: '#999', fontSize: 12 }}>{THRESHOLD_HINT[r.ruleCode]}</span>}
      </Space>
    } },
    { title: '更新时间', key: 'updatedAt', width: 160, render: (_: unknown, r: ReviewConfigItem) => r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-CN') : '—' },
  ]

  return (
    <div>
      <h2>审核规则配置</h2>
      <Card extra={<Button type="primary" loading={saving} onClick={save}>保存（实时生效）</Button>}>
        <p style={{ color: '#999', marginTop: 0 }}>
          <Tag color="green">全通过=自动出款</Tag><Tag color="orange">任一命中=转人工</Tag>
          阈值偏宽松以覆盖大多数提案，调整后实时生效（仅超级管理员可改）。
        </p>
        <Table rowKey="ruleCode" columns={columns} dataSource={rows} loading={loading} pagination={false} size="small" />
      </Card>
    </div>
  )
}
