import { useCallback, useEffect, useState } from 'react'
import { Button, Card, DatePicker, Input, Space, Spin, Table, Tag, Tooltip } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { getAdSources, getAdSourceTrend, type AdSourceRow, type AdSourceReport } from '../api'
import { LineChart } from '../components/BiCharts'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()
const ARPU_TARGET = 1200 // 条款客均门槛 ₱1200

// 马尼拉今天（展示层用本地 dayjs 即可，服务端按 UTC+8 切日）
const manilaToday = () => dayjs()

export default function BiAdSources() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([manilaToday().subtract(6, 'day'), manilaToday()])
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AdSourceReport | null>(null)
  const [trendChannel, setTrendChannel] = useState<string | null>(null)
  const [trend, setTrend] = useState<{ dates: string[]; reg: number[]; fd: number[]; arpu: (number | null)[] } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    getAdSources({
      from: range[0].format('YYYY-MM-DD'),
      to: range[1].format('YYYY-MM-DD'),
      currency: 'PHP',
      channel: channel.trim() || undefined,
    }).then(setData).finally(() => setLoading(false))
  }, [range, channel])

  useEffect(() => { load() }, [load])

  const openTrend = (code: string) => {
    setTrendChannel(code)
    setTrend(null)
    getAdSourceTrend({
      channel: code,
      from: range[0].format('YYYY-MM-DD'),
      to: range[1].format('YYYY-MM-DD'),
      currency: 'PHP',
    }).then((r) => {
      setTrend({
        dates: r.points.map((p) => p.date.slice(5)),
        reg: r.points.map((p) => p.regUsers),
        fd: r.points.map((p) => p.firstDepUsers),
        arpu: r.points.map((p) => (p.arpu == null ? null : Math.round(p.arpu))),
      })
    })
  }

  const arpuCell = (v: number | null) => {
    if (v == null) return <span style={{ color: '#bbb' }}>—</span>
    const ok = v >= ARPU_TARGET
    return <span style={{ color: ok ? '#3f8600' : '#cf1322', fontWeight: 500 }}>{fmtMoney(v)}</span>
  }

  const columns = [
    {
      title: '渠道标识', dataIndex: 'channelCode', fixed: 'left' as const,
      render: (v: string) => <a onClick={() => openTrend(v)}>{v}</a>,
    },
    { title: '注册数', dataIndex: 'regUsers', sorter: (a: AdSourceRow, b: AdSourceRow) => a.regUsers - b.regUsers },
    {
      title: <Tooltip title="平台历史首笔成功充值发生在所选区间内的人数">首存人数</Tooltip>,
      dataIndex: 'firstDepUsers',
      sorter: (a: AdSourceRow, b: AdSourceRow) => a.firstDepUsers - b.firstDepUsers,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: <Tooltip title="首存转化率 = 首存人数 ÷ 注册数">首存转化</Tooltip>, key: 'cvr',
      render: (_: unknown, r: AdSourceRow) => (r.regUsers > 0 ? `${((r.firstDepUsers / r.regUsers) * 100).toFixed(1)}%` : '—'),
    },
    { title: '首存金额(₱)', dataIndex: 'firstDepAmount', render: fmtMoney },
    { title: <Tooltip title="区间内该渠道用户的充值总额(含复充)">总充值(₱)</Tooltip>, dataIndex: 'depositAmount', render: fmtMoney },
    {
      title: <Tooltip title="客均 = 总充值 ÷ 首存人数；条款要求 ≥ ₱1200，达标绿色">客均(₱)</Tooltip>,
      dataIndex: 'arpu', render: arpuCell,
      sorter: (a: AdSourceRow, b: AdSourceRow) => (a.arpu ?? -1) - (b.arpu ?? -1),
    },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>投放渠道（买量）</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        渠道标识 = 投放链接里的 <code>?c=</code>（缺省时退回 utm_source）。数据实时查询，按马尼拉日（UTC+8）切日，
        币种口径 PHP。首存成本由投手用「广告花费 ÷ 首存人数」自算——我方只提供首存数。点渠道名看逐日趋势。
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <DatePicker.RangePicker
          value={range} format="YYYY-MM-DD" allowClear={false} style={{ width: 240 }}
          onChange={(v) => { if (v && v[0] && v[1]) setRange([v[0], v[1]]) }}
        />
        <Input
          placeholder="按渠道标识筛选（可空）" allowClear value={channel} style={{ width: 200 }}
          onChange={(e) => setChannel(e.target.value)} onPressEnter={load}
        />
        <Button type="primary" onClick={load}>查询</Button>
      </Space>

      <Spin spinning={loading}>
        {data && (
          <Space style={{ marginBottom: 12 }} wrap>
            <Tag color="blue">注册 {data.totals.regUsers}</Tag>
            <Tag color="geekblue">首存 {data.totals.firstDepUsers}</Tag>
            <Tag color="green">总充值 ₱{fmtMoney(data.totals.depositAmount)}</Tag>
            <Tag color={data.totals.arpu != null && data.totals.arpu >= ARPU_TARGET ? 'success' : 'error'}>
              整体客均 {data.totals.arpu == null ? '—' : `₱${fmtMoney(data.totals.arpu)}`}
            </Tag>
          </Space>
        )}

        <Card bordered={false} size="small">
          <Table
            size="small" rowKey="channelCode" columns={columns}
            dataSource={data?.rows ?? []} pagination={false} scroll={{ x: 760 }}
          />
        </Card>

        {trendChannel && (
          <Card
            bordered={false} size="small" style={{ marginTop: 16 }}
            title={`渠道趋势：${trendChannel}`}
            extra={<a onClick={() => { setTrendChannel(null); setTrend(null) }}>收起</a>}
          >
            {trend
              ? <LineChart
                  dates={trend.dates}
                  series={[
                    { name: '注册', data: trend.reg },
                    { name: '首存人数', data: trend.fd },
                    { name: '客均(₱)', data: trend.arpu, dashed: true },
                  ]}
                  height={300}
                />
              : <Spin />}
          </Card>
        )}
      </Spin>
    </div>
  )
}
