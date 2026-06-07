import { useEffect, useState } from 'react'
import { Input, Select, Button, Table, Tag, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getTeamCommissions, type TeamCommission } from '../../api'

function phpCell(cents: number) {
  const val = (cents ?? 0) / 100
  return <span style={{ color: val < 0 ? '#ff4d4f' : undefined }}>{(val < 0 ? '-₱' : '₱') + Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
}

export default function TeamCommissions() {
  const [filter, setFilter] = useState({ period: '', beneficiaryId: '', status: undefined as string | undefined })
  const [items, setItems] = useState<TeamCommission[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  async function load(p = 1) {
    setLoading(true)
    try {
      const data = await getTeamCommissions({ ...filter, page: p })
      setItems(data.items); setTotal(data.total); setPage(p)
    } catch { message.error('加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load(1) }, [])

  const columns = [
    { title: '月份', dataIndex: 'period', key: 'period', width: 90 },
    { title: '收益人', dataIndex: 'beneficiary_name', key: 'beneficiary' },
    { title: '下线', dataIndex: 'from_name', key: 'from' },
    { title: '层级', dataIndex: 'level', key: 'level', width: 60 },
    { title: '货币', dataIndex: 'currency', key: 'currency', width: 70 },
    { title: 'GGR', key: 'ggr', width: 120, render: (_: unknown, r: TeamCommission) => phpCell(r.ggr_cents) },
    { title: '费率', dataIndex: 'rate_pct', key: 'rate', width: 70 },
    { title: '佣金', key: 'commission', width: 120, render: (_: unknown, r: TeamCommission) => phpCell(r.commission_cents) },
    { title: '状态', key: 'status', width: 90, render: (_: unknown, r: TeamCommission) => <Tag color={r.status === 'paid' ? 'green' : r.status === 'pending' ? 'orange' : 'default'}>{r.status}</Tag> },
  ]

  const pagination: TablePaginationConfig = { current: page, pageSize: 50, total, showTotal: (t) => `共 ${t} 条`, onChange: (p) => load(p) }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Input value={filter.period} onChange={(e) => setFilter((f) => ({ ...f, period: e.target.value }))} placeholder="月份 YYYY-MM" allowClear style={{ width: 130 }} />
        <Input value={filter.beneficiaryId} onChange={(e) => setFilter((f) => ({ ...f, beneficiaryId: e.target.value }))} placeholder="收益人ID" allowClear style={{ width: 150 }} />
        <Select value={filter.status} placeholder="状态" allowClear style={{ width: 110 }} onChange={(v) => setFilter((f) => ({ ...f, status: v }))} options={[{ value: 'pending', label: 'pending' }, { value: 'paid', label: 'paid' }, { value: 'voided', label: 'voided' }]} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </div>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" />
    </div>
  )
}
