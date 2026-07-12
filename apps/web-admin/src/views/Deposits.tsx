import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Button, Tag, Grid, Card } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getDeposits, type AdminDeposit } from '../api'
import { MobileCardList } from '../components/MobileCardList'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

function depositStatusColor(s: string) {
  return ({ paid: 'green', pending: 'orange', failed: 'red', cancelled: 'default', rejected: 'red' } as Record<string, string>)[s] ?? 'default'
}
function depositStatusLabel(s: string) {
  return ({ pending: '待支付', paid: '已支付', failed: '失败', cancelled: '已取消', rejected: '已拒绝' } as Record<string, string>)[s] ?? s
}

export default function Deposits() {
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [userIdFilter, setUserIdFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AdminDeposit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  async function load(p = 1, ps = pageSize) {
    setPage(p); setPageSize(ps); setLoading(true)
    try {
      const res = await getDeposits({ page: p, pageSize: ps, userId: userIdFilter || undefined, status: statusFilter })
      setItems(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const columns = [
    { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 200 },
    { title: '用户', key: 'user', render: (_: unknown, r: AdminDeposit) => <Button type="link" size="small" onClick={() => navigate(`/users/${r.userId}`)}>{r.userId}</Button> },
    { title: '金额', key: 'amount', render: (_: unknown, r: AdminDeposit) => `${r.amount} ${r.currency}` },
    { title: '渠道', dataIndex: 'channelId', key: 'channel' },
    { title: '状态', key: 'status', render: (_: unknown, r: AdminDeposit) => <Tag color={depositStatusColor(r.status)}>{depositStatusLabel(r.status)}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    { title: '支付时间', dataIndex: 'paidAt', key: 'paidAt', render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total,
    showTotal: (t) => `共 ${t} 条`,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    onChange: (p, ps) => load(p, ps),
  }

  return (
    <div>
      <h2>存款管理</h2>
      <Space style={{ marginBottom: 16 }}>
        <Input value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} placeholder="用户ID" style={{ width: 160 }} allowClear />
        <Select value={statusFilter} placeholder="状态" allowClear style={{ width: 130 }} onChange={setStatusFilter} options={[
          { value: 'pending', label: '待支付' }, { value: 'paid', label: '已支付' },
          { value: 'failed', label: '失败' }, { value: 'cancelled', label: '已取消' },
          { value: 'rejected', label: '已拒绝' },
        ]} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </Space>
      {isMobile ? (
        <MobileCardList
          items={items} loading={loading} page={page} total={total} pageSize={pageSize} onPage={load}
          renderItem={(r) => (
            <Card key={r.orderId} size="small" style={{ marginBottom: 10 }}
              title={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.orderId}</span>}
              extra={<Tag color={depositStatusColor(r.status)}>{depositStatusLabel(r.status)}</Tag>}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/users/${r.userId}`)}>{r.userId}</Button>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{r.amount} {r.currency}</span>
              </div>
              <div style={{ marginTop: 6, color: '#999', fontSize: 12 }}>
                渠道 {r.channelId} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                {r.paidAt ? ` · 支付 ${new Date(r.paidAt).toLocaleString('zh-CN')}` : ''}
              </div>
            </Card>
          )}
        />
      ) : (
        <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="orderId" size="small" />
      )}
    </div>
  )
}
