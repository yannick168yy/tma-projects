import { useEffect, useState } from 'react'
import { Input, Select, Button, Table, Tag, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getTeamCommissions, type TeamCommission } from '../../api'
import { PAGE_SIZE_OPTIONS } from '../../pagination'

function phpCell(cents: number) {
  const val = (cents ?? 0) / 100
  return <span style={{ color: val < 0 ? '#ff4d4f' : undefined }}>{(val < 0 ? '-₱' : '₱') + Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
}
function usdtCell(cents: number) {
  return <span>{`${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}</span>
}
function commissionCell(cents: number, currency: string) {
  if (currency === 'PHP') return phpCell(cents)
  return <span>{`Rp${Math.round((cents ?? 0) / 100).toLocaleString('id-ID')}`}</span>
}

export default function TeamCommissions() {
  const [filter, setFilter] = useState({ month: '', beneficiaryId: '', status: undefined as string | undefined })
  const [items, setItems] = useState<TeamCommission[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(false)

  async function load(p = 1, ps = pageSize) {
    setLoading(true)
    try {
      const data = await getTeamCommissions({ ...filter, page: p, pageSize: ps })
      setItems(data.items); setTotal(data.total); setPage(p); setPageSize(ps)
    } catch { message.error('加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load(1) }, [])

  const columns = [
    { title: '日期', dataIndex: 'period', key: 'period', width: 105 },
    { title: '收益人', dataIndex: 'beneficiary_name', key: 'beneficiary' },
    { title: '下线', dataIndex: 'from_name', key: 'from' },
    { title: '层级', dataIndex: 'level', key: 'level', width: 60 },
    { title: '货币', dataIndex: 'currency', key: 'currency', width: 70 },
    {
      title: '流水明细', key: 'turnover', width: 180,
      render: (_: unknown, r: TeamCommission) => {
        const bk = r.currency_breakdown
        if (!bk || bk.length === 0) return phpCell(r.turnover_cents)
        const sorted = [...bk].sort((a, b) => (a.currency === 'PHP' ? -1 : b.currency === 'PHP' ? 1 : 0))
        return (
          <span style={{ fontSize: 12 }}>
            {sorted.map((b, i) => {
              const val = b.betCents / 100
              const txt = b.currency === 'PHP'
                ? `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                : `${parseFloat(val.toFixed(6))} ${b.currency}`
              return <span key={b.currency}>{i > 0 && <span style={{ color: '#888', margin: '0 3px' }}>+</span>}{txt}</span>
            })}
          </span>
        )
      },
    },
    { title: '费率', dataIndex: 'rate_pct', key: 'rate', width: 70 },
    { title: '佣金', key: 'commission', width: 140, render: (_: unknown, r: TeamCommission) => commissionCell(r.commission_cents, r.currency) },
    { title: 'USDT等值', key: 'usdtEquivalent', width: 130, render: (_: unknown, r: TeamCommission) => usdtCell(r.usdt_equivalent_cents) },
    { title: '状态', key: 'status', width: 90, render: (_: unknown, r: TeamCommission) => <Tag color={r.status === 'paid' ? 'green' : r.status === 'pending' ? 'orange' : 'default'}>{r.status}</Tag> },
  ]

  const pagination: TablePaginationConfig = { current: page, pageSize, total, showTotal: (t) => `共 ${t} 条`, pageSizeOptions: PAGE_SIZE_OPTIONS, onChange: (p, ps) => load(p, ps) }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Input value={filter.month} onChange={(e) => setFilter((f) => ({ ...f, month: e.target.value }))} placeholder="月份 YYYY-MM" allowClear style={{ width: 130 }} />
        <Input value={filter.beneficiaryId} onChange={(e) => setFilter((f) => ({ ...f, beneficiaryId: e.target.value }))} placeholder="收益人ID" allowClear style={{ width: 150 }} />
        <Select value={filter.status} placeholder="状态" allowClear style={{ width: 110 }} onChange={(v) => setFilter((f) => ({ ...f, status: v }))} options={[{ value: 'pending', label: 'pending' }, { value: 'paid', label: 'paid' }, { value: 'voided', label: 'voided' }]} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </div>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" />
    </div>
  )
}
