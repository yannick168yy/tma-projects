import { useEffect, useState } from 'react'
import { Table, Space, Input, Select, Button, Tag, Row, Col, Statistic, DatePicker, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { Dayjs } from 'dayjs'
import { getBetOrders, type BetOrderRecord, type BetOrderStats } from '../api'

function betTypeColor(t: string) {
  if (t === 'bet') return 'blue'
  if (t === 'win') return 'green'
  if (t === 'refund') return 'orange'
  return 'default'
}
function betTypeLabel(t: string) {
  return ({ bet: '投注', win: '派彩', refund: '退款', cancel: '取消' } as Record<string, string>)[t] ?? t
}
function statusColor(s: string) {
  if (s === 'settled') return 'green'
  if (s === 'failed') return 'red'
  return 'default'
}
function statusLabel(s: string) {
  return ({ pending: '待结算', settled: '已结算', failed: '失败' } as Record<string, string>)[s] ?? s
}
function fmtTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

const pageSize = 20

export default function BetOrders() {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<BetOrderRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState<BetOrderStats>({ totalBet: 0, totalWin: 0, roundCount: 0 })
  const [userId, setUserId] = useState('')
  const [betType, setBetType] = useState<string | undefined>()
  const [status, setStatus] = useState<string | undefined>()
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  async function load(p = 1) {
    setLoading(true)
    try {
      const res = await getBetOrders({
        page: p, pageSize,
        userId: userId || undefined,
        betType,
        status,
        dateFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
        dateTo: dateRange?.[1]?.format('YYYY-MM-DD'),
      })
      setItems(res.items); setTotal(res.total); setPage(p)
      setStats(res.stats)
    } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  function reset() {
    setUserId(''); setBetType(undefined); setStatus(undefined); setDateRange(null)
    setPage(1); void load(1)
  }

  useEffect(() => { void load() }, [])

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '用户 ID', dataIndex: 'userId', key: 'userId', width: 120, ellipsis: true },
    { title: '游戏商', key: 'providerName', width: 130, ellipsis: true, render: (_: unknown, r: BetOrderRecord) => r.providerName ?? r.aggregatorId ?? '-' },
    { title: '游戏名', key: 'gameName', width: 180, ellipsis: true, render: (_: unknown, r: BetOrderRecord) => r.gameName ?? r.providerId ?? '-' },
    { title: '局号', dataIndex: 'roundId', key: 'roundId', width: 130, ellipsis: true },
    { title: '类型', key: 'betType', width: 70, render: (_: unknown, r: BetOrderRecord) => <Tag color={betTypeColor(r.betType)}>{betTypeLabel(r.betType)}</Tag> },
    {
      title: '金额', key: 'amount', width: 180,
      render: (_: unknown, r: BetOrderRecord) => (
        <span>
          {r.currencyCode} {Number(r.amount).toFixed(2)}
          {r.originalAmount && r.currencyCode !== 'PHP' && <span style={{ color: '#888', fontSize: 11, marginLeft: 4 }}>(原始 {Number(r.originalAmount).toFixed(4)})</span>}
        </span>
      ),
    },
    { title: '状态', key: 'status', width: 90, render: (_: unknown, r: BetOrderRecord) => <Tag color={statusColor(r.status)}>{statusLabel(r.status)}</Tag> },
    { title: '时间', key: 'createdAt', width: 150, render: (_: unknown, r: BetOrderRecord) => <span style={{ fontSize: 12, color: '#888' }}>{fmtTime(r.createdAt)}</span> },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total,
    showSizeChanger: false,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => load(p),
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>投注记录</h2>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Statistic title="总投注（PHP）" value={stats.totalBet.toFixed(2)} prefix="₱" /></Col>
        <Col span={6}><Statistic title="总派彩（PHP）" value={stats.totalWin.toFixed(2)} prefix="₱" /></Col>
        <Col span={6}><Statistic title="GGR（PHP）" value={(stats.totalBet - stats.totalWin).toFixed(2)} prefix="₱" valueStyle={{ color: stats.totalBet >= stats.totalWin ? '#3f8600' : '#cf1322' }} /></Col>
        <Col span={6}><Statistic title="局数" value={stats.roundCount} /></Col>
      </Row>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户 ID" allowClear style={{ width: 160 }} onPressEnter={() => load(1)} />
        <Select value={betType} placeholder="类型" allowClear style={{ width: 110 }} onChange={(v) => { setBetType(v); void load(1) }} options={[
          { value: 'bet', label: '投注' }, { value: 'win', label: '派彩' }, { value: 'refund', label: '退款' }, { value: 'cancel', label: '取消' },
        ]} />
        <Select value={status} placeholder="状态" allowClear style={{ width: 110 }} onChange={(v) => { setStatus(v); void load(1) }} options={[
          { value: 'pending', label: '待结算' }, { value: 'settled', label: '已结算' }, { value: 'failed', label: '失败' },
        ]} />
        <DatePicker.RangePicker
          value={dateRange}
          format="YYYY-MM-DD"
          style={{ width: 240 }}
          onChange={(v) => { setDateRange(v); void load(1) }}
        />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
        <Button onClick={reset}>重置</Button>
      </Space>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} pagination={pagination} size="small" />
    </div>
  )
}
