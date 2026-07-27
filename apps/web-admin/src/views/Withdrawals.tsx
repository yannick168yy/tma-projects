import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Button, Tag, Modal, Popconfirm, message, Descriptions, Spin, Grid, Card, Collapse } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getWithdrawals, approveWithdrawal, rejectWithdrawal, getWithdrawalReview, type AdminWithdrawal, type ReviewRuleResult } from '../api'
import { MobileCardList } from '../components/MobileCardList'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'
import { DEFAULT_WITHDRAW_USER_REJECT_REASON, WITHDRAW_USER_REJECT_REASON_OPTIONS } from './review/withdrawRejectReasons'

function wdStatusColor(s: string) {
  return ({ completed: 'green', pending: 'orange', processing: 'blue', rejected: 'red', admin_rejected: 'red', failed: 'red' } as Record<string, string>)[s] ?? 'default'
}
function wdStatusLabel(s: string) {
  return ({ pending: '待审核', processing: '处理中', completed: '已完成', rejected: '已拒绝', admin_rejected: '管理员拒绝', failed: '失败' } as Record<string, string>)[s] ?? s
}
function verdictTag(v: string | null) {
  if (v === 'pass') return <Tag color="green">自动通过</Tag>
  if (v === 'manual') return <Tag color="orange">转人工</Tag>
  return <Tag>未审核</Tag>
}

