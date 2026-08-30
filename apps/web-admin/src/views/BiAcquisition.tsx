import { useEffect, useState } from 'react'
import { Card, Col, Row, Segmented, Space, Spin, Table, Tooltip } from 'antd'
import { getBiAcquisition, type BiAcquisitionRow } from '../api'
import { LineChart } from '../components/BiCharts'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()

export default function BiAcquisition() {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Awaited<ReturnType<typeof getBiAcquisition>> | null>(null)

  useEffect(() => {
    setLoading(true)
    getBiAcquisition(days).then(setData).finally(() => setLoading(false))
  }, [days])

  const columns = [
    { title: '渠道(注册入口)', dataIndex: 'source', fixed: 'left' as const },
    { title: '新增注册', dataIndex: 'newUsers', sorter: (a: BiAcquisitionRow, b: BiAcquisitionRow) => a.newUsers - b.newUsers },
    { title: '首充人数', dataIndex: 'firstDepUsers' },
    { title: '首充转化率', dataIndex: 'conversion',
      render: (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`) },
    { title: <Tooltip title="期间该来源用户领取的彩金总额（折算USDT），含老用户">彩金成本（USDT等值）</Tooltip>,
      dataIndex: 'bonusCost', render: fmtMoney },
    { title: <Tooltip title="期间该来源用户贡献的 NGR（投注-派彩-彩金，折算USDT），含老用户">NGR（USDT等值）</Tooltip>,
      dataIndex: 'ngr', render: (v: number) => <span style={{ color: v >= 0 ? undefined : '#cf1322' }}>{fmtMoney(v)}</span>,
      sorter: (a: BiAcquisitionRow, b: BiAcquisitionRow) => a.ngr - b.ngr },
    { title: <Tooltip title="NGR÷彩金成本,大于1=活动投入已回本">产出比</Tooltip>, key: 'roi',
      render: (_: unknown, r: BiAcquisitionRow) =>
        r.bonusCost > 0 ? <span style={{ color: r.ngr / r.bonusCost >= 1 ? '#3f8600' : '#cf1322' }}>{(r.ngr / r.bonusCost).toFixed(2)}</span> : '—' },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>渠道拉新</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        渠道=入口域名或 tma。新增/首充按注册域名终身归因；DAU 按当日登录域名归因——推广新域名后看这里量有没有起来。
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Segmented value={days} onChange={(v) => setDays(v as number)}
          options={[{ label: '近7天', value: 7 }, { label: '近30天', value: 30 }, { label: '近90天', value: 90 }]} />
      </Space>

      <Spin spinning={loading}>
        <Row gutter={16}>
          <Col xs={24}>
            <Card bordered={false} title="各渠道 DAU 趋势" size="small" style={{ marginBottom: 16 }}>
              <LineChart dates={data?.dauTrend.dates ?? []} series={(data?.dauTrend.series ?? []).map((s) => ({ name: s.name, data: s.data }))} height={280} />
            </Card>
          </Col>
          <Col xs={24}>
            <Card bordered={false} title="渠道对比" size="small">
              <Table
                size="small"
                rowKey="source"
                columns={columns}
                dataSource={data?.sources ?? []}
                pagination={false}
                scroll={{ x: 800 }}
              />
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  )
}
