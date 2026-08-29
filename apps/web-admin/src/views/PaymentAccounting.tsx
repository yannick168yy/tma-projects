import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, DatePicker, message, Statistic, Row, Col, Tooltip, Modal, InputNumber, Segmented } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getPaymentAccounting, getPaymentReconciliation, getProviderBalances, refreshProviderBalances,
  setProviderAlertThreshold, setMatrixBalance,
  type PaymentAccountingRow, type PaymentReconciliationItem, type ProviderBalanceRow,
} from '../api'

const { RangePicker } = DatePicker

function fmtMoney(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function diffTag(b: ProviderBalanceRow) {
  if (b.diffStatus === 'error') return <Tag color="red">异常</Tag>
  if (b.diffStatus === 'mismatch') return <Tag color="orange">需核对</Tag>
  return <Tag color="green">正常</Tag>
}

export default function PaymentAccounting() {
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [rows, setRows] = useState<PaymentAccountingRow[]>([])
  const [total, setTotal] = useState<PaymentAccountingRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [currency, setCurrency] = useState('IDR')
  const [reconciliation, setReconciliation] = useState<PaymentReconciliationItem[]>([])
  const [reconLoading, setReconLoading] = useState(false)

  const [balances, setBalances] = useState<ProviderBalanceRow[]>([])
  const [balLoading, setBalLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // 告警金额设置弹窗
  const [thresholdTarget, setThresholdTarget] = useState<ProviderBalanceRow | null>(null)
  const [thresholdValue, setThresholdValue] = useState<number | null>(null)
  // Matrix 手动登记余额弹窗
  const [matrixModalOpen, setMatrixModalOpen] = useState(false)
  const [matrixValue, setMatrixValue] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadAccounting() {
    setLoading(true)
    try {
      const r = await getPaymentAccounting({
        from: range ? range[0].startOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined,
        to: range ? range[1].endOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined,
        currency,
      })
      setRows(r.rows); setTotal(r.total)
    } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  async function loadReconciliation() {
    setReconLoading(true)
    try { setReconciliation(await getPaymentReconciliation('unispay', currency)) }
    catch (e) { message.error(e instanceof Error ? e.message : '对账报告加载失败') }
    finally { setReconLoading(false) }
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

  async function handleSaveThreshold() {
    if (!thresholdTarget) return
    setSaving(true)
    try {
      setBalances(await setProviderAlertThreshold(thresholdTarget.provider, thresholdValue ?? 0))
      message.success((thresholdValue ?? 0) > 0 ? '告警金额已设置' : '告警已关闭')
      setThresholdTarget(null)
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  async function handleSaveMatrixBalance() {
    if (matrixValue === null || matrixValue < 0) { message.warning('请输入余额'); return }
    setSaving(true)
    try {
      setBalances(await setMatrixBalance(matrixValue))
      message.success('Matrix 余额已登记')
      setMatrixModalOpen(false)
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  useEffect(() => { void loadAccounting(); void loadReconciliation() }, [range, currency])
  useEffect(() => { void loadBalances() }, [])

  const columns: ColumnsType<PaymentAccountingRow> = [
    { title: '服务商', dataIndex: 'label', width: 140, render: (v: string) => <b>{v}</b> },
    { title: '代收金额', dataIndex: 'depositAmount', align: 'right', render: (v: number) => <span style={{ color: '#3f8600' }}>{fmtMoney(v)}</span> },
    { title: '代收笔数', dataIndex: 'depositCount', align: 'right', width: 90 },
    { title: '代付金额', dataIndex: 'withdrawAmount', align: 'right', render: (v: number) => <span style={{ color: '#cf1322' }}>{fmtMoney(v)}</span> },
    { title: '代付笔数', dataIndex: 'withdrawCount', align: 'right', width: 90 },
    { title: '手续费', dataIndex: 'feeAmount', align: 'right', render: (v: number) => <span style={{ color: '#d46b08' }}>{fmtMoney(v)}</span> },
    { title: '净额（代收−代付）', dataIndex: 'netAmount', align: 'right', render: (v: number) => <b style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>{fmtMoney(v)}</b> },
    { title: '账面余额', dataIndex: 'bookBalance', align: 'right', render: (v: number) => <b style={{ color: v >= 0 ? '#3f8600' : '#cf1322' }}>{fmtMoney(v)}</b> },
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
            <Segmented value={currency} onChange={(v) => setCurrency(String(v))} options={['IDR', 'PHP', 'USDT']} />
            <span style={{ color: '#999', fontSize: 12 }}>每小时自动刷新</span>
            <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefreshBalances}>手动刷新</Button>
          </Space>
        }
        loading={balLoading}
      >
        <Row gutter={16}>
          {balances.map((b) => {
            const lowBalance = b.status === 'ok' && (b.alertThreshold ?? 0) > 0 && b.balance < b.alertThreshold!
            return (
            <Col key={b.provider} xs={24} sm={12} md={8}>
              <Card size="small" style={{ marginBottom: 8 }}>
                <Statistic
                  title={
                    <Space>
                      <b>{b.label}</b>
                      {b.source === 'manual' && <Tag color="blue">手动登记</Tag>}
                      {b.status === 'error'
                        ? <Tooltip title={b.errorMsg ?? '查询失败'}><Tag color="red">异常</Tag></Tooltip>
                        : lowBalance
                          ? <Tag color="red">余额不足</Tag>
                          : <Tag color="green">正常</Tag>}
                      {b.source === 'api' && diffTag(b)}
                    </Space>
                  }
                  value={b.status === 'ok' ? fmtMoney(b.balance) : '—'}
                  suffix={b.status === 'ok' ? b.currency : ''}
                  valueStyle={lowBalance ? { color: '#cf1322' } : undefined}
                />
                <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                  {b.frozen > 0 && <span>冻结 {fmtMoney(b.frozen)} · </span>}
                  更新于 {b.updatedAt ? dayjs(b.updatedAt).format('MM-DD HH:mm') : '从未'}
                </div>
                <div style={{ color: '#666', fontSize: 12, marginTop: 8, lineHeight: 1.8 }}>
                  {b.source === 'api' ? (
                    <>
                      <div>服务商合计：{fmtMoney(b.observedBalance)} {b.currency}</div>
                      <div>我方账面：{fmtMoney(b.bookBalance)} {b.currency}</div>
                      <div style={{ color: Math.abs(b.diffAmount) > 1 ? '#d46b08' : '#3f8600' }}>
                        差异：{fmtMoney(b.diffAmount)} {b.currency}
                      </div>
                    </>
                  ) : (
                    <div>后台登记余额，用户取款自动扣减（链上金额 + gas 1.2）</div>
                  )}
                  <div>
                    告警金额：{(b.alertThreshold ?? 0) > 0 ? `${fmtMoney(b.alertThreshold!)} ${b.currency}` : '未设置'}
                    <a style={{ marginLeft: 8 }} onClick={() => { setThresholdTarget(b); setThresholdValue(b.alertThreshold ?? null) }}>设置</a>
                    {b.provider === 'matrix' && (
                      <a style={{ marginLeft: 8 }} onClick={() => { setMatrixValue(b.status === 'ok' ? b.balance : null); setMatrixModalOpen(true) }}>登记余额</a>
                    )}
                  </div>
                </div>
              </Card>
            </Col>
            )
          })}
        </Row>
      </Card>

      <Card size="small" title="UnisPay 回调异常 / 对账报告" style={{ marginBottom: 16 }}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadReconciliation}>刷新</Button>}>
        <Table rowKey="id" size="small" loading={reconLoading} dataSource={reconciliation}
          pagination={{ pageSize: 20 }} columns={[
            { title: '时间', dataIndex: 'createdAt', width: 170, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
            { title: '来源', dataIndex: 'source', width: 110, render: (v: string) => <Tag color={v === 'callback_issue' ? 'red' : 'orange'}>{v}</Tag> },
            { title: '异常', dataIndex: 'issueType', width: 210 },
            { title: '商户订单', dataIndex: 'orderId' },
            { title: '渠道订单', dataIndex: 'providerOrderId' },
            { title: '金额', key: 'amount', width: 150, render: (_: unknown, r: PaymentReconciliationItem) => r.amount == null ? '—' : `${fmtMoney(r.amount)} ${r.currency ?? ''}` },
            { title: '状态', dataIndex: 'status', width: 100 },
          ]} />
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
                <Table.Summary.Cell index={5} align="right"><b style={{ color: '#d46b08' }}>{fmtMoney(total.feeAmount)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right"><b style={{ color: total.netAmount >= 0 ? '#3f8600' : '#cf1322' }}>{fmtMoney(total.netAmount)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right"><b style={{ color: total.bookBalance >= 0 ? '#3f8600' : '#cf1322' }}>{fmtMoney(total.bookBalance)}</b></Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null}
          />
          <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
            代收 = 充值成功（status=paid）金额；代付 = 提现成功（status=completed）金额；账面余额 = 代收 - 代付 - 手续费。
          </div>
      </Card>

      <Modal
        title={`${thresholdTarget?.label ?? ''} 告警金额`}
        open={!!thresholdTarget}
        onCancel={() => setThresholdTarget(null)}
        onOk={handleSaveThreshold}
        confirmLoading={saving}
        destroyOnClose
      >
        <div style={{ marginBottom: 8, color: '#666' }}>
          余额低于告警金额时，发送提醒到 Telegram 告警群（低于期间最多每 6 小时提醒一次）。设为 0 关闭告警。
        </div>
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          value={thresholdValue}
          onChange={(v) => setThresholdValue(v)}
          addonAfter={thresholdTarget?.currency}
          placeholder="0 = 关闭告警"
        />
      </Modal>

      <Modal
        title="登记 Matrix 取款钱包余额"
        open={matrixModalOpen}
        onCancel={() => setMatrixModalOpen(false)}
        onOk={handleSaveMatrixBalance}
        confirmLoading={saving}
        destroyOnClose
      >
        <div style={{ marginBottom: 8, color: '#666' }}>
          Matrix 无余额查询接口，请按钱包实际余额填写。登记后用户每笔取款会自动扣减（链上金额 + gas 1.2）；充值不会进入该钱包，不会自动增加。
        </div>
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          value={matrixValue}
          onChange={(v) => setMatrixValue(v)}
          addonAfter="USDT"
        />
      </Modal>
    </div>
  )
}
