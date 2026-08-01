import { useCallback, useEffect, useState } from 'react'
import { Card, Row, Col, Segmented, DatePicker, Statistic, Table, Tag, Typography, Space, Alert, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getGrowthOverview, getGrowthParticipation, getGrowthCost,
  type GrowthLevelRow, type GrowthNativeTaskRow, type GrowthSocialTaskRow, type GrowthCheckinPoint, type GrowthCostRow,
} from '../api'
import { LineChart, HBarChart, BI_COLORS } from '../components/BiCharts'

const CCY_OPTIONS = ['PHP', 'USDT', 'USDC']
const COST_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  task_bonus: { label: '任务奖励', color: 'blue' },
  vip_bonus: { label: 'VIP 礼金', color: 'gold' },
  rebate: { label: '洗码返水', color: 'green' },
}

// 任务/成长总览：等级分布 + 任务参与 + 签到大盘 + 奖励成本拆分
export default function GrowthOverview() {
  const [currency, setCurrency] = useState('PHP')
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, 'day'), dayjs()])
  const [overview, setOverview] = useState<{ levels: GrowthLevelRow[]; totalUsers: number; stateUsers: number } | null>(null)
  const [part, setPart] = useState<{
    native: GrowthNativeTaskRow[]
    social: GrowthSocialTaskRow[]
    checkin: { series: GrowthCheckinPoint[]; milestones: { days: number; count: number }[] }
    manualPending: number
  } | null>(null)
  const [cost, setCost] = useState<GrowthCostRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const from = range[0].format('YYYY-MM-DD')
    const to = range[1].format('YYYY-MM-DD')
    try {
      const [o, p, c] = await Promise.all([
        getGrowthOverview({ currency }),
        getGrowthParticipation({ from, to, currency }),
        getGrowthCost({ from, to }),
      ])
      setOverview(o); setPart(p); setCost(c.items)
    } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }, [currency, range])

  useEffect(() => { void load() }, [load])

  const totalTaskGrowth = overview?.levels.reduce((s, r) => s + r.taskGrowth, 0) ?? 0
  const totalDemoted = overview?.levels.reduce((s, r) => s + r.demoted, 0) ?? 0

  const nativeCols = [
    { title: '任务', dataIndex: 'title', key: 'title', width: 170, ellipsis: true },
    { title: '领取次数', dataIndex: 'claims', key: 'claims', width: 90, align: 'right' as const },
    { title: '领取人数', dataIndex: 'users', key: 'users', width: 90, align: 'right' as const },
    {
      title: '现金成本', dataIndex: 'cash', key: 'cash', width: 110, align: 'right' as const,
      render: (v: number) => v > 0 ? `${v.toLocaleString()} ${currency}` : '—',
    },
    { title: '转盘次数', dataIndex: 'spin', key: 'spin', width: 90, align: 'right' as const, render: (v: number) => v > 0 ? `+${v}` : '—' },
    { title: '成长值', dataIndex: 'growth', key: 'growth', width: 90, align: 'right' as const, render: (v: number) => v > 0 ? `+${v.toLocaleString()}` : '—' },
  ]
  const socialCols = [
    { title: '任务', dataIndex: 'title', key: 'title', width: 170, ellipsis: true },
    { title: '领取人数', dataIndex: 'claims', key: 'claims', width: 90, align: 'right' as const },
    {
      title: '单次奖励（当前配置）', key: 'reward', width: 160,
      render: (_: unknown, r: GrowthSocialTaskRow) =>
        r.rewardType === 'spin' ? `转盘 ×${r.rewardSpin}` : r.rewardType ? `${r.rewardAmount} ${r.currency}` : '—',
    },
    {
      title: '估算成本', key: 'est', width: 120, align: 'right' as const,
      render: (_: unknown, r: GrowthSocialTaskRow) =>
        r.rewardType === 'cash' ? `${(r.claims * r.rewardAmount).toLocaleString()} ${r.currency}` : '—',
    },
  ]
  const costCols = [
    {
      title: '类别', dataIndex: 'type', key: 'type', width: 110,
      render: (v: string) => { const t = COST_TYPE_LABELS[v]; return <Tag color={t?.color}>{t?.label ?? v}</Tag> },
    },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 90 },
    { title: '发放金额', dataIndex: 'amount', key: 'amount', width: 130, align: 'right' as const, render: (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 }) },
    { title: '触达人数', dataIndex: 'users', key: 'users', width: 100, align: 'right' as const },
    { title: '发放笔数', dataIndex: 'entries', key: 'entries', width: 100, align: 'right' as const },
  ]

  const series = part?.checkin.series ?? []
  return (
    <div>
      <Card bordered={false} style={{ marginBottom: 16 }} loading={loading && !overview}>
        <Space wrap size="middle">
          <Segmented options={CCY_OPTIONS} value={currency} onChange={(v) => setCurrency(String(v))} />
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs())}
            onChange={(v) => { if (v?.[0] && v[1]) setRange([v[0], v[1]]) }}
          />
          <Typography.Text type="secondary">等级分布为当前实时快照；任务/签到/成本按所选日期范围统计（最长 92 天）</Typography.Text>
        </Space>
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card title={`等级分布（${currency}）`} bordered={false} style={{ marginBottom: 16 }} loading={loading && !overview}>
            {overview && (
              <>
                <Row gutter={16} style={{ marginBottom: 12 }}>
                  <Col span={6}><Statistic title="注册用户" value={overview.totalUsers} /></Col>
                  <Col span={6}><Statistic title="入成长体系" value={overview.stateUsers} /></Col>
                  <Col span={6}><Statistic title="已降级" value={totalDemoted} valueStyle={totalDemoted > 0 ? { color: '#cf1322' } : undefined} /></Col>
                  <Col span={6}><Statistic title="任务成长值累计" value={totalTaskGrowth} precision={0} /></Col>
                </Row>
                <HBarChart
                  data={overview.levels.map((r) => ({ name: `LV${r.level}`, value: r.users }))}
                  height={Math.max(160, overview.levels.length * 36)}
                  valueLabel=" 人"
                />
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="每日签到" bordered={false} style={{ marginBottom: 16 }} loading={loading && !part}>
            {part && (
              <>
                <LineChart
                  dates={series.map((s) => s.date.slice(5))}
                  series={[
                    { name: '签到人数', color: BI_COLORS.blue, data: series.map((s) => s.users) },
                    { name: '增强轨（有存款/投注）', color: BI_COLORS.orange, data: series.map((s) => s.enhanced) },
                  ]}
                  height={240}
                />
                <Space wrap style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary">
                    转盘发放 {series.reduce((s, r) => s + r.chances, 0)} 次
                  </Typography.Text>
                  {part.checkin.milestones.map((m) => (
                    <Tag key={m.days} color="magenta">{m.days}天里程碑 ×{m.count}</Tag>
                  ))}
                </Space>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Card title={`任务参与（${currency}）`} bordered={false} style={{ marginBottom: 16 }} loading={loading && !part}>
        {part && (
          <>
            {part.manualPending > 0 && (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message={`有 ${part.manualPending} 条社群任务截图待人工审核（会员运营 → 任务中心 → 社群 Tab 处理）`} />
            )}
            <Row gutter={16}>
              <Col xs={24} xl={14}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>原生任务</Typography.Title>
                <Table columns={nativeCols} dataSource={part.native} rowKey="taskId" pagination={false} size="small" scroll={{ x: 'max-content' }} />
              </Col>
              <Col xs={24} xl={10}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>社群任务（全币种）</Typography.Title>
                <Table columns={socialCols} dataSource={part.social} rowKey="taskKey" pagination={false} size="small" scroll={{ x: 'max-content' }} />
              </Col>
            </Row>
          </>
        )}
      </Card>

      <Card title="奖励成本拆分（全币种）" bordered={false} style={{ marginBottom: 16 }} loading={loading && !cost.length}>
        <Table columns={costCols} dataSource={cost} rowKey={(r) => `${r.type}_${r.currency}`} pagination={false} size="small" scroll={{ x: 'max-content' }} />
      </Card>
    </div>
  )
}
