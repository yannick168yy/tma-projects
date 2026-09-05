import { useEffect, useState } from 'react'
import { Button, Card, Table, Tag, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { listPlatformTenants, type PlatformTenant } from '../api'
import { useAuthStore } from '../stores/auth'

const STATUS: Record<string, { text: string; color: string }> = {
  trial: { text: '试用', color: 'blue' },
  active: { text: '正常', color: 'green' },
  withdraw_suspended: { text: '停提现', color: 'orange' },
  deposit_suspended: { text: '停充值', color: 'orange' },
  suspended: { text: '停站', color: 'red' },
  closed: { text: '关站', color: 'default' },
}

export default function Tenants() {
  const nav = useNavigate()
  const role = useAuthStore((s) => s.role)
  const [rows, setRows] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try { setRows(await listPlatformTenants()) }
      catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
      finally { setLoading(false) }
    })()
  }, [])

  return (
    <Card
      title="租户总览"
      extra={role === 'platform_super' && <Button type="primary" onClick={() => nav('/tenants/new')}>一键开站</Button>}
    >
      <Table
        rowKey="id"
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="small"
        columns={[
          { title: '代号', dataIndex: 'code', width: 120,
            render: (v: string, r) => <>{v}{r.selfOperated && <Tag color="gold" style={{ marginLeft: 6 }}>自营</Tag>}</> },
          { title: '名称', dataIndex: 'name' },
          { title: '套餐', dataIndex: 'planName', render: (v: string | null) => v ?? <Tag>未分配</Tag> },
          { title: '状态', dataIndex: 'status', width: 90,
            render: (s: string) => { const m = STATUS[s] ?? { text: s, color: 'default' }; return <Tag color={m.color}>{m.text}</Tag> } },
          { title: '库', dataIndex: 'database', width: 150 },
          { title: '市场', dataIndex: 'marketCount', width: 70 },
          { title: '域名', dataIndex: 'domainCount', width: 70 },
          { title: '创建时间', dataIndex: 'createdAt', width: 170 },
          { title: '操作', width: 90,
            render: (_, r) => <Button size="small" onClick={() => nav(`/tenants/${r.id}/overview`)}>详情</Button> },
        ]}
      />
    </Card>
  )
}
