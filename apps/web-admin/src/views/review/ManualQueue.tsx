import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Button, Tag, Modal, Input, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getManualQueue, approveTeamWithdrawal, rejectTeamWithdrawal, type ManualQueueItem } from '../../api'
import { wdStatusLabel } from './shared'

export default function ManualQueue() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ManualQueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [rejecting, setRejecting] = useState<ManualQueueItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [opLoading, setOpLoading] = useState(false)

  async function load(p = 1) {
    setPage(p); setLoading(true)
    try {
      const res = await getManualQueue({ page: p, pageSize: 20 })
      setItems(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function handleApprove(item: ManualQueueItem) {
    Modal.confirm({
      title: '确认出款？',
      content: `将向 ${item.displayName || item.userId} 出款 ₱${item.amount.toLocaleString()}`,
      okText: '确认出款',
      onOk: async () => {
        await approveTeamWithdrawal(item.id)
        message.success('出款成功')
        void load(page)
      },
    })
  }

  function handleReject(item: ManualQueueItem) {
    setRejecting(item)
    setRejectReason('')
  }

  async function doReject() {
    if (!rejecting) return
    setOpLoading(true)
    try {
      await rejectTeamWithdrawal(rejecting.id, rejectReason.trim() || undefined)
      message.success('已拒绝，金额已退回佣金钱包')
      setRejecting(null)
      await load(page)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setOpLoading(false)
    }
  }

  const columns = [
    {
      title: '类型', key: 'kind', width: 90,
      render: (_: unknown, r: ManualQueueItem) =>
        r.kind === 'team'
          ? <Tag color="purple">佣金提现</Tag>
          : <Tag color="blue">用户提款</Tag>,
    },
    {
      title: '单号 / ID', key: 'id', width: 200,
      render: (_: unknown, r: ManualQueueItem) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.id}</span>
      ),
    },
    {
      title: '用户', key: 'user',
      render: (_: unknown, r: ManualQueueItem) => (
        <Button type="link" size="small" onClick={() => navigate(`/users/${r.userId}`)}>
          {r.displayName || r.userId}
        </Button>
      ),
    },
    {
      title: '金额', key: 'amount', width: 120,
      render: (_: unknown, r: ManualQueueItem) =>
        `₱${r.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    {
      title: '命中规则', key: 'hits',
      render: (_: unknown, r: ManualQueueItem) =>
        r.hitRules.length
          ? <Space size={[0, 4]} wrap>{r.hitRules.map((h) => <Tag key={h.code} color="orange">{h.name}</Tag>)}</Space>
          : <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: '状态', key: 'status', width: 90,
      render: (_: unknown, r: ManualQueueItem) => <Tag>{wdStatusLabel(r.status)}</Tag>,
    },
    {
      title: '提交时间', key: 'createdAt', width: 160,
      render: (_: unknown, r: ManualQueueItem) => new Date(r.createdAt).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'op', width: 160,
      render: (_: unknown, r: ManualQueueItem) =>
        r.kind === 'user' ? (
          <Button type="link" size="small" onClick={() => navigate(`/review/proposals/${r.id}`)}>详情</Button>
        ) : (
          <Space>
            <Button type="link" size="small" onClick={() => handleApprove(r)}>出款</Button>
            <Button type="link" size="small" danger onClick={() => handleReject(r)}>拒绝</Button>
          </Space>
        ),
    },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize: 20, total,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => load(p),
  }

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <h2 style={{ margin: 0 }}>待人工处理</h2>
        <Button onClick={() => load(page)}>刷新</Button>
      </Space>
      <Modal
        open={!!rejecting}
        title="拒绝提现"
        okText="确认拒绝"
        okButtonProps={{ danger: true }}
        confirmLoading={opLoading}
        onOk={doReject}
        onCancel={() => setRejecting(null)}
      >
        <Input.TextArea
          rows={3}
          value={rejectReason}
          placeholder="拒绝原因（可选，将退回佣金钱包）"
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
      <Table
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={pagination}
        rowKey={(r) => `${r.kind}-${r.id}`}
        size="small"
      />
    </div>
  )
}
