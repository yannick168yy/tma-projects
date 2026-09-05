import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select,
  Space, Statistic, Table, Tag, Typography, message,
} from 'antd'
import {
  assignBillingPlan, generateInvoice, getTenantAccount, getTenantBillingPlan, listBillingDaily,
  listBillingPlans, listInvoices, postTenantLedger, previewInvoice, recomputeBillingDaily, setTenantCredit,
  type BillingDailyRow, type BillingPlan, type BillingRule, type Invoice, type InvoiceItem,
  type LedgerRow, type TenantAccount, type InvoiceStatus,
} from '../../api'
import InvoiceDetail, { INVOICE_STATUS } from '../../components/InvoiceDetail'
import { RULE_LABEL, ruleSummary } from '../BillingPlans'
import { useAuthStore } from '../../stores/auth'
import { useTenant } from './context'

const BIZ_LABEL: Record<string, string> = {
  margin_in: '押金/额度充入', margin_out: '额度退回', invoice_settle: '账单核销',
  manual_adjust: '人工调整', payout: '代付放款', collect: '代收入账', credit_change: '授信变更',
}

function monthOptions(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = []
  const now = new Date()
  for (let i = 1; i <= 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const v = d.toISOString().slice(0, 7)
    out.push({ value: v, label: v })
  }
  return out
}

/**
 * 单租户的计费与账单（P2-5 / P2-6 / P2-12 的平台侧）。
 *
 * 顺序刻意按结算流程排：挂方案 → 看日切快照 → 试算 → 出账 → 额度扣划。
 * 这也是运营每个月实际的操作顺序。
 */
