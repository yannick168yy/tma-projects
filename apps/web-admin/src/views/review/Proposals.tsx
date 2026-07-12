import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Space, Input, Select, Button, Tag } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getReviewProposals, type ReviewProposal } from '../../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../../pagination'
import { verdictTag, wdStatusLabel } from './shared'

export default function Proposals({ queue = false }: { queue?: boolean }) {
  const navigate = useNavigate()
  const [userIdFilter, setUserIdFilter] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ReviewProposal[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  async function load(p = 1, ps = pageSize) {
    setPage(p); setPageSize(ps); setLoading(true)
    try {
      const res = await getReviewProposals({
        page: p, pageSize: ps,
        userId: userIdFilter || undefined,
        reviewVerdict: queue ? undefined : verdictFilter,
        queue: queue ? 'manual' : undefined,
      })
      setItems(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [queue])

  const columns = [
    { title: '订单号', dataIndex: 'orderId', width: 170 },
    { title: '用户', key: 'user', render: (_: unknown, r: ReviewProposal) => (
      <Button type="link" size="small" onClick={() => navigate(`/users/${r.userId}`)}>{r.displayName || r.userId}</Button>
    ) },
    { title: '金额', key: 'amount', render: (_: unknown, r: ReviewProposal) => `${r.amount} ${r.currency}` },
    { title: '渠道', dataIndex: 'channelId', width: 90 },
    { title: '审核结果', key: 'verdict', width: 100, render: (_: unknown, r: ReviewProposal) => verdictTag(r.reviewVerdict) },
    { title: '命中规则', key: 'hits', render: (_: unknown, r: ReviewProposal) => (
      r.hitRules.length ? <Space size={[0, 4]} wrap>{r.hitRules.map((h) => <Tag key={h.code} color="orange">{h.name}</Tag>)}</Space> : <span style={{ color: '#ccc' }}>—</span>
    ) },
    { title: '订单状态', key: 'status', width: 100, render: (_: unknown, r: ReviewProposal) => <Tag>{wdStatusLabel(r.status)}</Tag> },
    { title: '审核时间', key: 'reviewedAt', width: 160, render: (_: unknown, r: ReviewProposal) => r.reviewedAt ? new Date(r.reviewedAt).toLocaleString('zh-CN') : '—' },
    { title: '操作', key: 'op', width: 80, render: (_: unknown, r: ReviewProposal) => (
      <Button type="link" size="small" onClick={() => navigate(`/review/proposals/${r.orderId}`)}>详情</Button>
    ) },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total, showTotal: (t) => `共 ${t} 条`, pageSizeOptions: PAGE_SIZE_OPTIONS, onChange: (p, ps) => load(p, ps),
  }

  return (
    <div>
      <h2>{queue ? '待人工处理' : '提案审核记录'}</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} placeholder="用户ID" style={{ width: 160 }} allowClear />
        {!queue && (
          <Select value={verdictFilter} placeholder="审核结果" allowClear style={{ width: 140 }} onChange={setVerdictFilter} options={[
            { value: 'manual', label: '转人工' }, { value: 'pass', label: '自动通过' }, { value: 'none', label: '未审核' },
          ]} />
        )}
        <Button type="primary" onClick={() => load(1)}>查询</Button>
      </Space>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="orderId" size="small" />
    </div>
  )
}
