import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Col, Collapse, Row, Segmented, Select, Space, Spin, Table, Tooltip } from 'antd'
import * as echarts from 'echarts'
import { getBiOverview, getBiTrends, type BiOverview, type BiTrendPoint, type BiWindowStats } from '../api'

// 配色已通过 dataviz 校验（色觉障碍/对比度），黄色系依赖下方数据表格作 relief
const C = { blue: '#2a78d6', green: '#008300', orange: '#eb6834', violet: '#4a3aa7', red: '#e34948', yellow: '#eda100' }

const fmtMoney = (v: number) => v.toLocaleString('en-PH', { maximumFractionDigits: 0 })

function DeltaTag({ cur, base, label }: { cur: number; base: number; label: string }) {
  if (!base) return <span style={{ color: '#999', fontSize: 12 }}>{label} —</span>
  const pct = ((cur - base) / Math.abs(base)) * 100
  const color = pct >= 0 ? '#3f8600' : '#cf1322'
  return (
    <span style={{ color, fontSize: 12 }}>
      {label} {pct >= 0 ? '↑' : '↓'}{Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function LineChart({ dates, series, height = 300 }: {
  dates: string[]
  series: { name: string; color: string; data: number[] }[]
  height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross', label: { show: false } } },
      legend: { top: 0, textStyle: { color: '#52514e' } },
      grid: { left: 56, right: 16, top: 32, bottom: 24 },
      xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#ddd' } }, axisLabel: { color: '#52514e' } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { color: '#52514e' } },
      series: series.map((s) => ({
        name: s.name, type: 'line', data: s.data,
        lineStyle: { width: 2 }, itemStyle: { color: s.color },
        symbol: 'circle', symbolSize: 8, showSymbol: dates.length <= 31,
      })),
    }, true)
  }, [dates, series])

  return <div ref={ref} style={{ height }} />
}

