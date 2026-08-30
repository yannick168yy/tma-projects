import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Col, Collapse, Form, InputNumber, Modal, Progress, Row,
  Segmented, Select, Space, Spin, Table, Tooltip, message,
} from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  getBiAlerts, getBiForecast, getBiOverview, getBiTargetProgress, getBiTargets, getBiTrends, putBiTarget,
  type BiForecastPoint, type BiOverview, type BiTargetProgress, type BiTrendPoint, type BiWindowStats,
} from '../api'
import { BI_COLORS as C, LineChart } from '../components/BiCharts'

const METRIC_LABEL: Record<string, string> = {
  ggr: 'GGR（USDT等值）', deposit: '充值（USDT等值）', new_users: '新增注册', first_dep_users: '首充人数',
}

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

function TargetSection() {
  const canEdit = ['super_admin', 'finance'].includes(localStorage.getItem('admin_role') ?? '')
  const [progress, setProgress] = useState<{ period: string; items: BiTargetProgress[] } | null>(null)
  const [editing, setEditing] = useState(false)
  const [form] = Form.useForm()

  const load = () => getBiTargetProgress().then(setProgress).catch(() => {})
  useEffect(() => { load() }, [])

  const openEdit = async () => {
    if (!progress) return
    const targets = await getBiTargets(progress.period)
    form.setFieldsValue(Object.fromEntries(targets.map((t) => [t.metric, t.targetValue])))
    setEditing(true)
  }
  const save = async () => {
    if (!progress) return
    const values = form.getFieldsValue() as Record<string, number | null>
    for (const metric of Object.keys(METRIC_LABEL)) {
      const v = values[metric]
      if (v != null && v >= 0) await putBiTarget(progress.period, metric, v)
    }
    message.success('目标已保存')
    setEditing(false)
    load()
  }

  if (!progress) return null
  if (progress.items.length === 0 && !canEdit) return null

  return (
    <Card bordered={false} size="small" style={{ marginBottom: 16 }}
      title={`本月目标进度（${progress.period}）`}
      extra={canEdit && <Button size="small" onClick={openEdit}>设置目标</Button>}>
      {progress.items.length === 0 && <div style={{ color: '#999' }}>尚未设置本月目标</div>}
      <Row gutter={16}>
        {progress.items.map((it) => {
          const compPct = Math.round(it.completion * 100)
          const timePct = Math.round(it.timeProgress * 100)
          const ahead = it.completion >= it.timeProgress
          return (
            <Col xs={24} md={12} lg={6} key={it.metric}>
              <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                <b>{METRIC_LABEL[it.metric] ?? it.metric}</b>
                <span style={{ color: ahead ? '#3f8600' : '#cf1322', fontSize: 12 }}>
                  {compPct}% / 时间 {timePct}%
                </span>
              </div>
              <Progress percent={Math.min(compPct, 100)} strokeColor={ahead ? '#008300' : '#eb6834'} showInfo={false} />
              <div style={{ fontSize: 12, color: '#52514e' }}>
                {fmtMoney(it.actual)} / {fmtMoney(it.target)}，剩余日均需 {fmtMoney(it.requiredDaily)}
              </div>
              <div style={{ fontSize: 12, color: it.projectedCompletion >= 1 ? '#3f8600' : '#d46b08' }}>
                按趋势预计月底 {Math.round(it.projectedCompletion * 100)}%（{fmtMoney(it.projected)}）
              </div>
            </Col>
          )
        })}
      </Row>
      <Modal title={`设置 ${progress.period} 月度目标`} open={editing} onOk={save} onCancel={() => setEditing(false)}>
        <Form form={form} layout="vertical">
          {Object.entries(METRIC_LABEL).map(([metric, label]) => (
            <Form.Item key={metric} name={metric} label={label}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </Card>
  )
}

function ForecastSection() {
  const [ggr, setGgr] = useState<{ history: BiForecastPoint[]; forecast: BiForecastPoint[] } | null>(null)
  const [dep, setDep] = useState<{ history: BiForecastPoint[]; forecast: BiForecastPoint[] } | null>(null)

  useEffect(() => {
    getBiForecast('ggr').then(setGgr).catch(() => {})
    getBiForecast('deposit').then(setDep).catch(() => {})
  }, [])

  if (!ggr || !dep) return null
  const dates = [...ggr.history.map((p) => p.date), ...ggr.forecast.map((p) => p.date)]
  const n = ggr.history.length
  // 实际段与预测段在交界处共享一个点，视觉连续
  const mk = (d: { history: BiForecastPoint[]; forecast: BiForecastPoint[] }) => ({
    actual: [...d.history.map((p) => p.value), ...d.forecast.map(() => null)],
    pred: [...d.history.map((p, i) => (i === n - 1 ? p.value : null)), ...d.forecast.map((p) => p.value)],
  })
  const g = mk(ggr); const w = mk(dep)

  return (
    <Card bordered={false} size="small" title="未来 7 天预测（虚线，按星期规律外推，折算 USDT）" style={{ marginBottom: 16 }}>
      <LineChart dates={dates} height={260} series={[
        { name: 'GGR', color: C.green, data: g.actual },
        { name: 'GGR 预测', color: C.green, data: g.pred, dashed: true },
        { name: '充值', color: C.blue, data: w.actual },
        { name: '充值预测', color: C.blue, data: w.pred, dashed: true },
      ]} />
    </Card>
  )
}

export default function BiDashboard() {
  const navigate = useNavigate()
  const [openAlerts, setOpenAlerts] = useState(0)
  const [overview, setOverview] = useState<BiOverview | null>(null)
  const [trend, setTrend] = useState<{ currency: string; series: BiTrendPoint[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(30)
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')
  const [currency, setCurrency] = useState('ALL')

  useEffect(() => {
    getBiOverview().then(setOverview)
    getBiAlerts('open').then((a) => setOpenAlerts(a.length)).catch(() => {})
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
      make('今日 GGR（USDT等值）', (s) => Math.round(s.ggr), true, '有效投注-派彩，多币种折算 USDT'),
      make('今日 NGR（USDT等值）', (s) => Math.round(s.ngr), true, 'GGR-活动成本'),
      make('今日充值（USDT等值）', (s) => Math.round(s.depositAmount)),
      make('今日提现（USDT等值）', (s) => Math.round(s.withdrawAmount)),
      make('今日投注额（USDT等值）', (s) => Math.round(s.betAmount)),
      make('活跃用户 DAU', (s) => s.dau, false, '登录∪投注∪充值去重'),
      make('新增注册', (s) => s.newUsers, false),
      make('首充人数', (s) => s.firstDepUsers, false),
    ]
  }, [overview])

  const dates = useMemo(() => (trend?.series ?? []).map((p) => p.date), [trend])
  const pick = (k: keyof BiTrendPoint) => (trend?.series ?? []).map((p) => Math.round(Number(p[k]) * 100) / 100)

  const unit = trend?.currency ?? ''
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

      {openAlerts > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message={`有 ${openAlerts} 条未处理的数据异常告警（厂商 RTP 偏离基线）`}
          action={<a onClick={() => navigate('/bi/providers')}>去处理</a>}
        />
      )}

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

      <TargetSection />
      <ForecastSection />

      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented value={days} onChange={(v) => setDays(v as number)}
          options={[{ label: '近30天', value: 30 }, { label: '近90天', value: 90 }, { label: '近180天', value: 180 }]} />
        <Segmented value={granularity} onChange={(v) => setGranularity(v as 'day' | 'week' | 'month')}
          options={[{ label: '按日', value: 'day' }, { label: '按周', value: 'week' }, { label: '按月', value: 'month' }]} />
        <Select value={currency} onChange={setCurrency} style={{ width: 140 }}
          options={[
            { label: '全部折算 USDT', value: 'ALL' },
            { label: 'PHP', value: 'PHP' },
            { label: 'IDR', value: 'IDR' },
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
