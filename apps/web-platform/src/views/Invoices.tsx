import { useEffect, useState } from 'react'
import { Button, Card, Segmented, Space, Table, Tag, Typography, message } from 'antd'
import { Link } from 'react-router-dom'
import { listInvoices, type Invoice, type InvoiceStatus } from '../api'
import InvoiceDetail, { INVOICE_STATUS } from '../components/InvoiceDetail'

const FILTERS: Array<{ label: string; value: string }> = [
  { label: '全部', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '待确认', value: 'issued' },
  { label: '已确认', value: 'confirmed' },
  { label: '争议中', value: 'disputed' },
  { label: '已核销', value: 'settled' },
]

export default function Invoices() {
  const [rows, setRows] = useState<Invoice[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try { setRows(await listInvoices(status ? { status } : {})) }
    catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [status])

  const pending = rows.filter((r) => r.status === 'issued' || r.status === 'disputed')

  return (
    <Card title="账单" loading={loading}
      extra={<Segmented options={FILTERS} value={status} onChange={(v) => setStatus(String(v))} size="small" />}>
      {status === '' && pending.length > 0 && (
        <Typography.Paragraph type="secondary">
          {pending.length} 张账单等客户确认或在争议中 —— 逾期会触发欠费降级，先看这些
        </Typography.Paragraph>
      )}
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 20, size: 'small' }}
        columns={[
          { title: '单号', dataIndex: 'invoiceNo', width: 200,
            render: (v: string, r) => <Button type="link" size="small" onClick={() => setOpenId(r.id)}>{v}</Button> },
          { title: '租户', dataIndex: 'tenantCode', width: 110,
            render: (v: string, r) => <Link to={`/tenants/${r.tenantId}/billing`}>{v}</Link> },
          { title: '周期', width: 190, render: (_, r) => `${r.periodStart} ~ ${r.periodEnd}` },
          { title: '应收', dataIndex: 'totalAmount', width: 110, align: 'right',
            render: (v: number, r) => <Typography.Text strong>{v} {r.currency}</Typography.Text> },
          { title: '调整', dataIndex: 'adjustAmount', width: 90, align: 'right',
            render: (v: number) => v === 0 ? '-' : v },
          { title: '结转下期', dataIndex: 'carryOut', width: 100, align: 'right',
            render: (v: number) => v === 0 ? '-' : <Typography.Text type="warning">{v}</Typography.Text> },
          { title: '状态', dataIndex: 'status', width: 110,
            render: (v: InvoiceStatus) => <Tag color={INVOICE_STATUS[v].color}>{INVOICE_STATUS[v].text}</Tag> },
          { title: '开票', dataIndex: 'issuedAt', width: 160,
            render: (v: string | null) => v ? v.slice(0, 16).replace('T', ' ') : '-' },
        ]} />
      <InvoiceDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />
      <Space />
    </Card>
  )
}
