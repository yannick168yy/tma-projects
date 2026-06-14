import { useEffect, useState } from 'react'
import { Table, Switch, InputNumber, Button, Space, Card, Statistic, Row, Col, Tag, message, Tooltip } from 'antd'
import { getReviewConfig, saveReviewConfig, getReviewStats, type ReviewConfigItem, type ReviewStats } from '../api'

// 阈值单位提示：金额类阈值以 PHP「分」存储
const THRESHOLD_HINT: Record<string, string> = {
  large_profit: '净盈利（PHP分），如 20000000 = 20万',
  high_multiple_profit: '盈利/存款 倍数',
  high_multiple_profit_24h: '近24h 盈利/存款 倍数',
  total_bonus: '优惠总额（PHP分），如 5000000 = 5万',
}

export default function ReviewConfig() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<ReviewConfigItem[]>([])
  const [stats, setStats] = useState<ReviewStats | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [cfg, st] = await Promise.all([getReviewConfig(), getReviewStats()])
      setRows(cfg.config)
      setStats(st)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function update(ruleCode: string, patch: Partial<ReviewConfigItem>) {
    setRows((rs) => rs.map((r) => r.ruleCode === ruleCode ? { ...r, ...patch } : r))
  }
  function updateParam(ruleCode: string, key: string, val: number | null) {
    setRows((rs) => rs.map((r) => r.ruleCode === ruleCode
      ? { ...r, params: { ...(r.params ?? {}), [key]: val ?? 0 } }
      : r))
  }

  async function save() {
    setSaving(true)
    try {
      await saveReviewConfig(rows.map((r) => ({ ruleCode: r.ruleCode, enabled: r.enabled, threshold: r.threshold, params: r.params })))
      message.success('已保存，实时生效')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败（需超级管理员权限）')
    } finally { setSaving(false) }
  }

  const columns = [
    { title: '规则', dataIndex: 'name', key: 'name', width: 160,
      render: (v: string, r: ReviewConfigItem) => <Tooltip title={r.desc}><b>{v}</b></Tooltip> },
    { title: '启用', key: 'enabled', width: 80,
      render: (_: unknown, r: ReviewConfigItem) => <Switch checked={r.enabled} onChange={(c) => update(r.ruleCode, { enabled: c })} /> },
    { title: '阈值参数', key: 'threshold',
      render: (_: unknown, r: ReviewConfigItem) => {
        if (r.params) {
          // large_amount: 分币种阈值
          return (
            <Space wrap>
              <span>PHP分</span>
              <InputNumber value={r.params.phpCents} min={0} style={{ width: 130 }} onChange={(v) => updateParam(r.ruleCode, 'phpCents', v)} />
              <span>USDT</span>
              <InputNumber value={r.params.usdt} min={0} style={{ width: 110 }} onChange={(v) => updateParam(r.ruleCode, 'usdt', v)} />
            </Space>
          )
        }
        if (r.threshold == null) return <span style={{ color: '#999' }}>无（开关型）</span>
        return (
          <Space>
            <InputNumber value={r.threshold} min={0} style={{ width: 160 }} onChange={(v) => update(r.ruleCode, { threshold: v })} />
            {THRESHOLD_HINT[r.ruleCode] && <span style={{ color: '#999', fontSize: 12 }}>{THRESHOLD_HINT[r.ruleCode]}</span>}
          </Space>
        )
      } },
    { title: '近7天命中', key: 'hits', width: 100,
      render: (_: unknown, r: ReviewConfigItem) => {
        const h = stats?.hits.find((x) => x.ruleCode === r.ruleCode)
        return h ? <Tag color="orange">{h.count}</Tag> : <span style={{ color: '#ccc' }}>0</span>
      } },
  ]

  return (
    <div>
      <h2>取款自动审核</h2>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="近7天自动通过率" value={stats?.autoApproveRate ?? 0} suffix="%" valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="近7天转人工" value={stats?.manualCount ?? 0} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="近7天已审核" value={stats?.totalReviewed ?? 0} /></Card></Col>
      </Row>

      <Card
        title="审核规则配置"
        extra={<Button type="primary" loading={saving} onClick={save}>保存（实时生效）</Button>}
      >
        <p style={{ color: '#999', marginTop: 0 }}>规则全部通过则自动批准出款，任一命中转人工。阈值偏宽松以覆盖大多数提案，调整后实时生效（仅超级管理员可改）。</p>
        <Table rowKey="ruleCode" columns={columns} dataSource={rows} loading={loading} pagination={false} size="small" />
      </Card>
    </div>
  )
}
