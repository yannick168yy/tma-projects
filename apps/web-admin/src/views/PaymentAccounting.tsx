import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, DatePicker, message, Statistic, Row, Col, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getPaymentAccounting, getProviderBalances, refreshProviderBalances,
  type PaymentAccountingRow, type ProviderBalanceRow,
} from '../api'

const { RangePicker } = DatePicker

function fmtMoney(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PaymentAccounting() {
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [rows, setRows] = useState<PaymentAccountingRow[]>([])
  const [total, setTotal] = useState<PaymentAccountingRow | null>(null)
  const [loading, setLoading] = useState(false)

  const [balances, setBalances] = useState<ProviderBalanceRow[]>([])
  const [balLoading, setBalLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function loadAccounting() {
    setLoading(true)
    try {
      const r = await getPaymentAccounting({
        from: range ? range[0].startOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined,
        to: range ? range[1].endOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined,
      })
      setRows(r.rows); setTotal(r.total)
    } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  async function loadBalances() {
    setBalLoading(true)
    try { setBalances(await getProviderBalances()) }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setBalLoading(false) }
  }

  async function handleRefreshBalances() {
    setRefreshing(true)
    try {
      setBalances(await refreshProviderBalances())
      message.success('余额已刷新')
    } catch (e) { message.error(e instanceof Error ? e.message : '刷新失败') }
    finally { setRefreshing(false) }
  }

  useEffect(() => { void loadAccounting() }, [range])
  useEffect(() => { void loadBalances() }, [])

  const columns: ColumnsType<PaymentAccountingRow> = [
    { title: '服务商', dataIndex: 'label', width: 140, render: (v: string) => <b>{v}</b> },
    { title: '代收金额', dataIndex: 'depositAmount', align: 'right', render: (v: number) => <span style={{ color: '#3f8600' }}>{fmtMoney(v)}</span> },
    { title: '代收笔数', dataIndex: 'depositCount', align: 'right', width: 90 },
    { title: '代付金额', dataIndex: 'withdrawAmount', align: 'right', render: (v: number) => <span style={{ color: '#cf1322' }}>{fmtMoney(v)}</span> },
    { title: '代付笔数', dataIndex: 'withdrawCount', align: 'right', width: 90 },
    { title: '净额（代收−代付）', dataIndex: 'netAmount', align: 'right', render: (v: number) => <b style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>{fmtMoney(v)}</b> },
  ]

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16 }}>
        <h2 style={{ margin: 0 }}>服务商余额</h2>
      </div>

      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title="服务商余额"
        extra={
          <Space>
            <span style={{ color: '#999', fontSize: 12 }}>每小时自动刷新</span>
            <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefreshBalances}>手动刷新</Button>
          </Space>
        }
        loading={balLoading}
      >
        <Row gutter={16}>
          {balances.map((b) => (
            <Col key={b.provider} xs={24} sm={12} md={8}>
              <Card size="small" style={{ marginBottom: 8 }}>
                <Statistic
                  title={
                    <Space>
                      <b>{b.label}</b>
                      {b.status === 'error'
                        ? <Tooltip title={b.errorMsg ?? '查询失败'}><Tag color="red">异常</Tag></Tooltip>
                        : <Tag color="green">正常</Tag>}
                    </Space>
                  }
                  value={b.status === 'ok' ? fmtMoney(b.balance) : '—'}
                  suffix={b.status === 'ok' ? b.currency : ''}
                />
                <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                  {b.frozen > 0 && <span>冻结 {fmtMoney(b.frozen)} · </span>}
                  更新于 {b.updatedAt ? dayjs(b.updatedAt).format('MM-DD HH:mm') : '从未'}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title="代收 / 代付记账"
        extra={
          <Space>
            <RangePicker
              value={range}
              onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
              presets={[
                { label: '今日', value: [dayjs(), dayjs()] },
                { label: '近7天', value: [dayjs().subtract(6, 'day'), dayjs()] },
                { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
              ]}
            />
            {range && <Button size="small" onClick={() => setRange(null)}>全部</Button>}
          </Space>
        }
      >
        <Table
          rowKey="provider"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={false}
          summary={() => total ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><b>{total.label}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right"><b style={{ color: '#3f8600' }}>{fmtMoney(total.depositAmount)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right"><b>{total.depositCount}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><b style={{ color: '#cf1322' }}>{fmtMoney(total.withdrawAmount)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><b>{total.withdrawCount}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right"><b style={{ color: total.netAmount >= 0 ? '#3f8600' : '#cf1322' }}>{fmtMoney(total.netAmount)}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null}
        />
        <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
          代收 = 充值成功（status=paid）金额；代付 = 提现成功（status=completed）金额；按服务商汇总，金额单位为元。
        </div>
      </Card>
    </div>
  )
}
