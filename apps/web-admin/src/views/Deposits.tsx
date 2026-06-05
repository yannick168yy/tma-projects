import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Button, Tag } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getDeposits, type AdminDeposit } from '../api'

function depositStatusColor(s: string) {
  return ({ paid: 'green', pending: 'orange', failed: 'red', cancelled: 'default', rejected: 'red' } as Record<string, string>)[s] ?? 'default'
}
function depositStatusLabel(s: string) {
  return ({ pending: '待支付', paid: '已支付', failed: '失败', cancelled: '已取消', rejected: '已拒绝' } as Record<string, string>)[s] ?? s
}

export default function Deposits() {
  const navigate = useNavigate()
  const [userIdFilter, setUserIdFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AdminDeposit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  async function load(p = 1) {
    setPage(p); setLoading(true)
    try {
      const res = await getDeposits({ page: p, pageSize: 20, userId: userIdFilter || undefined, status: statusFilter })
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
    current: page, pageSize: 20, total,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => load(p),
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
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="orderId" size="small" />
    </div>
  )
}