export default function Billing() {
  const { d } = useTenant()
  const role = useAuthStore((s) => s.role)
  const canWrite = role === 'platform_super' || role === 'platform_finance'
  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [bound, setBound] = useState<{ plan: { id: number; name: string; settleMode: string; settleCurrency: string; period: string }; rules: BillingRule[] } | null>(null)
  const [account, setAccount] = useState<TenantAccount | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [daily, setDaily] = useState<BillingDailyRow[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [month, setMonth] = useState(monthOptions()[0].value)
  const [preview, setPreview] = useState<{ gross: number; items: InvoiceItem[]; days: number; carryIn: number; carryOut: number; missingFx: string[]; planName: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [openInvoice, setOpenInvoice] = useState<number | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [ledgerForm] = Form.useForm<{ bizType: string; amount: number; remark: string }>()
  const [creditForm] = Form.useForm<{ creditLimit: number }>()

  async function load() {
    try {
      const [p, b, a, dl, inv] = await Promise.all([
        listBillingPlans(),
        getTenantBillingPlan(d.id),
        getTenantAccount(d.id),
        listBillingDaily(d.id),
        listInvoices({ tenantId: d.id }),
      ])
      setPlans(p)
      setBound(b.bound)
      setAccount(a.account)
      setLedger(a.ledger)
      setDaily(dl)
      setInvoices(inv)
    } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [d.id])

  async function bindPlan(planId: number) {
    try {
      await assignBillingPlan(d.id, planId)
      await load()
      message.success('已挂方案，下次出账按它算')
    } catch (e) { message.error((e as Error).message) }
  }

  async function doPreview() {
    setBusy(true)
    try { setPreview(await previewInvoice(d.id, month)) }
    catch (e) { message.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function doGenerate() {
    setBusy(true)
    try {
      const res = await generateInvoice(d.id, month)
      message.success(`已生成 ${res.invoiceNo}，应收 ${res.total}，快照已锁定`)
      setPreview(null)
      await load()
    } catch (e) { message.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function recompute(date: string) {
    try {
      const res = await recomputeBillingDaily(d.id, date)
      await load()
      message.success(res.rows > 0 ? `已重算 ${date}` : `${date} 无数据或已锁定`)
    } catch (e) { message.error((e as Error).message) }
  }

  async function submitLedger() {
    const v = await ledgerForm.validateFields()
    try {
      await postTenantLedger(d.id, v)
      setLedgerOpen(false)
      ledgerForm.resetFields()
      await load()
      message.success('已记账')
    } catch (e) { message.error((e as Error).message) }
  }

  async function submitCredit() {
    const v = await creditForm.validateFields()
    try {
      await setTenantCredit(d.id, v.creditLimit)
      setCreditOpen(false)
      await load()
      message.success('授信已更新')
    } catch (e) { message.error((e as Error).message) }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="分成方案" size="small"
        extra={canWrite && (
          <Select<number> size="small" style={{ width: 220 }} placeholder="挂/换分成方案"
            value={bound?.plan.id} onChange={bindPlan}
            options={plans.filter((p) => p.enabled).map((p) => ({ value: p.id, label: p.name }))} />
        )}>
        {!bound ? (
          <Alert type="warning" showIcon message="未挂分成方案，不能出账"
            description="签约后先挂方案。方案与规则在「分成方案」页维护。" />
        ) : (
          <>
            <Descriptions size="small" column={3}>
              <Descriptions.Item label="方案">{bound.plan.name}</Descriptions.Item>
              <Descriptions.Item label="结算币种">{bound.plan.settleCurrency}</Descriptions.Item>
              <Descriptions.Item label="月费关系">
                {bound.plan.settleMode === 'max_of_fee' ? 'max(月费, 分成)' : '月费 + 分成'}
              </Descriptions.Item>
            </Descriptions>
            <Table rowKey="id" size="small" pagination={false} dataSource={bound.rules} style={{ marginTop: 8 }}
              columns={[
                { title: '类型', dataIndex: 'ruleType', width: 110, render: (v: keyof typeof RULE_LABEL) => RULE_LABEL[v] },
                { title: '名称', dataIndex: 'label' },
                { title: '费率', render: (_, r) => ruleSummary(r) },
                { title: 'GGR 口径', render: (_, r) => r.ruleType !== 'ggr_share' ? '-' : (
                  <Space size={4} wrap>
                    {r.deductBonus && <Tag>扣活动</Tag>}
                    {r.deductCommission && <Tag>扣佣金</Tag>}
                    {r.deductChannelFee && <Tag>扣通道费</Tag>}
                    <Tag color={r.carryOver ? 'blue' : 'default'}>{r.carryOver ? '负 GGR 结转' : '负 GGR 归零'}</Tag>
                  </Space>
                ) },
              ]} />
          </>
        )}
      </Card>

      <Card title="额度账户" size="small"
        extra={canWrite && <Space>
          <Button size="small" onClick={() => { creditForm.setFieldsValue({ creditLimit: account?.creditLimit ?? 0 }); setCreditOpen(true) }}>
            调授信
          </Button>
          <Button size="small" type="primary" onClick={() => setLedgerOpen(true)}>记一笔</Button>
        </Space>}>
        {account && (
          <Space size={48} wrap>
            <Statistic title="余额" value={account.balance} precision={2}
              valueStyle={account.balance < 0 ? { color: '#cf1322' } : undefined} />
            <Statistic title="授信额度" value={account.creditLimit} precision={2} />
            <Statistic title="押金" value={account.depositAmount} precision={2} />
            <Statistic title="可动用（余额+授信）" value={account.available} precision={2}
              valueStyle={account.available < 0 ? { color: '#cf1322' } : { color: '#3f8600' }} />
          </Space>
        )}
        <Table rowKey="id" size="small" style={{ marginTop: 12 }} dataSource={ledger}
          pagination={{ pageSize: 8, size: 'small' }}
          locale={{ emptyText: '暂无流水' }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 160, render: (v: string) => v.slice(0, 16).replace('T', ' ') },
            { title: '类型', dataIndex: 'bizType', width: 130, render: (v: string) => BIZ_LABEL[v] ?? v },
            { title: '金额', dataIndex: 'amount', width: 110, align: 'right',
              render: (v: number) => v < 0 ? <Typography.Text type="danger">{v}</Typography.Text> : <Typography.Text type="success">+{v}</Typography.Text> },
            { title: '余额', dataIndex: 'balanceAfter', width: 110, align: 'right' },
            { title: '摘要', dataIndex: 'remark' },
          ]} />
      </Card>

      <Card title="出账" size="small"
        extra={<Space>
          <Select size="small" style={{ width: 120 }} value={month} onChange={setMonth} options={monthOptions()} />
          <Button size="small" loading={busy} onClick={doPreview}>试算</Button>
          {canWrite && <Button size="small" type="primary" loading={busy} disabled={!bound} onClick={doGenerate}>生成账单</Button>}
        </Space>}>
        {!preview ? (
          <Typography.Text type="secondary">先试算看金额与逐项明细，确认没问题再生成账单。生成即锁定该周期的日切快照。</Typography.Text>
        ) : preview.planName === null ? (
          <Alert type="warning" showIcon message="未挂分成方案，无法试算" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {preview.missingFx.length > 0 && (
              <Alert type="error" showIcon message={`以下日期缺当日汇率快照，出账会被拒：${preview.missingFx.slice(0, 5).join('、')}`}
                description="缺汇率的天不参与折算，直接出账会少收钱。先补齐 BI 汇率快照再重算。" />
            )}
            <Space size={32} wrap>
              <Statistic title={`应收（${month}，${preview.days} 天数据）`} value={preview.gross} precision={2} />
              <Statistic title="上期结转" value={preview.carryIn} precision={2} />
              <Statistic title="结转下期" value={preview.carryOut} precision={2} />
            </Space>
            <Table rowKey={(r) => `${r.ruleType}:${r.label}`} size="small" pagination={false} dataSource={preview.items}
              columns={[
                { title: '项目', dataIndex: 'label' },
                { title: '计费基数', dataIndex: 'basisAmount', align: 'right', width: 130 },
                { title: '费率', dataIndex: 'ratePct', width: 80, align: 'right',
                  render: (v: number | null) => v === null ? '分档' : `${v}%` },
                { title: '金额', dataIndex: 'amount', align: 'right', width: 120,
                  render: (v: number) => <Typography.Text strong>{v}</Typography.Text> },
              ]} />
          </Space>
        )}
      </Card>

      <Card title="账单" size="small">
        <Table rowKey="id" size="small" dataSource={invoices} pagination={{ pageSize: 6, size: 'small' }}
          locale={{ emptyText: '还没出过账' }}
          columns={[
            { title: '单号', dataIndex: 'invoiceNo',
              render: (v: string, r) => <Button type="link" size="small" onClick={() => setOpenInvoice(r.id)}>{v}</Button> },
            { title: '周期', width: 190, render: (_, r) => `${r.periodStart} ~ ${r.periodEnd}` },
            { title: '应收', dataIndex: 'totalAmount', width: 110, align: 'right' },
            { title: '状态', dataIndex: 'status', width: 110,
              render: (v: InvoiceStatus) => <Tag color={INVOICE_STATUS[v].color}>{INVOICE_STATUS[v].text}</Tag> },
          ]} />
      </Card>

      <Card title="日切快照（近 30 天）" size="small"
        extra={<Typography.Text type="secondary">锁定的行不会被重算覆盖</Typography.Text>}>
        <Table rowKey={(r) => `${r.statDate}:${r.currency}`} size="small" dataSource={daily}
          pagination={{ pageSize: 10, size: 'small' }}
          locale={{ emptyText: '还没有快照 —— 每天马尼拉 05:00 自动生成，也可手工重算' }}
          columns={[
            { title: '日期', dataIndex: 'statDate', width: 105 },
            { title: '币种', dataIndex: 'currency', width: 70 },
            { title: '汇率', dataIndex: 'fxRateUsdt', width: 90, align: 'right',
              render: (v: number) => v > 0 ? v.toFixed(6) : <Tag color="red">缺</Tag> },
            { title: '充值', dataIndex: 'depositAmount', align: 'right', width: 110 },
            { title: '其中平台代收', dataIndex: 'depositPlatform', align: 'right', width: 110 },
            { title: '流水', dataIndex: 'turnover', align: 'right', width: 120 },
            { title: 'GGR', dataIndex: 'ggr', align: 'right', width: 110,
              render: (v: number) => v < 0 ? <Typography.Text type="danger">{v}</Typography.Text> : v },
            { title: '活动成本', dataIndex: 'bonusCost', align: 'right', width: 100 },
            { title: '佣金', dataIndex: 'commissionCost', align: 'right', width: 100 },
            { title: '通道费', dataIndex: 'channelFee', align: 'right', width: 90 },
            { title: '', width: 90, render: (_, r) => r.locked
              ? <Tag>已锁定</Tag>
              : canWrite ? <Button size="small" type="link" onClick={() => void recompute(r.statDate)}>重算</Button> : null },
          ]} />
      </Card>

      <InvoiceDetail id={openInvoice} onClose={() => setOpenInvoice(null)} onChanged={load} />

      <Modal title="手工记一笔额度流水" open={ledgerOpen} onCancel={() => setLedgerOpen(false)} onOk={submitLedger} destroyOnClose>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="流水只增不改：记错了只能反向再记一笔冲掉，不能改历史行" />
        <Form form={ledgerForm} layout="vertical" initialValues={{ bizType: 'margin_in' }}>
          <Form.Item name="bizType" label="类型" rules={[{ required: true }]}>
            <Select options={[
              { value: 'margin_in', label: '押金/额度充入（正数）' },
              { value: 'margin_out', label: '额度退回（负数）' },
              { value: 'manual_adjust', label: '人工调整' },
            ]} />
          </Form.Item>
          <Form.Item name="amount" label="金额（正=增加，负=减少）" rules={[{ required: true }]}>
            <InputNumber style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="remark" label="摘要" rules={[{ required: true, message: '必须填摘要' }]}>
            <Input placeholder="9 月押金到账，TXID xxx" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="调整授信额度" open={creditOpen} onCancel={() => setCreditOpen(false)} onOk={submitCredit} destroyOnClose>
        <Form form={creditForm} layout="vertical">
          <Form.Item name="creditLimit" label="授信额度（USDT）" rules={[{ required: true }]}
            help="可动用额度 = 余额 + 授信。押金不计入，它是违约金来源而不是运营资金">
            <InputNumber min={0} style={{ width: 200 }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
