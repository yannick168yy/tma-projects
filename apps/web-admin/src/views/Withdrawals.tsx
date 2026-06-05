import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Button, Tag, Modal, Popconfirm, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getWithdrawals, approveWithdrawal, rejectWithdrawal, type AdminWithdrawal } from '../api'

function wdStatusColor(s: string) {
  return ({ completed: 'green', pending: 'orange', processing: 'blue', rejected: 'red', admin_rejected: 'red', failed: 'red' } as Record<string, string>)[s] ?? 'default'
}
function wdStatusLabel(s: string) {
  return ({ pending: '待审核', processing: '处理中', completed: '已完成', rejected: '已拒绝', admin_rejected: '管理员拒绝', failed: '失败' } as Record<string, string>)[s] ?? s
}

export default function Withdrawals() {
  const navigate = useNavigate()
  const [userIdFilter, setUserIdFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [opLoading, setOpLoading] = useState(false)
  const [items, setItems] = useState<AdminWithdrawal[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [rejectModal, setRejectModal] = useState({ visible: false, orderId: '', reason: '' })

  async function load(p = 1) {
    setPage(p); setLoading(true)
    try {
      const res = await getWithdrawals({ page: p, pageSize: 20, userId: userIdFilter || undefined, status: statusFilter })
      setItems(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function doApprove(orderId: string) {
    setOpLoading(true)
    try {
      await approveWithdrawal(orderId)
      message.success('已批准'); await load(page)
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doReject() {
    if (!rejectModal.reason.trim()) { message.warning('请填写拒绝原因'); return }
    setOpLoading(true)
    try {
      await rejectWithdrawal(rejectModal.orderId, rejectModal.reason)
      message.success('已拒绝，款项已退回用户')
      setRejectModal(m => ({ ...m, visible: false }))
      await load(page)
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  const columns = [
    { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 200 },
    { title: '用户', key: 'user', render: (_: unknown, r: AdminWithdrawal) => <Button type="link" size="small" onClick={() => navigate(`/users/${r.userId}`)}>{r.userId}</Button> },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 110 },
    { title: '金额', dataIndex: 'amount', key: 'amount' },
    { title: '渠道', dataIndex: 'channelId', key: 'channel' },
    { title: '状态', key: 'status', render: (_: unknown, r: AdminWithdrawal) => <Tag color={wdStatusColor(r.status)}>{wdStatusLabel(r.status)}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'actions',
      render: (_: unknown, r: AdminWithdrawal) => r.status === 'pending' ? (
        <Space size="small">
          <Popconfirm title="确认批准此提款？" onConfirm={() => doApprove(r.orderId)}>
            <Button type="link" size="small" style={{ color: '#52c41a' }}>批准</Button>
          </Popconfirm>
          <Button type="link" size="small" danger onClick={() => setRejectModal({ visible: true, orderId: r.orderId, reason: '' })}>拒绝</Button>
        </Space>
      ) : <span>-</span>,
    },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize: 20, total,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => load(p),
  }

  return (
    <div>
      <h2>提款审批</h2>
      <Space style={{ marginBottom: 16 }}>
        <Input value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} placeholder="用户ID" style={{ width: 160 }} allowClear />
        <Select value={statusFilter} placeholder="状态" allowClear style={{ width: 150 }} onChange={setStatusFilter} options={[
          { value: 'pending', label: '待审核' }, { value: 'processing', label: '处理中' },
          { value: 'completed', label: '已完成' }, { value: 'rejected', label: '已拒绝' },
          { value: 'admin_rejected', label: '管理员拒绝' }, { value: 'failed', label: '失败' },
        ]} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </Space>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="orderId" size="small" />
      <Modal
        open={rejectModal.visible}
        title="拒绝原因"
        onOk={doReject}
        confirmLoading={opLoading}
        onCancel={() => setRejectModal(m => ({ ...m, visible: false }))}
      >
        <Input
          value={rejectModal.reason}
          onChange={(e) => setRejectModal(m => ({ ...m, reason: e.target.value }))}
          placeholder="请输入拒绝原因"
        />
      </Modal>
    </div>
  )
}
