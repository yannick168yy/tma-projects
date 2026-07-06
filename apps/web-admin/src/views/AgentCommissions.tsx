import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Button, Tag, Space, DatePicker, Statistic, Row, Col, message, Popconfirm } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getAgentCommissionReport, settleAgentMonth, payAgentCommission,
  type AgentCommissionReportItem,
} from '../api'

const peso = (c: number) => `₱${(c / 100).toFixed(2)}`
const STATUS_LABEL: Record<string, string> = { pending: '待打款', paid: '已打款', voided: '作废' }

export default function AgentCommissions() {
  const navigate = useNavigate()
  const [month, setMonth] = useState<Dayjs>(dayjs())
  const [loading, setLoading] = useState(false)
  const [settling, setSettling] = useState(false)
  const [items, setItems] = useState<AgentCommissionReportItem[]>([])
  const [summary, setSummary] = useState({ total_commission_cents: 0, pending_cents: 0 })

  const period = month.format('YYYY-MM')

  async function load() {
    setLoading(true)
    try {
      const data = await getAgentCommissionReport(period)
      setItems(data.items)
      setSummary(data.summary)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [period])

  async function handleSettle() {
    setSettling(true)
    try {
      const r = await settleAgentMonth(period)
      message.success(`已结算 ${r.period}：${r.agentCount} 个代理，合计 ${peso(r.totalCommissionCents)}`)
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '结算失败') }
    finally { setSettling(false) }
  }

  return (
    <Card
      title="代理分成报表"
      extra={
        <Space>
          <DatePicker picker="month" value={month} onChange={(d) => d && setMonth(d)} allowClear={false} />
          <Popconfirm title={`确认重新结算 ${period}？已标记打款的不会被覆盖`} onConfirm={handleSettle}>
            <Button type="primary" loading={settling}>结算本月</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Row gutter={16} style={{ marginBottom: 16 }} className="responsive-cols">
        <Col span={8}><Statistic title="应分合计" value={summary.total_commission_cents / 100} precision={2} prefix="₱" /></Col>
        <Col span={8}><Statistic title="待打款" value={summary.pending_cents / 100} precision={2} prefix="₱" /></Col>
      </Row>
      <Table<AgentCommissionReportItem>
        rowKey="agent_id"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          { title: '代理', render: (_, r) => <a onClick={() => navigate(`/agents/${r.agent_id}`)}>{r.name || r.agent_id}</a> },
          { title: '当月GGR', dataIndex: 'ggr_cents', render: peso },
          { title: '上期结转', dataIndex: 'carry_in_cents', render: peso },
          { title: '净GGR', dataIndex: 'net_ggr_cents', render: peso },
          { title: '结转下期', dataIndex: 'carry_out_cents', render: peso },
          { title: '分成%', dataIndex: 'rate_pct', render: (v) => `${v}%` },
          { title: '应分', dataIndex: 'commission_cents', render: peso },
          {
            title: '状态', dataIndex: 'status',
            render: (s) => <Tag color={s === 'paid' ? 'green' : s === 'voided' ? 'default' : 'orange'}>{STATUS_LABEL[s] ?? s}</Tag>,
          },
          {
            title: '操作',
            render: (_, r) => (r.status === 'pending' && r.commission_cents > 0 ? (
              <Popconfirm title="确认标记为已线下打款？" onConfirm={async () => {
                await payAgentCommission(r.agent_id, period); message.success('已标记打款'); await load()
              }}>
                <a>标记打款</a>
              </Popconfirm>
            ) : '-'),
          },
        ]}
      />
    </Card>
  )
}
