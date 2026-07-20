import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Modal, Row, Segmented, Space, Spin, Table, Tag, message } from 'antd'
import {
  getBiAlerts, getBiChannels, sendBiReport, setBiAlertStatus,
  type BiAlertRow, type BiChannelRow,
} from '../api'
import { LineChart } from '../components/BiCharts'

const fmtSecs = (v: number | null) => {
  if (v == null) return '—'
  if (v < 60) return `${v} 秒`
  if (v < 3600) return `${Math.round(v / 60)} 分钟`
  return `${(v / 3600).toFixed(1)} 小时`
}

export default function BiChannels() {
  const isSuperAdmin = localStorage.getItem('admin_role') === 'super_admin'
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Awaited<ReturnType<typeof getBiChannels>> | null>(null)
  const [alerts, setAlerts] = useState<BiAlertRow[]>([])
  const [sending, setSending] = useState(false)

  const loadAlerts = () =>
    getBiAlerts('open').then((a) => setAlerts(a.filter((x) => x.alertType === 'channel_success'))).catch(() => {})

  useEffect(() => { loadAlerts() }, [])
  useEffect(() => {
    setLoading(true)
    getBiChannels(days).then(setData).finally(() => setLoading(false))
  }, [days])

  const handleAlert = async (id: number, status: 'ack' | 'closed') => {
    await setBiAlertStatus(id, status)
    loadAlerts()
  }

  const triggerReport = async () => {
    setSending(true)
    try {
      const r = await sendBiReport()
      if (r.sent) message.success('日报已发送到运营 TG 群')
      else Modal.info({ title: '未配置 TG 群，日报内容如下', content: <pre style={{ whiteSpace: 'pre-wrap' }}>{r.text}</pre>, width: 560 })
    } finally {
      setSending(false)
    }
  }

  const columns = [
    { title: '方向', dataIndex: 'direction', width: 80,
      render: (v: string) => <Tag color={v === 'deposit' ? 'green' : 'blue'}>{v === 'deposit' ? '充值' : '提现'}</Tag> },
    { title: '通道', dataIndex: 'channel' },
    { title: '终态订单', dataIndex: 'total' },
    { title: '成功', dataIndex: 'success' },
    { title: '成功率', dataIndex: 'rate',
      render: (v: number) => <span style={{ color: v >= 0.8 ? '#3f8600' : '#cf1322' }}>{(v * 100).toFixed(1)}%</span>,
      sorter: (a: BiChannelRow, b: BiChannelRow) => a.rate - b.rate },
    { title: '平均处理时长', dataIndex: 'avgSecs', render: fmtSecs },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>支付通道监控</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        只统计终态订单（充值 paid/failed/rejected；提现 completed/failed/rejected）。单日 ≥10 单且成功率 &lt;80% 自动告警。
      </div>

      {alerts.map((a) => (
        <Alert key={a.id} type={a.severity === 'critical' ? 'error' : 'warning'} showIcon style={{ marginBottom: 8 }}
          message={`${a.statDate} 通道 ${a.dimension} 成功率 ${(a.value * 100).toFixed(1)}%（阈值 80%）`}
          action={
            <Space>
              <Button size="small" onClick={() => handleAlert(a.id, 'ack')}>处理中</Button>
              <Button size="small" danger onClick={() => handleAlert(a.id, 'closed')}>关闭</Button>
            </Space>
          } />
      ))}

      <Space style={{ margin: '8px 0 16px' }} wrap>
        <Segmented value={days} onChange={(v) => setDays(v as number)}
          options={[{ label: '近7天', value: 7 }, { label: '近30天', value: 30 }, { label: '近90天', value: 90 }]} />
        {isSuperAdmin && <Button loading={sending} onClick={triggerReport}>手动发送今日运营日报</Button>}
      </Space>

      <Spin spinning={loading}>
        <Row gutter={16}>
          <Col xs={24}>
            <Card bordered={false} title="Top 通道每日成功率 (%)" size="small" style={{ marginBottom: 16 }}>
              <LineChart dates={data?.trend.dates ?? []} series={data?.trend.series ?? []} height={260} />
            </Card>
          </Col>
          <Col xs={24}>
            <Card bordered={false} title="通道对比" size="small">
              <Table size="small" rowKey={(r) => `${r.direction}:${r.channel}`} columns={columns}
                dataSource={data?.channels ?? []} pagination={false} scroll={{ x: 700 }} />
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  )
}
