import { useEffect, useState } from 'react'
import { Alert, Button, Card, DatePicker, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import { getPlatformOverview, refreshPlatformOverview, type OverviewTenant, type OverviewTrend } from '../api'
import { useAuthStore } from '../stores/auth'
import { STATUS } from './tenant/context'

const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * 平台总览（P2-11）。
 *
 * 数据来自 pf_bi_daily（各租户库抽数汇总），不实时跨库查 —— 租户数上去以后
 * 一次总览会同时压所有租户库，任何一个慢就整页转圈。
 * 代价是最多半小时的延迟，总览页可以接受；要看实时数字去租户自己的后台。
 */
export default function Overview() {
  const role = useAuthStore((s) => s.role)
  const canWrite = role === 'platform_super' || role === 'platform_finance'
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(6, 'day'), dayjs()])
  const [tenants, setTenants] = useState<OverviewTenant[]>([])
  const [trend, setTrend] = useState<OverviewTrend[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await getPlatformOverview(range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'))
      setTenants(res.tenants)
      setTrend(res.trend)
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [range])

  async function refresh() {
    setRefreshing(true)
    try {
      await refreshPlatformOverview()
      await load()
      message.success('已重新抽数')
    } catch (e) { message.error((e as Error).message) }
    finally { setRefreshing(false) }
  }

  const total = tenants.reduce((a, t) => ({
    deposit: a.deposit + t.depositUsdt,
    withdraw: a.withdraw + t.withdrawUsdt,
    turnover: a.turnover + t.turnoverUsdt,
    ggr: a.ggr + t.ggrUsdt,
    net: a.net + t.netGgrUsdt,
    dau: a.dau + t.dau,
  }), { deposit: 0, withdraw: 0, turnover: 0, ggr: 0, net: 0, dau: 0 })
  const skipped = tenants.reduce((a, t) => a + t.skippedRows, 0)
  const live = tenants.filter((t) => t.depositUsdt > 0 || t.turnoverUsdt > 0).length

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="平台总览" loading={loading}
        extra={<Space>
          <DatePicker.RangePicker size="small" value={range} allowClear={false}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
          {canWrite && <Button size="small" loading={refreshing} onClick={refresh}>立即抽数</Button>}
        </Space>}>
        {skipped > 0 && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }}
            message={`有 ${skipped} 行因缺当日汇率未折算进总额`}
            description="总额会偏小。缺汇率的币种在租户后台的汇率快照里补齐后重新抽数即可。" />
        )}
        <Space size={40} wrap>
          <Statistic title="充值（USDT）" value={money(total.deposit)} />
          <Statistic title="提现（USDT）" value={money(total.withdraw)} />
          <Statistic title="有效投注" value={money(total.turnover)} />
          <Statistic title="GGR" value={money(total.ggr)}
            valueStyle={total.ggr < 0 ? { color: '#cf1322' } : { color: '#3f8600' }} />
          <Statistic title="净收益（扣活动与佣金）" value={money(total.net)}
            valueStyle={total.net < 0 ? { color: '#cf1322' } : undefined} />
          <Statistic title="有流水的站" value={`${live} / ${tenants.length}`} />
        </Space>
      </Card>

      <Card title="各租户" size="small" loading={loading}>
        <Table rowKey="tenantId" size="small" pagination={false} dataSource={tenants}
          columns={[
            { title: '租户', dataIndex: 'code', width: 130, fixed: 'left',
              render: (v: string, r) => <Link to={`/tenants/${r.tenantId}/overview`}>{v}</Link> },
            { title: '状态', dataIndex: 'status', width: 90,
              render: (s: string) => <Tag color={STATUS[s]?.color}>{STATUS[s]?.text ?? s}</Tag> },
            { title: '分成方案', dataIndex: 'planName', width: 110,
              render: (v: string | null) => v ?? <Tag>未签约</Tag> },
            { title: '充值', dataIndex: 'depositUsdt', align: 'right', width: 120, render: money,
              sorter: (a, b) => a.depositUsdt - b.depositUsdt },
            { title: '提现', dataIndex: 'withdrawUsdt', align: 'right', width: 120, render: money },
            { title: '有效投注', dataIndex: 'turnoverUsdt', align: 'right', width: 130, render: money },
            { title: 'GGR', dataIndex: 'ggrUsdt', align: 'right', width: 120,
              sorter: (a, b) => a.ggrUsdt - b.ggrUsdt,
              render: (v: number) => v < 0 ? <Typography.Text type="danger">{money(v)}</Typography.Text> : money(v) },
            { title: '活动成本', dataIndex: 'bonusUsdt', align: 'right', width: 110, render: money },
            { title: '佣金', dataIndex: 'commissionUsdt', align: 'right', width: 110, render: money },
            { title: '净收益', dataIndex: 'netGgrUsdt', align: 'right', width: 120,
              sorter: (a, b) => a.netGgrUsdt - b.netGgrUsdt,
              render: (v: number) => <Typography.Text strong type={v < 0 ? 'danger' : undefined}>{money(v)}</Typography.Text> },
            { title: '充值人数', dataIndex: 'depositUsers', align: 'right', width: 100 },
            { title: '首充', dataIndex: 'firstDepUsers', align: 'right', width: 80 },
            { title: '新增', dataIndex: 'newUsers', align: 'right', width: 80 },
            { title: '峰值 DAU', dataIndex: 'dau', align: 'right', width: 100 },
          ]}
          scroll={{ x: 1500 }} />
      </Card>

      <Card title="全平台日趋势" size="small" loading={loading}>
        <Table rowKey="statDate" size="small" pagination={{ pageSize: 10, size: 'small' }} dataSource={trend}
          locale={{ emptyText: '还没有抽数结果 —— 每 30 分钟自动刷新当天，也可手工立即抽数' }}
          columns={[
            { title: '日期', dataIndex: 'statDate', width: 120 },
            { title: '充值', dataIndex: 'depositUsdt', align: 'right', render: money },
            { title: '有效投注', dataIndex: 'turnoverUsdt', align: 'right', render: money },
            { title: 'GGR', dataIndex: 'ggrUsdt', align: 'right',
              render: (v: number) => v < 0 ? <Typography.Text type="danger">{money(v)}</Typography.Text> : money(v) },
            { title: 'DAU 合计', dataIndex: 'dau', align: 'right', width: 110 },
            { title: '有数据的站', dataIndex: 'tenants', align: 'right', width: 110 },
          ]} />
      </Card>
    </Space>
  )
}
