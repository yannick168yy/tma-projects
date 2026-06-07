import { useEffect, useState } from 'react'
import { Select, Button, Table, Tag, Popconfirm, Modal, Input, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getTeamWithdrawals, approveTeamWithdrawal, rejectTeamWithdrawal, type TeamWithdrawalAdmin } from '../../api'

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  return (val < 0 ? '-₱' : '₱') + Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function wdColor(s: string) {
  return s === 'approved' ? 'green' : s === 'pending' ? 'orange' : s === 'rejected' ? 'red' : 'default'
}

export default function TeamWithdrawals() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [items, setItems] = useState<TeamWithdrawalAdmin[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [opLoading, setOpLoading] = useState(false)
  const [rejectModal, setRejectModal] = useState({ visible: false, id: 0, reason: '' })

  async function load(p = 1) {
    setLoading(true)
    try {
      const data = await getTeamWithdrawals({ status: statusFilter, page: p })
      setItems(data.items); setTotal(data.total); setPage(p)
    } catch { message.error('加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load(1) }, [])

  async function doApprove(id: number) {
    setOpLoading(true)
    try {
      await approveTeamWithdrawal(id)
      message.success('已批准')
      await load(page)
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doReject() {
    setOpLoading(true)
    try {
      await rejectTeamWithdrawal(rejectModal.id, rejectModal.reason)
      setRejectModal((m) => ({ ...m, visible: false }))
      message.success('已驳回')
      await load(page)
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '用户', dataIndex: 'display_name', key: 'user' },
    { title: '用户ID', dataIndex: 'user_id', key: 'userId', width: 110 },
    { title: '金额', key: 'amount', width: 110, render: (_: unknown, r: TeamWithdrawalAdmin) => phpDisplay(r.amount_cents) },
    { title: '状态', key: 'status', width: 90, render: (_: unknown, r: TeamWithdrawalAdmin) => <Tag color={wdColor(r.status)}>{r.status}</Tag> },
    { title: '申请时间', dataIndex: 'created_at', key: 'createdAt', width: 160 },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: unknown, r: TeamWithdrawalAdmin) => r.status === 'pending' ? (
        <>
          <Popconfirm title="确认批准此提现？" onConfirm={() => doApprove(r.id)}>
            <Button type="link" size="small" style={{ color: '#52c41a' }} loading={opLoading}>批准</Button>
          </Popconfirm>
          <Button type="link" size="small" danger onClick={() => setRejectModal({ visible: true, id: r.id, reason: '' })}>驳回</Button>
        </>
      ) : <span>-</span>,
    },
  ]

  const pagination: TablePaginationConfig = { current: page, pageSize: 20, total, showTotal: (t) => `共 ${t} 条`, onChange: (p) => load(p) }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Select value={statusFilter} placeholder="状态" allowClear style={{ width: 130 }} onChange={setStatusFilter} options={[{ value: 'pending', label: 'pending' }, { value: 'approved', label: 'approved' }, { value: 'rejected', label: 'rejected' }]} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </div>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" />
      <Modal open={rejectModal.visible} title="驳回原因" onOk={doReject} confirmLoading={opLoading} onCancel={() => setRejectModal((m) => ({ ...m, visible: false }))}>
        <Input value={rejectModal.reason} onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))} placeholder="请输入驳回原因" />
      </Modal>
    </div>
  )
}
