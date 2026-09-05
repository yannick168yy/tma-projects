import { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd'
import { adjustInvoice, getInvoice, setInvoiceStatus, type Invoice, type InvoiceItem, type InvoiceStatus } from '../api'
import { RULE_LABEL } from '../views/BillingPlans'
import { useAuthStore } from '../stores/auth'

export const INVOICE_STATUS: Record<InvoiceStatus, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  issued: { text: '待客户确认', color: 'blue' },
  confirmed: { text: '已确认', color: 'cyan' },
  disputed: { text: '争议中', color: 'orange' },
  settled: { text: '已核销', color: 'green' },
  void: { text: '已作废', color: 'default' },
}

const NEXT: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'void'],
  issued: ['confirmed', 'disputed', 'void'],
  disputed: ['issued', 'void'],
  confirmed: ['settled', 'disputed'],
  settled: [],
  void: [],
}

const ACTION_TEXT: Record<string, string> = {
  issued: '开票给客户', confirmed: '代客户确认', disputed: '标记争议',
  settled: '核销（扣划额度）', void: '作废',
}

/** 扣减项要逐项列出来：客户问「这 3800 怎么来的」时，答案必须在同一屏里 */
function ItemDetail({ item }: { item: InvoiceItem }) {
  const d = item.detail as Record<string, unknown>
  if (item.ruleType === 'ggr_share') {
    const ded = (d.deductions ?? {}) as Record<string, number>
    return (
      <Space direction="vertical" size={0}>
        <Typography.Text type="secondary">有效投注 {d.turnover as number} − 派彩 {d.payout as number} = GGR {d.ggr as number}</Typography.Text>
        <Typography.Text type="secondary">
          − 活动 {ded.bonusCost ?? 0} − 佣金 {ded.commissionCost ?? 0} − 通道费 {ded.channelFee ?? 0} = 净收益 {d.netGgr as number}
        </Typography.Text>
        {(d.carryIn as number) !== 0 && (
          <Typography.Text type="secondary">上期结转 {d.carryIn as number} → 计费基数 {d.afterCarry as number}</Typography.Text>
        )}
      </Space>
    )
  }
  if (item.ruleType === 'monthly_fee') {
    const months = (d.months ?? []) as Array<{ month: string; days: number; monthDays: number; amount: number }>
    return <Typography.Text type="secondary">
      {months.map((m) => `${m.month} ${m.days}/${m.monthDays} 天 = ${m.amount}`).join('；')}
    </Typography.Text>
  }
  if (Array.isArray(d.venues)) {
    const venues = d.venues as Array<{ venue: string; turnover: number; ratePct: number; amount: number }>
    return <Typography.Text type="secondary">
      {venues.map((v) => `${v.venue} ${v.turnover}×${v.ratePct}%=${v.amount}`).join('；')}
    </Typography.Text>
  }
  if (Array.isArray(d.tiers)) {
    const tiers = d.tiers as Array<{ from: number; to: number | null; ratePct: number; amount: number }>
    return <Typography.Text type="secondary">
      {tiers.map((t) => `${t.from}~${t.to ?? '∞'} @${t.ratePct}% = ${t.amount}`).join('；')}
    </Typography.Text>
  }
  return <Typography.Text type="secondary">{d.scope === 'platform' ? '仅平台代收部分' : d.scope === 'tenant' ? '仅自带通道部分' : '-'}</Typography.Text>
}