// 逐规则审核明细（行展开）
function ReviewDetail({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState<ReviewRuleResult[]>([])
  useEffect(() => {
    let alive = true
    getWithdrawalReview(orderId)
      .then((r) => { if (alive) setRules(r.rules) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [orderId])

  if (loading) return <Spin size="small" />
  if (rules.length === 0) return <span style={{ color: '#999' }}>无审核记录（可能在非生产环境直接完成）</span>

  return (
    <Descriptions size="small" column={1} bordered>
      {rules.map((r) => (
        <Descriptions.Item
          key={r.ruleCode}
          label={<Space>{r.ruleName}{r.verdict === 'manual' ? <Tag color="orange">命中</Tag> : <Tag color="green">通过</Tag>}</Space>}
        >
          {r.actualValue != null
            ? <span>实际值 <b>{r.actualValue}</b>{r.threshold != null ? ` / 阈值 ${r.threshold}` : ''}</span>
            : r.detail ? <code>{JSON.stringify(r.detail)}</code> : '—'}
        </Descriptions.Item>
      ))}
    </Descriptions>
  )
}

export default function Withdrawals() {
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [userIdFilter, setUserIdFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [verdictFilter, setVerdictFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [opLoading, setOpLoading] = useState(false)
  const [items, setItems] = useState<AdminWithdrawal[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [rejectModal, setRejectModal] = useState({
    visible: false,
    orderId: '',
    reason: '',
    userReason: DEFAULT_WITHDRAW_USER_REJECT_REASON,
    recommendedNote: '',
  })

  // 打开驳回弹窗：先拉审核明细，按命中的规则自动预选用户可见话术（管理员仍可改）
  async function openReject(orderId: string) {
    let userReason = DEFAULT_WITHDRAW_USER_REJECT_REASON
    let recommendedNote = ''
    try {
      const { rules } = await getWithdrawalReview(orderId)
      const hit = rules.find((r) => r.verdict === 'manual' && r.recommendedUserReason)
      if (hit?.recommendedUserReason) {
        userReason = hit.recommendedUserReason
        recommendedNote = `已按命中规则「${hit.ruleName}」预选话术，可手动调整`
      }
    } catch { /* 预选失败用默认话术 */ }
    setRejectModal({ visible: true, orderId, reason: '', userReason, recommendedNote })
  }

  async function load(p = 1, ps = pageSize) {
    setPage(p); setPageSize(ps); setLoading(true)
    try {
      const res = await getWithdrawals({ page: p, pageSize: ps, userId: userIdFilter || undefined, status: statusFilter, reviewVerdict: verdictFilter })
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
    if (!rejectModal.userReason) { message.warning('请选择用户可见原因'); return }
    if (!rejectModal.reason.trim()) { message.warning('请填写拒绝原因'); return }
    setOpLoading(true)
    try {
      await rejectWithdrawal(rejectModal.orderId, rejectModal.reason, rejectModal.userReason)
      message.success('已拒绝，款项已退回用户')
      setRejectModal(m => ({ ...m, visible: false }))
      await load(page)
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  const columns = [
    { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 180 },
    { title: '用户', key: 'user', render: (_: unknown, r: AdminWithdrawal) => <Button type="link" size="small" onClick={() => navigate(`/users/${r.userId}`)}>{r.userId}</Button> },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 90 },
    { title: '金额', dataIndex: 'amount', key: 'amount' },
    { title: '渠道', dataIndex: 'channelId', key: 'channel' },
    { title: '审核结果', key: 'verdict', width: 100, render: (_: unknown, r: AdminWithdrawal) => verdictTag(r.reviewVerdict) },
    { title: '状态', key: 'status', render: (_: unknown, r: AdminWithdrawal) => <Tag color={wdStatusColor(r.status)}>{wdStatusLabel(r.status)}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'actions',
      render: (_: unknown, r: AdminWithdrawal) => r.status === 'pending' ? (
        <Space size="small">
          <Popconfirm title="确认批准此提款？" onConfirm={() => doApprove(r.orderId)}>
            <Button type="link" size="small" style={{ color: '#52c41a' }}>批准</Button>
          </Popconfirm>
          <Button type="link" size="small" danger onClick={() => openReject(r.orderId)}>拒绝</Button>
        </Space>
      ) : <span>-</span>,
    },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total,
    showTotal: (t) => `共 ${t} 条`,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    onChange: (p, ps) => load(p, ps),
  }

  return (
    <div>
      <h2>提款审批</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} placeholder="用户ID" style={{ width: 160 }} allowClear />
        <Select value={statusFilter} placeholder="状态" allowClear style={{ width: 140 }} onChange={setStatusFilter} options={[
          { value: 'pending', label: '待审核' }, { value: 'processing', label: '处理中' },
          { value: 'completed', label: '已完成' }, { value: 'rejected', label: '已拒绝' },
          { value: 'admin_rejected', label: '管理员拒绝' }, { value: 'failed', label: '失败' },
        ]} />
        <Select value={verdictFilter} placeholder="审核结果" allowClear style={{ width: 140 }} onChange={setVerdictFilter} options={[
          { value: 'manual', label: '转人工' }, { value: 'pass', label: '自动通过' }, { value: 'none', label: '未审核' },
        ]} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </Space>
      {isMobile ? (
        <MobileCardList
          items={items} loading={loading} page={page} total={total} pageSize={pageSize} onPage={load}
          renderItem={(r) => (
            <Card key={r.orderId} size="small" style={{ marginBottom: 10 }}
              title={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.orderId}</span>}
              extra={<Tag color={wdStatusColor(r.status)}>{wdStatusLabel(r.status)}</Tag>}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/users/${r.userId}`)}>{r.userId}</Button>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{r.amount} {r.currency}</span>
              </div>
              <div style={{ marginTop: 6, color: '#999', fontSize: 12 }}>
                渠道 {r.channelId} · {new Date(r.createdAt).toLocaleString('zh-CN')}
              </div>
              <div style={{ marginTop: 4 }}>{verdictTag(r.reviewVerdict)}</div>
              {r.reviewVerdict != null && (
                <Collapse
                  ghost size="small" style={{ marginTop: 4 }}
                  items={[{ key: 'd', label: '审核明细', children: <ReviewDetail orderId={r.orderId} /> }]}
                />
              )}
              {r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Popconfirm title="确认批准此提款？" onConfirm={() => doApprove(r.orderId)}>
                    <Button type="primary" size="large" style={{ flex: 1 }}>批准</Button>
                  </Popconfirm>
                  <Button danger size="large" style={{ flex: 1 }} onClick={() => openReject(r.orderId)}>拒绝</Button>
                </div>
              )}
            </Card>
          )}
        />
      ) : (
        <Table
          columns={columns}
          dataSource={items}
          loading={loading}
          pagination={pagination}
          rowKey="orderId"
          size="small"
          expandable={{
            expandedRowRender: (r) => <ReviewDetail orderId={r.orderId} />,
            rowExpandable: (r) => r.reviewVerdict != null,
          }}
        />
      )}
      <Modal
        open={rejectModal.visible}
        title="拒绝原因"
        onOk={doReject}
        confirmLoading={opLoading}
        onCancel={() => setRejectModal(m => ({ ...m, visible: false }))}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {rejectModal.recommendedNote && (
            <div style={{ color: '#1677ff', fontSize: 12 }}>💡 {rejectModal.recommendedNote}</div>
          )}
          <Select
            value={rejectModal.userReason}
            options={WITHDRAW_USER_REJECT_REASON_OPTIONS}
            onChange={(userReason) => setRejectModal(m => ({ ...m, userReason }))}
            style={{ width: '100%' }}
            placeholder="请选择用户可见原因"
          />
          <Input.TextArea
            value={rejectModal.reason}
            rows={3}
            onChange={(e) => setRejectModal(m => ({ ...m, reason: e.target.value }))}
            placeholder="请输入内部拒绝原因（仅后台可见）"
          />
        </Space>
      </Modal>
    </div>
  )
}
