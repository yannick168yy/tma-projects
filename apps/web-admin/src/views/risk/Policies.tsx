import { useEffect, useState } from 'react'
import { Alert, Button, Card, Select, Switch, Table, Tag, message } from 'antd'
import { getRiskPolicies, saveRiskPolicies, type RiskAction, type RiskPolicyItem } from '../../api'

const ACTION_OPTIONS: { value: RiskAction; label: string }[] = [
  { value: 'tag_only', label: '仅打标（影子模式）' },
  { value: 'limit', label: '限制' },
  { value: 'escalate', label: '转人工审核' },
  { value: 'deny', label: '直接拒绝' },
]

const CHECKPOINT_LABEL: Record<string, string> = {
  login: '登录 / 注册',
  promo_claim: '优惠领取',
  withdraw: '提现申请',
}

export default function RiskPolicies() {
  const [rows, setRows] = useState<RiskPolicyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try { setRows((await getRiskPolicies()).items) }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function update(checkpoint: string, ruleCode: string, patch: Partial<RiskPolicyItem>) {
    setRows((rs) => rs.map((r) => (r.checkpoint === checkpoint && r.ruleCode === ruleCode ? { ...r, ...patch } : r)))
  }

  async function save() {
    setSaving(true)
    try {
      await saveRiskPolicies(rows.map(({ updatedAt: _u, ...rest }) => rest))
      message.success('已保存')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败（需超级管理员权限）')
    } finally {
      setSaving(false)
    }
  }

  const shadowCount = rows.filter((r) => r.action === 'tag_only' && r.enabled).length

  return (
    <Card
      title="风控策略（管控点 × 规则 → 动作）"
      extra={<Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={`当前有 ${shadowCount} 条规则处于影子模式`}
        description="影子模式只打标不干预。开启拦截前，请先在「命中日志」里复核该规则的误报率——风控误伤的是真实用户的体验，一条一条开，不要一次全开。注意「转人工审核」是把用户交给审核模块处置，风控自己不做复核。"
      />
      <Table
        rowKey={(r) => `${r.checkpoint}:${r.ruleCode}`}
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '管控点', dataIndex: 'checkpoint', render: (c: string) => CHECKPOINT_LABEL[c] ?? c },
          { title: '规则', dataIndex: 'ruleCode', render: (c: string) => <code>{c}</code> },
          {
            title: '启用', dataIndex: 'enabled', width: 90,
            render: (v: boolean, r) => <Switch checked={v} onChange={(checked) => update(r.checkpoint, r.ruleCode, { enabled: checked })} />,
          },
          {
            title: '命中动作', dataIndex: 'action', width: 220,
            render: (v: RiskAction, r) => (
              <Select
                value={v}
                style={{ width: 190 }}
                options={ACTION_OPTIONS}
                onChange={(action) => update(r.checkpoint, r.ruleCode, { action })}
              />
            ),
          },
          {
            title: '阈值', dataIndex: 'params',
            render: (p: Record<string, number> | null) =>
              p ? Object.entries(p).map(([k, val]) => <Tag key={k}>{k}={val}</Tag>) : <span style={{ color: '#999' }}>—（名单规则无阈值）</span>,
          },
        ]}
      />
    </Card>
  )
}