export default function InvoiceDetail({ id, onClose, onChanged }: {
  id: number | null
  onClose: () => void
  onChanged?: () => void
}) {
  const role = useAuthStore((s) => s.role)
  const canWrite = role === 'platform_super' || role === 'platform_finance'
  const [data, setData] = useState<{ invoice: Invoice; items: InvoiceItem[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [form] = Form.useForm<{ adjust: number; note: string }>()

  async function load() {
    if (id === null) { setData(null); return }
    try { setData(await getInvoice(id)) } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [id])

  async function move(to: InvoiceStatus, reason?: string) {
    if (id === null) return
    setBusy(true)
    try {
      await setInvoiceStatus(id, to, reason)
      await load()
      onChanged?.()
      message.success(to === 'settled' ? '已核销，额度账户已扣划' : '已更新')
    } catch (e) { message.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function submitAdjust() {
    if (id === null) return
    const v = await form.validateFields()
    try {
      await adjustInvoice(id, v.adjust, v.note)
      setAdjustOpen(false)
      form.resetFields()
      await load()
      onChanged?.()
      message.success('已调整')
    } catch (e) { message.error((e as Error).message) }
  }

  const inv = data?.invoice
  return (
    <Drawer open={id !== null} onClose={onClose} width={860}
      title={inv ? <Space>{inv.invoiceNo}<Tag color={INVOICE_STATUS[inv.status].color}>{INVOICE_STATUS[inv.status].text}</Tag></Space> : '账单'}
      extra={inv && canWrite && <Space>
        {inv.status !== 'settled' && inv.status !== 'void' && inv.status !== 'confirmed' && (
          <Button size="small" onClick={() => setAdjustOpen(true)}>人工调整</Button>
        )}
        {NEXT[inv.status].map((to) => (
          <Popconfirm key={to} title={ACTION_TEXT[to]}
            description={to === 'settled' ? '将从租户额度账户扣划，额度不足会记欠款并进人工队列' : undefined}
            onConfirm={() => {
              if (to === 'disputed') {
                let reason = ''
                Modal.confirm({
                  title: '标记争议',
                  content: <Input.TextArea rows={3} placeholder="争议原因" onChange={(e) => { reason = e.target.value }} />,
                  onOk: () => move('disputed', reason),
                })
                return
              }
              void move(to)
            }}>
            <Button size="small" loading={busy} danger={to === 'void'}
              type={to === 'settled' || to === 'issued' ? 'primary' : 'default'}>{ACTION_TEXT[to]}</Button>
          </Popconfirm>
        ))}
      </Space>}>
      {inv && (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {inv.status === 'disputed' && (
            <Alert type="warning" showIcon message={`争议原因：${inv.disputeReason ?? '未填'}`}
              description="争议解决后要重新开票走确认，不能直接核销" />
          )}
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="租户">{inv.tenantCode ?? inv.tenantId}</Descriptions.Item>
            <Descriptions.Item label="周期">{inv.periodStart} ~ {inv.periodEnd}</Descriptions.Item>
            <Descriptions.Item label="币种">{inv.currency}</Descriptions.Item>
            <Descriptions.Item label="规则合计">{inv.grossAmount}</Descriptions.Item>
            <Descriptions.Item label="人工调整">{inv.adjustAmount}</Descriptions.Item>
            <Descriptions.Item label="应收">
              <Typography.Text strong>{inv.totalAmount}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="上期结转">{inv.carryIn}</Descriptions.Item>
            <Descriptions.Item label="结转下期">{inv.carryOut}</Descriptions.Item>
            <Descriptions.Item label="开票时间">{inv.issuedAt?.slice(0, 19).replace('T', ' ') ?? '-'}</Descriptions.Item>
            {inv.note && <Descriptions.Item label="备注" span={3}>{inv.note}</Descriptions.Item>}
          </Descriptions>

          <Table rowKey={(r) => `${r.ruleType}:${r.label}`} size="small" pagination={false} dataSource={data.items}
            columns={[
              { title: '项目', dataIndex: 'label', width: 180,
                render: (v: string, r) => <Space direction="vertical" size={0}>
                  <span>{v}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {RULE_LABEL[r.ruleType as keyof typeof RULE_LABEL] ?? r.ruleType}</Typography.Text>
                </Space> },
              { title: '计费基数', dataIndex: 'basisAmount', width: 110, align: 'right' },
              { title: '费率', dataIndex: 'ratePct', width: 70, align: 'right',
                render: (v: number | null) => v === null ? '分档' : `${v}%` },
              { title: '金额', dataIndex: 'amount', width: 110, align: 'right',
                render: (v: number) => <Typography.Text strong>{v}</Typography.Text> },
              { title: '算法明细', render: (_, r) => <ItemDetail item={r} /> },
            ]} />
        </Space>
      )}

      <Modal title="人工调整" open={adjustOpen} onCancel={() => setAdjustOpen(false)} onOk={submitAdjust} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="adjust" label="调整金额（负数=减免）" rules={[{ required: true }]}>
            <InputNumber style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="note" label="原因" rules={[{ required: true, message: '必须填原因' }]}
            help="事后唯一能解释「为什么少收」的东西，会进审计">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  )
}
