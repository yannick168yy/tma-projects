import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { getLedgerRecords, SUPPORTED_CURRENCIES, type AdminLedgerRecord } from '../api'

const { RangePicker } = DatePicker

const LEDGER_TYPES = [
  { value: 'deposit', label: '充值' },
  { value: 'withdraw', label: '提现' },
  { value: 'bet', label: '投注' },
  { value: 'win', label: '派彩' },
  { value: 'bonus', label: '奖励' },
  { value: 'rebate', label: '洗码' },
  { value: 'red_packet', label: '红包' },
  { value: 'adjust', label: '调整' },
  { value: 'admin_adjust', label: '后台调整' },
]

function typeLabel(type: string) {
  return LEDGER_TYPES.find((t) => t.value === type)?.label ?? type
}

function typeColor(type: string) {
  if (['deposit', 'win', 'bonus', 'rebate', 'red_packet'].includes(type)) return 'green'
  if (['withdraw', 'bet'].includes(type)) return 'red'
  return 'blue'
}

function formatMoney(amount: number, currency: string) {
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${currency}`
}

export default function LedgerRecords() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState('')
  const [type, setType] = useState<string | undefined>()
  const [currency, setCurrency] = useState<string | undefined>()
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().subtract(6, 'day'), dayjs()])
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AdminLedgerRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  async function load(p = 1) {
    setPage(p)
    setLoading(true)
    try {
      const res = await getLedgerRecords({
        page: p,
        pageSize: 20,
        userId: userId.trim() || undefined,
        type,
        currency,
        from: range ? range[0].startOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined,
        to: range ? range[1].endOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 180 },
    {
      title: '用户',
      key: 'user',
      width: 160,
      render: (_: unknown, r: AdminLedgerRecord) => (
        <Button type="link" size="small" onClick={() => navigate(`/users/${r.userId}`)}>{r.userId}</Button>
      ),
    },
    { title: '类型', key: 'type', width: 110, render: (_: unknown, r: AdminLedgerRecord) => <Tag color={typeColor(r.type)}>{typeLabel(r.type)}</Tag> },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 90 },
    {
      title: '金额',
      key: 'amount',
      align: 'right' as const,
      width: 150,
      render: (_: unknown, r: AdminLedgerRecord) => (
        <span style={{ color: r.amount >= 0 ? '#3f8600' : '#cf1322', fontWeight: 600 }}>{formatMoney(r.amount, r.currency)}</span>
      ),
    },
    { title: '变后余额', key: 'balanceAfter', align: 'right' as const, width: 150, render: (_: unknown, r: AdminLedgerRecord) => formatMoney(r.balanceAfter, r.currency) },
    {
      title: '关联',
      key: 'ref',
      width: 180,
      render: (_: unknown, r: AdminLedgerRecord) => r.refType || r.refId ? `${r.refType ?? '-'} / ${r.refId ?? '-'}` : '-',
    },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'Trace', dataIndex: 'traceId', key: 'traceId', width: 180, ellipsis: true, render: (v: string | null) => v || '-' },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize: 20,
    total,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => void load(p),
  }

  return (
    <div>
      <h2>账变记录</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户ID" style={{ width: 180 }} allowClear />
        <Select value={type} placeholder="类型" allowClear style={{ width: 140 }} onChange={setType} options={LEDGER_TYPES} />
        <Select value={currency} placeholder="币种" allowClear style={{ width: 130 }} onChange={setCurrency} options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <RangePicker
          value={range}
          onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
          presets={[
            { label: '今日', value: [dayjs(), dayjs()] },
            { label: '近7天', value: [dayjs().subtract(6, 'day'), dayjs()] },
            { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
          ]}
        />
        <Button type="primary" onClick={() => void load(1)}>查询</Button>
      </Space>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" scroll={{ x: 1420 }} />
    </div>
  )
}
