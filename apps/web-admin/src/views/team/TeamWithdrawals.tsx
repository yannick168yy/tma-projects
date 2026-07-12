// 佣金提现「审核记录」：只读历史（审批操作已迁移至 取款审核 > 待人工处理）
import { useEffect, useState } from 'react'
import { Select, Button, Table, Tag, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getTeamWithdrawals, type TeamWithdrawalAdmin } from '../../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../../pagination'

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  return (val < 0 ? '-₱' : '₱') + Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function wdColor(s: string) {
  return s === 'approved' ? 'green' : s === 'pending' ? 'orange' : s === 'rejected' ? 'red' : 'default'
}
function fmtTime(v: string | null) {
  return v ? new Date(v).toLocaleString('zh-CN') : '-'
}

export default function TeamWithdrawals() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [items, setItems] = useState<TeamWithdrawalAdmin[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(false)

  async function load(p = 1, ps = pageSize) {
    setLoading(true)
    try {
      const data = await getTeamWithdrawals({ status: statusFilter, page: p, pageSize: ps })
      setItems(data.items); setTotal(data.total); setPage(p); setPageSize(ps)
    } catch { message.error('加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load(1) }, [])

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '用户', dataIndex: 'display_name', key: 'user' },
    { title: '用户ID', dataIndex: 'user_id', key: 'userId', width: 110 },
    { title: '金额', key: 'amount', width: 110, render: (_: unknown, r: TeamWithdrawalAdmin) => phpDisplay(r.amount_cents) },
    { title: '状态', key: 'status', width: 90, render: (_: unknown, r: TeamWithdrawalAdmin) => <Tag color={wdColor(r.status)}>{r.status}</Tag> },
    { title: '驳回原因', dataIndex: 'reject_reason', key: 'reason', render: (v: string | null) => v || '-' },
    { title: '申请时间', key: 'createdAt', width: 160, render: (_: unknown, r: TeamWithdrawalAdmin) => fmtTime(r.created_at) },
    { title: '审核时间', key: 'reviewedAt', width: 160, render: (_: unknown, r: TeamWithdrawalAdmin) => fmtTime(r.reviewed_at) },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total, showTotal: (t) => `共 ${t} 条`,
    pageSizeOptions: PAGE_SIZE_OPTIONS, onChange: (p, ps) => load(p, ps),
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Select value={statusFilter} placeholder="状态" allowClear style={{ width: 130 }} onChange={setStatusFilter} options={[{ value: 'pending', label: 'pending' }, { value: 'approved', label: 'approved' }, { value: 'rejected', label: 'rejected' }]} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </div>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" />
    </div>
  )
}
