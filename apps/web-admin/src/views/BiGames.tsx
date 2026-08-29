import { useEffect, useState } from 'react'
import { Card, Col, Row, Segmented, Select, Space, Spin, Table, Tag } from 'antd'
import { getBiGames, type BiGameRow } from '../api'
import { HBarChart, PieChart } from '../components/BiCharts'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()
const fmtRtp = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

const CATEGORY_LABEL: Record<string, string> = {
  slot: '老虎机', casino: '真人', fishing: '捕鱼', poker: '棋牌',
  lottery: '彩票', sports: '体育', perya: 'Perya', lobby: '大厅', other: '其他',
}

export default function BiGames() {
  const [days, setDays] = useState(30)
  const [currency, setCurrency] = useState('ALL')
  const [category, setCategory] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Awaited<ReturnType<typeof getBiGames>> | null>(null)

  useEffect(() => {
    setLoading(true)
    getBiGames({ days, currency, limit: 200 }).then(setData).finally(() => setLoading(false))
  }, [days, currency])

  const unit = data?.currency ?? ''
  const games = (data?.games ?? []).filter((g) => category === 'ALL' || g.category === category)
  const catData = (data?.categories ?? []).map((c) => ({ name: CATEGORY_LABEL[c.category] ?? c.category, value: c.betAmount }))
  const topGgr = [...(data?.games ?? [])].sort((a, b) => b.ggr - a.ggr).slice(0, 10)
    .map((g) => ({ name: g.name || `#${g.gpid}:${g.gameId}`, value: g.ggr }))

  const columns = [
    { title: '游戏', dataIndex: 'name', fixed: 'left' as const, width: 200,
      render: (v: string, r: BiGameRow) => v || `#${r.gpid}:${r.gameId}` },
    { title: '厂商', dataIndex: 'provider', width: 130 },
    { title: '品类', dataIndex: 'category', width: 90, render: (v: string) => <Tag>{CATEGORY_LABEL[v] ?? v}</Tag> },
    { title: `投注额(${unit})`, dataIndex: 'betAmount', render: fmtMoney, sorter: (a: BiGameRow, b: BiGameRow) => a.betAmount - b.betAmount, defaultSortOrder: 'descend' as const },
    { title: `GGR(${unit})`, dataIndex: 'ggr', sorter: (a: BiGameRow, b: BiGameRow) => a.ggr - b.ggr,
      render: (v: number) => <span style={{ color: v >= 0 ? undefined : '#cf1322' }}>{fmtMoney(v)}</span> },
    { title: '实际RTP', dataIndex: 'rtp', render: fmtRtp },
    { title: '理论RTP', dataIndex: 'theoreticalRtp', render: fmtRtp },
    { title: '注单数', dataIndex: 'betCount', sorter: (a: BiGameRow, b: BiGameRow) => a.betCount - b.betCount },
    { title: '人次(日累计)', dataIndex: 'userDays' },
    { title: '启动次数(累计)', dataIndex: 'launchCount' },
    { title: '启动人数(累计)', dataIndex: 'launchUsers' },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>游戏分析</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        Top 200 游戏（按投注额）。启动次数为全量累计口径，可与区间投注数据对照看「点击多但不下注」的游戏。
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented value={days} onChange={(v) => setDays(v as number)}
          options={[{ label: '近7天', value: 7 }, { label: '近30天', value: 30 }, { label: '近90天', value: 90 }]} />
        <Select value={currency} onChange={setCurrency} style={{ width: 140 }}
          options={[
            { label: '全部折算 PHP', value: 'ALL' },
            { label: 'PHP', value: 'PHP' },
            { label: 'IDR', value: 'IDR' },
            { label: 'USDT', value: 'USDT' },
            { label: 'USDC', value: 'USDC' },
          ]} />
        <Select value={category} onChange={setCategory} style={{ width: 120 }}
          options={[{ label: '全部品类', value: 'ALL' },
            ...Object.entries(CATEGORY_LABEL).map(([v, label]) => ({ label, value: v }))]} />
      </Space>

      <Spin spinning={loading}>
        <Row gutter={16}>
          <Col xs={24} lg={10}>
            <Card bordered={false} title="品类流水占比" size="small" style={{ marginBottom: 16 }}>
              <PieChart data={catData} valueLabel={` ${unit}`} />
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card bordered={false} title={`Top 10 游戏 GGR (${unit})`} size="small" style={{ marginBottom: 16 }}>
              <HBarChart data={topGgr} valueLabel={` ${unit}`} />
            </Card>
          </Col>
        </Row>

        <Card bordered={false} title="游戏明细" size="small">
          <Table
            size="small"
            rowKey={(r) => `${r.gpid}:${r.gameId}`}
            columns={columns}
            dataSource={games}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 1200 }}
          />
        </Card>
      </Spin>
    </div>
  )
}