export default function BiDashboard() {
  const [overview, setOverview] = useState<BiOverview | null>(null)
  const [trend, setTrend] = useState<{ currency: string; series: BiTrendPoint[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(30)
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')
  const [currency, setCurrency] = useState('ALL')

  useEffect(() => {
    getBiOverview().then(setOverview)
    const timer = setInterval(() => getBiOverview().then(setOverview), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setLoading(true)
    getBiTrends({ days, granularity, currency }).then(setTrend).finally(() => setLoading(false))
  }, [days, granularity, currency])

  const cards = useMemo(() => {
    if (!overview) return []
    const t = overview.today
    const make = (label: string, pick: (s: BiWindowStats) => number, money = true, hint?: string) => ({
      label, hint,
      value: money ? fmtMoney(pick(t)) : pick(t),
      yd: { cur: pick(t), base: pick(overview.yesterdaySameTime) },
      lw: { cur: pick(t), base: pick(overview.lastWeekSameTime) },
      ydFull: money ? fmtMoney(pick(overview.yesterdayFull)) : pick(overview.yesterdayFull),
    })
    return [
      make('今日 GGR (₱)', (s) => Math.round(s.ggr), true, '有效投注-派彩，多币种折算 PHP'),
      make('今日 NGR (₱)', (s) => Math.round(s.ngr), true, 'GGR-活动成本'),
      make('今日充值 (₱)', (s) => Math.round(s.depositAmount)),
      make('今日提现 (₱)', (s) => Math.round(s.withdrawAmount)),
      make('今日投注额 (₱)', (s) => Math.round(s.betAmount)),
      make('活跃用户 DAU', (s) => s.dau, false, '登录∪投注∪充值去重'),
      make('新增注册', (s) => s.newUsers, false),
      make('首充人数', (s) => s.firstDepUsers, false),
    ]
  }, [overview])

  const dates = useMemo(() => (trend?.series ?? []).map((p) => p.date), [trend])
  const pick = (k: keyof BiTrendPoint) => (trend?.series ?? []).map((p) => Math.round(Number(p[k]) * 100) / 100)

  const unit = trend?.currency === 'PHP' ? '₱' : trend?.currency ?? ''
  const tableCols = [
    { title: '日期', dataIndex: 'date' },
    { title: `充值(${unit})`, dataIndex: 'deposit', render: fmtMoney },
    { title: `提现(${unit})`, dataIndex: 'withdraw', render: fmtMoney },
    { title: `投注(${unit})`, dataIndex: 'betAmount', render: fmtMoney },
    { title: `GGR(${unit})`, dataIndex: 'ggr', render: fmtMoney },
    { title: `活动成本(${unit})`, dataIndex: 'bonusCost', render: fmtMoney },
    { title: `NGR(${unit})`, dataIndex: 'ngr', render: fmtMoney },
    { title: 'DAU', dataIndex: 'dau' },
    { title: '新增', dataIndex: 'newUsers' },
    { title: '首充', dataIndex: 'firstDepUsers' },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>运营驾驶舱</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        今日数字为实时累计；对比口径=昨日同时刻/上周同日同时刻。趋势图每日凌晨汇总，多币种按当前汇率折算。
      </div>

      <Row gutter={16}>
        {cards.map((c) => (
          <Col xs={12} md={6} key={c.label}>
            <Card bordered={false} style={{ marginBottom: 16 }} size="small">
              <Tooltip title={c.hint}>
                <div style={{ color: '#8c8c8c', fontSize: 13 }}>{c.label}</div>
              </Tooltip>
              <div style={{ fontSize: 24, fontWeight: 600, margin: '4px 0' }}>{c.value}</div>
              <Space size={8} wrap>
                <DeltaTag cur={c.yd.cur} base={c.yd.base} label="较昨日" />
                <DeltaTag cur={c.lw.cur} base={c.lw.base} label="较上周" />
              </Space>
              <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>昨日全天 {c.ydFull}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented value={days} onChange={(v) => setDays(v as number)}
          options={[{ label: '近30天', value: 30 }, { label: '近90天', value: 90 }, { label: '近180天', value: 180 }]} />
        <Segmented value={granularity} onChange={(v) => setGranularity(v as 'day' | 'week' | 'month')}
          options={[{ label: '按日', value: 'day' }, { label: '按周', value: 'week' }, { label: '按月', value: 'month' }]} />
        <Select value={currency} onChange={setCurrency} style={{ width: 140 }}
          options={[
            { label: '全部折算 PHP', value: 'ALL' },
            { label: 'PHP', value: 'PHP' },
            { label: 'USDT', value: 'USDT' },
            { label: 'USDC', value: 'USDC' },
          ]} />
      </Space>

      <Spin spinning={loading}>
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Card bordered={false} title={`盈利趋势 (${unit})`} size="small" style={{ marginBottom: 16 }}>
              <LineChart dates={dates} series={[
                { name: 'GGR', color: C.green, data: pick('ggr') },
                { name: 'NGR', color: C.violet, data: pick('ngr') },
                { name: '活动成本', color: C.red, data: pick('bonusCost') },
              ]} />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card bordered={false} title={`资金趋势 (${unit})`} size="small" style={{ marginBottom: 16 }}>
              <LineChart dates={dates} series={[
                { name: '充值', color: C.blue, data: pick('deposit') },
                { name: '提现', color: C.orange, data: pick('withdraw') },
              ]} />
            </Card>
          </Col>
          <Col xs={24}>
            <Card bordered={false} title="用户趋势（不受币种筛选影响；周/月粒度为日数据累计）" size="small" style={{ marginBottom: 16 }}>
              <LineChart dates={dates} series={[
                { name: 'DAU', color: C.blue, data: pick('dau') },
                { name: '新增注册', color: C.green, data: pick('newUsers') },
                { name: '首充人数', color: C.yellow, data: pick('firstDepUsers') },
              ]} height={260} />
            </Card>
          </Col>
        </Row>

        <Collapse
          items={[{
            key: 'table',
            label: '数据表格',
            children: (
              <Table
                size="small"
                rowKey="date"
                columns={tableCols}
                dataSource={[...(trend?.series ?? [])].reverse()}
                pagination={{ pageSize: 31, showSizeChanger: false }}
                scroll={{ x: 900 }}
              />
            ),
          }]}
        />
      </Spin>
    </div>
  )
}
