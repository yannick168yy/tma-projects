import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Select, Space, Table, message } from 'antd'
import { getRiskHits, type RiskAction, type RiskHit } from '../../api'
import { PAGE_SIZE_OPTIONS } from '../../pagination'
import { actionTag } from './shared'

export default function RiskHitLogs() {
  const [items, setItems] = useState<RiskHit[]>([])
  const [loading, setLoading] = useState(false)
  const [checkpoint, setCheckpoint] = useState<string | undefined>()
  const [action, setAction] = useState<RiskAction | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems((await getRiskHits({ checkpoint, action, limit: 200 })).items) }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }, [checkpoint, action])
  useEffect(() => { void load() }, [load])

  return (
    <Card
      title="风控命中日志"
      extra={
        <Space>
          <Select allowClear placeholder="管控点" style={{ width: 140 }} value={checkpoint} onChange={setCheckpoint}
            options={[{ value: 'login', label: '登录/注册' }, { value: 'promo_claim', label: '优惠领取' }, { value: 'withdraw', label: '提现申请' }]} />
          <Select allowClear placeholder="动作" style={{ width: 140 }} value={action} onChange={setAction}
            options={[{ value: 'tag_only', label: '仅打标' }, { value: 'limit', label: '限制' }, { value: 'escalate', label: '转审核' }, { value: 'deny', label: '拒绝' }]} />
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="影子模式命中（仅打标）也会记在这里——这正是评估误报率的依据。"
      />
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        pagination={{ pageSize: 20, pageSizeOptions: PAGE_SIZE_OPTIONS }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', render: (v: string) => String(v).slice(0, 19) },
          { title: '用户', dataIndex: 'userId', render: (v: string | null) => v ?? <span style={{ color: '#999' }}>未登录</span> },
          { title: '管控点', dataIndex: 'checkpoint' },
          { title: '规则', dataIndex: 'ruleCode', render: (c: string) => <code>{c}</code> },
          { title: '动作', dataIndex: 'action', render: actionTag },
          { title: '命中值', dataIndex: 'matchedValue', render: (v: string | null) => v ?? '-' },
          { title: 'IP', dataIndex: 'ip', render: (v: string | null) => v ?? '-' },
          { title: '设备', dataIndex: 'deviceId', render: (v: string | null) => v ? <code style={{ fontSize: 11 }}>{v.slice(0, 12)}…</code> : '-' },
          { title: '详情', dataIndex: 'detail', render: (d: unknown) => d ? <code style={{ fontSize: 11 }}>{JSON.stringify(d)}</code> : '-' },
        ]}
      />
    </Card>
  )
}
