import { useCallback, useEffect, useState } from 'react'
import { Card, Col, DatePicker, InputNumber, Row, Space, Spin, Table, Tag, Tooltip, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getAdSources, getAdSourceTrend, getChannelQuality, getChannelPrices, upsertChannelPrice,
  type AdSourceRow, type AdSourceReport, type ChannelQualityRow, type ChannelPrice,
} from '../api'
import { LineChart } from '../components/BiCharts'

const fmt = (v: number) => Math.round(v).toLocaleString()
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const ARPU_TARGET = 1200
const manilaToday = () => dayjs()
const isSuper = () => localStorage.getItem('admin_role') === 'super_admin'

export default function BiAdChannel() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([manilaToday().subtract(6, 'day'), manilaToday()])
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<AdSourceReport | null>(null)
  const [quality, setQuality] = useState<{ rows: ChannelQualityRow[]; usdToPhp: number } | null>(null)
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [trendChannel, setTrendChannel] = useState<string | null>(null)
  const [trend, setTrend] = useState<{ dates: string[]; reg: number[]; fd: number[]; dep: number[]; arpu: (number | null)[] } | null>(null)

  const from = range[0].format('YYYY-MM-DD')
  const to = range[1].format('YYYY-MM-DD')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      getAdSources({ from, to, currency: 'PHP' }),
      getChannelQuality({ from, to, currency: 'PHP' }),
      getChannelPrices(),
    ]).then(([rep, qual, pr]) => {
      setReport(rep)
      setQuality(qual)
      setPrices(Object.fromEntries(pr.map((p: ChannelPrice) => [p.channelCode, p.cpaUsd])))
    }).finally(() => setLoading(false))
  }, [from, to])
  useEffect(() => { load() }, [load])

  const openTrend = (code: string) => {
    setTrendChannel(code); setTrend(null)
    getAdSourceTrend({ channel: code, from, to, currency: 'PHP' }).then((r) => setTrend({
      dates: r.points.map((p) => p.date.slice(5)),
      reg: r.points.map((p) => p.regUsers),
      fd: r.points.map((p) => p.firstDepUsers),
      dep: r.points.map((p) => Math.round(p.depositAmount)),
      arpu: r.points.map((p) => (p.arpu == null ? null : Math.round(p.arpu))),
    }))
  }

  const savePrice = async (channelCode: string, cpaUsd: number) => {
    try {
      await upsertChannelPrice({ channelCode, cpaUsd })
      setPrices((m) => ({ ...m, [channelCode]: cpaUsd }))
      message.success('已保存单价')
    } catch (e) { message.error((e as Error).message) }
  }

  const t = report?.totals
  const usdToPhp = quality?.usdToPhp ?? 58

  const arpuCell = (v: number | null) => v == null
    ? <span style={{ color: '#bbb' }}>—</span>
    : <span style={{ color: v >= ARPU_TARGET ? '#3f8600' : '#cf1322', fontWeight: 500 }}>{fmt(v)}</span>

  // ① 概览 + ② 渠道量表用 getAdSources；③ 质量表用 getChannelQuality
  const sourceCols = [
    { title: '渠道', dataIndex: 'channelCode', fixed: 'left' as const, render: (v: string) => <a onClick={() => openTrend(v)}>{v}</a> },
    { title: '下载', dataIndex: 'downloads' },
    { title: '安装', dataIndex: 'installs' },
    { title: '注册', dataIndex: 'regUsers', sorter: (a: AdSourceRow, b: AdSourceRow) => a.regUsers - b.regUsers },
    { title: '首存', dataIndex: 'firstDepUsers', defaultSortOrder: 'descend' as const, sorter: (a: AdSourceRow, b: AdSourceRow) => a.firstDepUsers - b.firstDepUsers },
    { title: '首存转化', key: 'cvr', render: (_: unknown, r: AdSourceRow) => (r.regUsers > 0 ? pct(r.firstDepUsers / r.regUsers) : '—') },
    { title: '总充值(₱)', dataIndex: 'depositAmount', render: fmt },
    { title: <Tooltip title="客均=总充值÷首存人数；条款门槛≥₱1200">客均(₱)</Tooltip>, dataIndex: 'arpu', render: arpuCell },
  ]

  const qualityCols = [
    { title: '渠道', dataIndex: 'channelCode', fixed: 'left' as const },
    { title: <Tooltip title="注册后次日仍有登录/投注">D1留存</Tooltip>, key: 'd1', render: (_: unknown, r: ChannelQualityRow) => `${r.d1Retained}${r.regUsers ? ` (${((r.d1Retained / r.regUsers) * 100).toFixed(0)}%)` : ''}` },
    { title: <Tooltip title="注册后第7日仍有活跃">D7留存</Tooltip>, key: 'd7', render: (_: unknown, r: ChannelQualityRow) => `${r.d7Retained}${r.regUsers ? ` (${((r.d7Retained / r.regUsers) * 100).toFixed(0)}%)` : ''}` },
    { title: <Tooltip title="首存后又充过的人数占比">复充率</Tooltip>, key: 'redep', render: (_: unknown, r: ChannelQualityRow) => pct(r.reDepRate) },
    { title: <Tooltip title="人均累计充值(LTV雏形)=总充值÷首存人数">人均充值(₱)</Tooltip>, dataIndex: 'avgLtvPhp', render: (v: number | null) => v == null ? '—' : fmt(v) },
    {
      title: <Tooltip title="每首存单价(USD)，用于算回本倍数。super_admin 可改">CPA单价($)</Tooltip>, key: 'cpa',
      render: (_: unknown, r: ChannelQualityRow) => isSuper()
        ? <InputNumber size="small" min={0} max={100000} defaultValue={prices[r.channelCode] ?? r.cpaUsd} style={{ width: 90 }} onBlur={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v >= 0) savePrice(r.channelCode, v) }} />
        : (prices[r.channelCode] ?? r.cpaUsd) || '—',
    },
    {
      title: <Tooltip title="人均累计充值 ÷ (CPA单价×汇率)，>1=已回本">回本倍数</Tooltip>, key: 'roi',
      render: (_: unknown, r: ChannelQualityRow) => {
        const cpa = prices[r.channelCode] ?? r.cpaUsd
        if (!cpa || r.avgLtvPhp == null) return '—'
        const roi = r.avgLtvPhp / (cpa * usdToPhp)
        return <span style={{ color: roi >= 1 ? '#3f8600' : '#cf1322', fontWeight: 500 }}>{roi.toFixed(2)}x</span>
      },
    },
    {
      title: <Tooltip title="同一注册IP出现≥2个账号的用户数，疑似刷量，结算前重点核">刷量预警</Tooltip>, dataIndex: 'suspiciousUsers',
      render: (v: number) => v > 0 ? <Tag color="red">{v}</Tag> : <span style={{ color: '#bbb' }}>0</span>,
    },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>投放渠道分析</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        按短码(渠道)统计买量效果。上表看「来了多少人」，下表看「来的人值不值 CPA」——留存、复充、人均充值、回本倍数、刷量预警。
        数据实时查询，马尼拉日(UTC+8)切日，币种 PHP。
      </div>

      <Space style={{ marginBottom: 16 }}>
        <DatePicker.RangePicker value={range} format="YYYY-MM-DD" allowClear={false} style={{ width: 240 }}
          onChange={(v) => { if (v && v[0] && v[1]) setRange([v[0], v[1]]) }} />
      </Space>

      <Spin spinning={loading}>
        {t && (
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col><Tag>下载 {t.downloads} / 安装 {t.installs}</Tag></Col>
            <Col><Tag color="blue">注册 {t.regUsers}</Tag></Col>
            <Col><Tag color="geekblue">首存 {t.firstDepUsers}</Tag></Col>
            <Col><Tag>转化 {t.regUsers ? ((t.firstDepUsers / t.regUsers) * 100).toFixed(1) : '0'}%</Tag></Col>
            <Col><Tag color="green">总充值 ₱{fmt(t.depositAmount)}</Tag></Col>
            <Col><Tag color={t.arpu != null && t.arpu >= ARPU_TARGET ? 'success' : 'error'}>整体客均 {t.arpu == null ? '—' : `₱${fmt(t.arpu)}`}</Tag></Col>
          </Row>
        )}

        <Card bordered={false} size="small" title="渠道规模（来了多少人）">
          <Table size="small" rowKey="channelCode" columns={sourceCols} dataSource={report?.rows ?? []} pagination={false} scroll={{ x: 800 }} />
        </Card>

        <Card bordered={false} size="small" title="渠道质量（值不值 CPA）" style={{ marginTop: 16 }}>
          <Table size="small" rowKey="channelCode" columns={qualityCols} dataSource={quality?.rows ?? []} pagination={false} scroll={{ x: 800 }} />
        </Card>

        {trendChannel && (
          <Card bordered={false} size="small" style={{ marginTop: 16 }} title={`渠道趋势：${trendChannel}`}
            extra={<a onClick={() => { setTrendChannel(null); setTrend(null) }}>收起</a>}>
            {trend
              ? <LineChart dates={trend.dates} series={[
                  { name: '注册', data: trend.reg },
                  { name: '首存', data: trend.fd },
                  { name: '充值额(₱)', data: trend.dep, dashed: true },
                  { name: '客均(₱)', data: trend.arpu, dashed: true },
                ]} height={300} />
              : <Spin />}
          </Card>
        )}
      </Spin>
    </div>
  )
}
