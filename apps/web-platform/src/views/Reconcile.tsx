import { useEffect, useState } from 'react'
import { Alert, Card, DatePicker, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import { getReconcile, type ReconcileRow } from '../api'

const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * 混用模式对账（P2-9）。
 *
 * 同一租户同时用平台代收和自带通道时，账单要按模式分别套费率（平台代收抽水高、
 * 自带通道低）。拆错一边就是直接的钱的差异，所以这一页把两种模式并排列出来。
 *
 * 数字取自已锁定的计费快照 —— 对账要对的就是「出账用的那份数」。
 */
export default function Reconcile() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(30, 'day'), dayjs().subtract(1, 'day')])
  const [rows, setRows] = useState<ReconcileRow[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await getReconcile(range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'))
      setRows(res.rows)
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [range])

  const mixed = rows.filter((r) => r.mixed)

  return (
    <Card title="资金模式对账" loading={loading}
      extra={<DatePicker.RangePicker size="small" value={range} allowClear={false}
        onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="platform = 平台统一代收代付（钱进平台账户，平台收手续费并承担资金压力）；tenant = 租户自带通道（钱直接进客户账户，平台只按回调流水计费）"
        description={mixed.length > 0
          ? `其中 ${mixed.length} 行是混用：同期两种模式都有流水，账单必须按模式分别套费率`
          : '当前没有混用的租户'} />

      <Table rowKey={(r) => `${r.tenantId}:${r.currency}`} size="small" dataSource={rows}
        pagination={false}
        locale={{ emptyText: '所选区间没有计费快照' }}
        expandable={{
          expandedRowRender: (r) => (
            <Table rowKey={(c) => `${c.channel}:${c.owner}`} size="small" pagination={false} dataSource={r.channels}
              columns={[
                { title: '通道', dataIndex: 'channel', width: 160 },
                { title: '归属', dataIndex: 'owner', width: 120,
                  render: (v: string) => v === 'platform'
                    ? <Tag color="gold">平台代收</Tag>
                    : <Tag color="blue">租户自带</Tag> },
                { title: '笔数', dataIndex: 'count', width: 90, align: 'right' },
                { title: `充值（${r.currency}）`, dataIndex: 'amount', align: 'right', render: money },
                { title: '手续费', dataIndex: 'fee', align: 'right', render: money },
              ]} />
          ),
          rowExpandable: (r) => r.channels.length > 0,
        }}
        columns={[
          { title: '租户', dataIndex: 'code', width: 130,
            render: (v: string, r) => <Link to={`/tenants/${r.tenantId}/billing`}>{v}</Link> },
          { title: '币种', dataIndex: 'currency', width: 80 },
          { title: '模式', width: 100, render: (_, r) => r.mixed
            ? <Tag color="purple">混用</Tag>
            : r.depositPlatform > 0 || r.withdrawPlatform > 0
              ? <Tag color="gold">平台代收</Tag>
              : <Tag color="blue">租户自带</Tag> },
          { title: '充值·平台代收', dataIndex: 'depositPlatform', align: 'right', width: 140, render: money },
          { title: '充值·自带通道', dataIndex: 'depositTenant', align: 'right', width: 140, render: money },
          { title: '提现·平台代付', dataIndex: 'withdrawPlatform', align: 'right', width: 140, render: money },
          { title: '提现·自行放款', dataIndex: 'withdrawTenant', align: 'right', width: 140, render: money },
          { title: '通道手续费', dataIndex: 'channelFee', align: 'right', width: 120,
            render: (v: number) => v > 0 ? money(v) : <Typography.Text type="secondary">-</Typography.Text> },
          { title: '折 USDT 汇率', dataIndex: 'fxRateUsdt', align: 'right', width: 120,
            render: (v: number) => v > 0 ? v.toFixed(6) : <Tag color="red">缺</Tag> },
        ]} />
    </Card>
  )
}
