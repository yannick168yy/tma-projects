import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Row, Segmented, Select, Space, Spin, Table, Tag, message } from 'antd'
import {
  getBiAlerts, getBiProviders, setBiAlertStatus,
  type BiAlertRow, type BiProviderRow,
} from '../api'
import { LineChart, PieChart } from '../components/BiCharts'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()
const fmtRtp = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

export default function BiProviders() {
  const [days, setDays] = useState(30)
  const [currency, setCurrency] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Awaited<ReturnType<typeof getBiProviders>> | null>(null)
  const [alerts, setAlerts] = useState<BiAlertRow[]>([])

  const loadAlerts = () => getBiAlerts('open').then(setAlerts).catch(() => {})

  useEffect(() => { loadAlerts() }, [])
  useEffect(() => {
    setLoading(true)
    getBiProviders({ days, currency }).then(setData).finally(() => setLoading(false))
  }, [days, currency])

  const handleAlert = async (id: number, status: 'ack' | 'closed') => {
    await setBiAlertStatus(id, status)
    message.success(status === 'ack' ? '已标记处理中' : '已关闭')
    loadAlerts()
  }

  const unit = data?.currency === 'PHP' ? '₱' : data?.currency ?? ''
  const pieData = (data?.providers ?? []).slice(0, 7).map((p) => ({ name: p.provider, value: p.betAmount }))
  const rest = (data?.providers ?? []).slice(7).reduce((a, p) => a + p.betAmount, 0)
  if (rest > 0) pieData.push({ name: '其他', value: rest })

  const columns = [
    { title: '厂商', dataIndex: 'provider', fixed: 'left' as const },
    { title: `投注额(${unit})`, dataIndex: 'betAmount', render: fmtMoney, sorter: (a: BiProviderRow, b: BiProviderRow) => a.betAmount - b.betAmount },
    { title: `GGR(${unit})`, dataIndex: 'ggr', render: (v: number) => (
        <span style={{ color: v >= 0 ? undefined : '#cf1322' }}>{fmtMoney(v)}</span>
      ), sorter: (a: BiProviderRow, b: BiProviderRow) => a.ggr - b.ggr },
    { title: '实际RTP', dataIndex: 'rtp', render: fmtRtp, sorter: (a: BiProviderRow, b: BiProviderRow) => (a.rtp ?? 0) - (b.rtp ?? 0) },
    { title: '注单数', dataIndex: 'betCount', sorter: (a: BiProviderRow, b: BiProviderRow) => a.betCount - b.betCount },
    { title: '投注人次(日累计)', dataIndex: 'userDays' },
    { title: '流水占比', dataIndex: 'share', render: (v: number) => `${(v * 100).toFixed(1)}%` },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>游戏商分析</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        厂商=游戏开发商层面（JILI、PG Soft 等）。RTP=派彩÷投注；每日凌晨检测厂商 RTP 偏离自身 28 天基线的异常。
      </div>

      {alerts.map((a) => (
        <Alert
          key={a.id}
          type={a.severity === 'critical' ? 'error' : 'warning'}
          showIcon style={{ marginBottom: 8 }}
          message={
            <Space wrap>
              <b>{a.statDate}</b>
              <span>{a.dimension}（{a.currency}）RTP {fmtRtp(a.value)}，28天基线 {fmtRtp(a.baseline)}，偏离 z={a.deviation}</span>
              <Tag color={a.severity === 'critical' ? 'red' : 'orange'}>{a.severity}</Tag>
            </Space>
          }
          action={
            <Space>
              <Button size="small" onClick={() => handleAlert(a.id, 'ack')}>处理中</Button>
              <Button size="small" danger onClick={() => handleAlert(a.id, 'closed')}>关闭</Button>
            </Space>
          }
        />
      ))}

      <Space style={{ margin: '8px 0 16px' }} wrap>
        <Segmented value={days} onChange={(v) => setDays(v as number)}
          options={[{ label: '近7天', value: 7 }, { label: '近30天', value: 30 }, { label: '近90天', value: 90 }]} />
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
          <Col xs={24} lg={10}>
            <Card bordered={false} title="流水集中度" size="small" style={{ marginBottom: 16 }}>
              <PieChart data={pieData} valueLabel={` ${unit}`} />
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card bordered={false} title={`Top 厂商 GGR 趋势 (${unit})`} size="small" style={{ marginBottom: 16 }}>
              <LineChart
                dates={data?.trend.dates ?? []}
                series={(data?.trend.series ?? []).map((s) => ({ name: s.name, data: s.ggr }))}
              />
            </Card>
          </Col>
        </Row>

        <Card bordered={false} title="厂商对比" size="small">
          <Table
            size="small"
            rowKey="provider"
            columns={columns}
            dataSource={data?.providers ?? []}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 800 }}
          />
        </Card>
      </Spin>
    </div>
  )
}
