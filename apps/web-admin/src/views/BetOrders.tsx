import { useEffect, useState } from 'react'
import { Table, Space, Input, Select, Button, Tag, Row, Col, Statistic, DatePicker, message, Radio } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { Dayjs } from 'dayjs'
import { getBetOrders, getBetRounds, type BetOrderRecord, type BetRoundRecord, type BetOrderStats } from '../api'

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
function fmtTime(t: string | null) {
  if (!t) return <span style={{ color: '#bbb' }}>—</span>
  return <span style={{ fontSize: 12, color: '#888' }}>{new Date(t).toLocaleString('zh-CN', { hour12: false })}</span>
}

const pageSize = 20

export default function BetOrders() {
  const [view, setView] = useState<'detail' | 'round'>('detail')
  const [loading, setLoading] = useState(false)
  const [detailItems, setDetailItems] = useState<BetOrderRecord[]>([])
  const [roundItems,  setRoundItems]  = useState<BetRoundRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page,  setPage]  = useState(1)
  const [stats, setStats] = useState<BetOrderStats>({ totalBet: 0, totalWin: 0, roundCount: 0 })
  const [userId,    setUserId]    = useState('')
  const [betType,   setBetType]   = useState<string | undefined>()
  const [status,    setStatus]    = useState<string | undefined>()
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  async function load(p = 1, v = view) {
    setLoading(true)
    try {
      const base = {
        page: p, pageSize,
        userId: userId || undefined,
        dateFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
        dateTo:   dateRange?.[1]?.format('YYYY-MM-DD'),
      }
      if (v === 'round') {
        const res = await getBetRounds(base)
        setRoundItems(res.items); setTotal(res.total); setPage(p); setStats(res.stats)
      } else {
        const res = await getBetOrders({ ...base, betType, status })
        setDetailItems(res.items); setTotal(res.total); setPage(p); setStats(res.stats)
      }
    } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  function reset() {
    setUserId(''); setBetType(undefined); setStatus(undefined); setDateRange(null)
    setPage(1); void load(1)
  }

  function switchView(v: 'detail' | 'round') {
    setView(v); setPage(1); void load(1, v)
  }

  useEffect(() => { void load() }, [])

  // ── 明细列 ──────────────────────────────────────────────────────────────────
  const detailColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '用户 ID', dataIndex: 'userId', key: 'userId', width: 120, ellipsis: true },
    { title: '游戏商', key: 'providerName', width: 120, ellipsis: true,
      render: (_: unknown, r: BetOrderRecord) => r.providerName ?? r.aggregatorId ?? '-' },
    { title: '游戏名', key: 'gameName', width: 170, ellipsis: true,
      render: (_: unknown, r: BetOrderRecord) => r.gameName ?? r.providerId ?? '-' },
    { title: '局号', dataIndex: 'roundId', key: 'roundId', width: 120, ellipsis: true },
    { title: '类型', key: 'betType', width: 70,
      render: (_: unknown, r: BetOrderRecord) => <Tag color={betTypeColor(r.betType)}>{betTypeLabel(r.betType)}</Tag> },
    { title: '金额', key: 'amount', width: 170,
      render: (_: unknown, r: BetOrderRecord) => (
        <span>
          {r.currencyCode} {Number(r.amount).toFixed(2)}
          {r.originalAmount && r.currencyCode !== 'PHP' &&
            <span style={{ color: '#888', fontSize: 11, marginLeft: 4 }}>(原始 {Number(r.originalAmount).toFixed(4)})</span>}
        </span>
      ) },
    { title: '状态', key: 'status', width: 90,
      render: (_: unknown, r: BetOrderRecord) => <Tag color={statusColor(r.status)}>{statusLabel(r.status)}</Tag> },
    { title: '时间', key: 'createdAt', width: 150,
      render: (_: unknown, r: BetOrderRecord) => fmtTime(r.createdAt) },
  ]

  // ── 按局列 ──────────────────────────────────────────────────────────────────
  const roundColumns = [
    { title: '用户 ID', dataIndex: 'userId', key: 'userId', width: 120, ellipsis: true },
    { title: '游戏商', key: 'providerName', width: 120, ellipsis: true,
      render: (_: unknown, r: BetRoundRecord) => r.providerName ?? '-' },
    { title: '游戏名', key: 'gameName', width: 170, ellipsis: true,
      render: (_: unknown, r: BetRoundRecord) => r.gameName ?? '-' },
    { title: '局号', dataIndex: 'roundId', key: 'roundId', width: 120, ellipsis: true },
    { title: '投注额', key: 'betAmount', width: 130,
      render: (_: unknown, r: BetRoundRecord) => `${r.currencyCode} ${r.betAmount.toFixed(2)}` },
    { title: '派彩额', key: 'winAmount', width: 130,
      render: (_: unknown, r: BetRoundRecord) => r.winAmount > 0
        ? `${r.currencyCode} ${r.winAmount.toFixed(2)}`
        : <span style={{ color: '#bbb' }}>—</span> },
    { title: '净盈亏', key: 'ggr', width: 130,
      render: (_: unknown, r: BetRoundRecord) => {
        const ggr = r.betAmount - r.winAmount
        return <span style={{ color: ggr >= 0 ? '#3f8600' : '#cf1322', fontWeight: 500 }}>
          {ggr >= 0 ? '+' : ''}{r.currencyCode} {ggr.toFixed(2)}
        </span>
      } },
    { title: '投注时间', key: 'betTime', width: 155,
      render: (_: unknown, r: BetRoundRecord) => fmtTime(r.betTime) },
    { title: '派彩时间', key: 'winTime', width: 155,
      render: (_: unknown, r: BetRoundRecord) => r.winTime
        ? fmtTime(r.winTime)
        : <Tag color="processing">进行中</Tag> },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total,
    showSizeChanger: false,
    showTotal: (t) => view === 'round' ? `共 ${t} 局` : `共 ${t} 条`,
    onChange: (p) => load(p),
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>投注记录</h2>
        <Radio.Group value={view} onChange={(e) => switchView(e.target.value)} optionType="button" buttonStyle="solid">
          <Radio.Button value="detail">明细</Radio.Button>
          <Radio.Button value="round">按局</Radio.Button>
        </Radio.Group>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Statistic title="总投注" value={stats.totalBet.toFixed(2)} /></Col>
        <Col span={6}><Statistic title="总派彩" value={stats.totalWin.toFixed(2)} /></Col>
        <Col span={6}><Statistic title="GGR" value={(stats.totalBet - stats.totalWin).toFixed(2)}
          valueStyle={{ color: stats.totalBet >= stats.totalWin ? '#3f8600' : '#cf1322' }} /></Col>
        <Col span={6}><Statistic title="局数" value={stats.roundCount} /></Col>
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户 ID"
          allowClear style={{ width: 160 }} onPressEnter={() => load(1)} />
        {view === 'detail' && <>
          <Select value={betType} placeholder="类型" allowClear style={{ width: 110 }}
            onChange={(v) => { setBetType(v); void load(1) }} options={[
              { value: 'bet', label: '投注' }, { value: 'win', label: '派彩' },
              { value: 'refund', label: '退款' }, { value: 'cancel', label: '取消' },
            ]} />
          <Select value={status} placeholder="状态" allowClear style={{ width: 110 }}
            onChange={(v) => { setStatus(v); void load(1) }} options={[
              { value: 'pending', label: '待结算' }, { value: 'settled', label: '已结算' }, { value: 'failed', label: '失败' },
            ]} />
        </>}
        <DatePicker.RangePicker value={dateRange} format="YYYY-MM-DD" style={{ width: 240 }}
          onChange={(v) => { setDateRange(v); void load(1) }} />
        <Button type="primary" onClick={() => load(1)}>查询</Button>
        <Button onClick={reset}>重置</Button>
      </Space>

      {view === 'detail'
        ? <Table dataSource={detailItems} columns={detailColumns} rowKey="id"
            loading={loading} pagination={pagination} size="small" />
        : <Table dataSource={roundItems}  columns={roundColumns}  rowKey="roundId"
            loading={loading} pagination={pagination} size="small" />}
    </div>
  )
}
