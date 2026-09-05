import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Modal, Popconfirm,
  Space, Statistic, Table, Tabs, Tag, Typography, message,
} from 'antd'
import dayjs from 'dayjs'
import {
  confirmPlatformInvoice, disputePlatformInvoice, downloadPlatformInvoice, getPlatformBillingSummary,
  getPlatformInvoice, listPlatformBillingDaily, listPlatformBillingLedger,
  type PlatformBillingDaily, type PlatformBillingSummary, type PlatformInvoice,
  type PlatformInvoiceItem, type PlatformLedgerRow,
} from '../api'

const STATUS: Record<PlatformInvoice['status'], { text: string; color: string }> = {
  draft: { text: '平台待开票', color: 'default' },
  issued: { text: '待你确认', color: 'blue' },
  confirmed: { text: '已确认待核销', color: 'cyan' },
  disputed: { text: '争议中', color: 'orange' },
  settled: { text: '已核销', color: 'green' },
  void: { text: '已作废', color: 'default' },
}

const RULE_LABEL: Record<string, string> = {
  deposit_commission: '充值佣金', ggr_share: 'GGR 分成', turnover_rebate: '流水返点', monthly_fee: '月费',
}

const BIZ_LABEL: Record<string, string> = {
  margin_in: '押金/额度充入', margin_out: '额度退回', invoice_settle: '账单核销',
  manual_adjust: '人工调整', payout: '代付放款', collect: '代收入账', credit_change: '授信变更',
}

/** GGR 口径逐项展开：客户能自己把每一步加减算一遍，才谈不上争议 */
function ItemDetail({ item }: { item: PlatformInvoiceItem }) {
  const d = item.detail
  if (item.ruleType === 'ggr_share') {
    const ded = (d.deductions ?? {}) as Record<string, number>
    return (
      <Space direction="vertical" size={0}>
        <Typography.Text type="secondary">
          有效投注 {d.turnover as number} − 派彩 {d.payout as number} = GGR {d.ggr as number}
        </Typography.Text>
        <Typography.Text type="secondary">
          − 活动成本 {ded.bonusCost ?? 0} − 团队佣金 {ded.commissionCost ?? 0} − 通道手续费 {ded.channelFee ?? 0}
          {' '}= 净收益 {d.netGgr as number}
        </Typography.Text>
        {(d.carryIn as number) !== 0 && (
          <Typography.Text type="secondary">上期结转 {d.carryIn as number} → 本期计费基数 {d.afterCarry as number}</Typography.Text>
        )}
      </Space>
    )
  }
  if (item.ruleType === 'monthly_fee') {
    const months = (d.months ?? []) as Array<{ month: string; days: number; monthDays: number; amount: number }>
    return <Typography.Text type="secondary">
      {months.map((m) => `${m.month} 计 ${m.days}/${m.monthDays} 天 = ${m.amount}`).join('；')}
    </Typography.Text>
  }
  if (Array.isArray(d.venues)) {
    const venues = d.venues as Array<{ venue: string; turnover: number; ratePct: number; amount: number }>
    return <Typography.Text type="secondary">
      {venues.map((v) => `${v.venue} ${v.turnover}×${v.ratePct}% = ${v.amount}`).join('；')}
    </Typography.Text>
  }
  if (Array.isArray(d.tiers)) {
    const tiers = d.tiers as Array<{ from: number; to: number | null; ratePct: number; amount: number }>
    return <Typography.Text type="secondary">
      {tiers.map((t) => `${t.from}~${t.to ?? '不限'} 按 ${t.ratePct}% = ${t.amount}`).join('；')}
    </Typography.Text>
  }
  return <Typography.Text type="secondary">
    {d.scope === 'platform' ? '仅统计走平台代收通道的充值' : d.scope === 'tenant' ? '仅统计走自有通道的充值' : '-'}
  </Typography.Text>
}

/**
 * 平台账单（P2-12）。租户视角：这是本站要付给包网平台的钱。
 *
 * 客户只能确认或提争议 —— 金额是平台按签约规则算的，客户改不了自己该付多少，
 * 但每一项的算法必须摊开给他看，否则确认按钮点不下去。
 */
export default function PlatformBilling() {
  const [summary, setSummary] = useState<PlatformBillingSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<{ invoice: PlatformInvoice; items: PlatformInvoiceItem[] } | null>(null)
  const [daily, setDaily] = useState<PlatformBillingDaily[]>([])
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(30, 'day'), dayjs()])
  const [ledger, setLedger] = useState<PlatformLedgerRow[]>([])
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [form] = Form.useForm<{ reason: string }>()

  async function load() {
    setLoading(true)
    try { setSummary(await getPlatformBillingSummary()) }
    catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  useEffect(() => {
    void (async () => {
      try { setDaily(await listPlatformBillingDaily(range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'))) }
      catch (e) { message.error((e as Error).message) }
    })()
  }, [range])

  useEffect(() => {
    void (async () => {
      try { setLedger(await listPlatformBillingLedger()) } catch { /* 额度未开通时为空 */ }
    })()
  }, [])

  async function openInvoice(id: number) {
    setOpenId(id)
    try { setDetail(await getPlatformInvoice(id)) }
    catch (e) { message.error((e as Error).message) }
  }

  async function confirm(id: number) {
    try {
      await confirmPlatformInvoice(id)
      message.success('已确认，平台会按此金额核销')
      await load()
      await openInvoice(id)
    } catch (e) { message.error((e as Error).message) }
  }

  async function submitDispute() {
    if (openId === null) return
    const v = await form.validateFields()
    try {
      await disputePlatformInvoice(openId, v.reason)
      setDisputeOpen(false)
      form.resetFields()
      message.success('已提出争议，平台会联系你核对')
      await load()
      await openInvoice(openId)
    } catch (e) { message.error((e as Error).message) }
  }

  const inv = detail?.invoice

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {summary?.pendingCount ? (
        <Alert type="warning" showIcon
          message={`有 ${summary.pendingCount} 张账单待你确认`}
          description="账单逾期未结会触发降级：先停提现，再停充值，最后停站。有异议请点「提出争议」而不是放着不处理。" />
      ) : null}

      <Card title="额度账户" loading={loading} size="small">
        {summary && (
          <Space size={48} wrap>
            <Statistic title="余额" value={summary.account.balance} precision={2}
              suffix={summary.account.currency}
              valueStyle={summary.account.balance < 0 ? { color: '#cf1322' } : undefined} />
            <Statistic title="平台授信" value={summary.account.creditLimit} precision={2} />
            <Statistic title="押金" value={summary.account.depositAmount} precision={2} />
            <Statistic title="可动用" value={summary.account.available} precision={2}
              valueStyle={summary.account.available < 0 ? { color: '#cf1322' } : { color: '#3f8600' }} />
          </Space>
        )}
      </Card>

      <Card title="分成方案" size="small">
        {!summary?.plan ? (
          <Typography.Text type="secondary">尚未签约分成方案，暂不产生账单</Typography.Text>
        ) : (
          <>
            <Descriptions size="small" column={3}>
              <Descriptions.Item label="方案">{summary.plan.name}</Descriptions.Item>
              <Descriptions.Item label="结算币种">{summary.plan.settleCurrency}</Descriptions.Item>
              <Descriptions.Item label="月费与分成">
                {summary.plan.settleMode === 'max_of_fee' ? '取较高者（月费保底）' : '月费与分成相加'}
              </Descriptions.Item>
            </Descriptions>
            <Table rowKey={(r) => `${r.ruleType}:${r.label}`} size="small" pagination={false}
              dataSource={summary.plan.rules} style={{ marginTop: 8 }}
              columns={[
                { title: '类型', dataIndex: 'ruleType', width: 110, render: (v: string) => RULE_LABEL[v] ?? v },
                { title: '项目', dataIndex: 'label' },
                { title: '费率', render: (_, r) => r.ruleType === 'monthly_fee'
                  ? `${r.fixedAmount ?? 0} / 月`
                  : r.tiers?.length
                    ? `分档（${r.tierMode === 'progressive' ? '累进' : '整体'}）`
                    : `${r.ratePct ?? 0}%` },
                { title: 'GGR 口径', render: (_, r) => r.ruleType !== 'ggr_share' ? '-' : (
                  <Space size={4} wrap>
                    {r.deductBonus && <Tag>扣活动成本</Tag>}
                    {r.deductCommission && <Tag>扣团队佣金</Tag>}
                    {r.deductChannelFee && <Tag>扣通道手续费</Tag>}
                    <Tag color={r.carryOver ? 'blue' : 'default'}>{r.carryOver ? '负 GGR 结转下期' : '负 GGR 当期归零'}</Tag>
                  </Space>
                ) },
              ]} />
          </>
        )}
      </Card>

      <Card size="small">
        <Tabs items={[
          {
            key: 'invoices', label: '账单',
            children: (
              <Table rowKey="id" size="small" dataSource={summary?.invoices ?? []} loading={loading}
                pagination={{ pageSize: 12, size: 'small' }}
                locale={{ emptyText: '还没有账单' }}
                columns={[
                  { title: '账单号', dataIndex: 'invoiceNo',
                    render: (v: string, r) => <Button type="link" size="small" onClick={() => void openInvoice(r.id)}>{v}</Button> },
                  { title: '结算周期', width: 190, render: (_, r) => `${r.periodStart} ~ ${r.periodEnd}` },
                  { title: '应付', dataIndex: 'totalAmount', width: 120, align: 'right',
                    render: (v: number, r) => <Typography.Text strong>{v} {r.currency}</Typography.Text> },
                  { title: '状态', dataIndex: 'status', width: 130,
                    render: (v: PlatformInvoice['status']) => <Tag color={STATUS[v].color}>{STATUS[v].text}</Tag> },
                  { title: '开票时间', dataIndex: 'issuedAt', width: 160,
                    render: (v: string | null) => v ? v.slice(0, 16).replace('T', ' ') : '-' },
                  { title: '操作', width: 160,
                    render: (_, r) => r.status === 'issued' ? (
                      <Space size={4}>
                        <Popconfirm title="确认这张账单？" description="确认后金额即锁定，平台按此核销"
                          onConfirm={() => void confirm(r.id)}>
                          <Button size="small" type="link">确认</Button>
                        </Popconfirm>
                        <Button size="small" type="link" danger
                          onClick={() => { setOpenId(r.id); void openInvoice(r.id); setDisputeOpen(true) }}>争议</Button>
                      </Space>
                    ) : null },
                ]} />
            ),
          },
          {
            key: 'daily', label: '对账明细',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <DatePicker.RangePicker size="small" value={range} allowClear={false}
                  onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
                <Typography.Text type="secondary">
                  数字与「数据分析」里的日报同源。折算汇率取当日快照，账单生成后该日数据即锁定。
                </Typography.Text>
                <Table rowKey={(r) => `${r.statDate}:${r.currency}`} size="small" dataSource={daily}
                  pagination={{ pageSize: 15, size: 'small' }}
                  columns={[
                    { title: '日期', dataIndex: 'statDate', width: 105 },
                    { title: '币种', dataIndex: 'currency', width: 70 },
                    { title: '折 USDT 汇率', dataIndex: 'fxRateUsdt', width: 120, align: 'right',
                      render: (v: number) => v > 0 ? v.toFixed(6) : <Tag color="red">缺</Tag> },
                    { title: '充值', dataIndex: 'depositAmount', align: 'right', width: 110 },
                    { title: '其中平台代收', dataIndex: 'depositPlatform', align: 'right', width: 120 },
                    { title: '提现', dataIndex: 'withdrawAmount', align: 'right', width: 110 },
                    { title: '有效投注', dataIndex: 'turnover', align: 'right', width: 120 },
                    { title: '派彩', dataIndex: 'payout', align: 'right', width: 110 },
                    { title: 'GGR', dataIndex: 'ggr', align: 'right', width: 110,
                      render: (v: number) => v < 0 ? <Typography.Text type="danger">{v}</Typography.Text> : v },
                    { title: '活动成本', dataIndex: 'bonusCost', align: 'right', width: 100 },
                    { title: '团队佣金', dataIndex: 'commissionCost', align: 'right', width: 100 },
                    { title: '通道手续费', dataIndex: 'channelFee', align: 'right', width: 110 },
                    { title: '', width: 70, render: (_, r) => r.locked ? <Tag>已出账</Tag> : null },
                  ]} />
              </Space>
            ),
          },
          {
            key: 'ledger', label: '额度流水',
            children: (
              <Table rowKey="id" size="small" dataSource={ledger} pagination={{ pageSize: 12, size: 'small' }}
                locale={{ emptyText: '暂无流水' }}
                columns={[
                  { title: '时间', dataIndex: 'createdAt', width: 170,
                    render: (v: string) => v.slice(0, 19).replace('T', ' ') },
                  { title: '类型', dataIndex: 'bizType', width: 140, render: (v: string) => BIZ_LABEL[v] ?? v },
                  { title: '金额', dataIndex: 'amount', width: 120, align: 'right',
                    render: (v: number) => v < 0
                      ? <Typography.Text type="danger">{v}</Typography.Text>
                      : <Typography.Text type="success">+{v}</Typography.Text> },
                  { title: '余额', dataIndex: 'balanceAfter', width: 120, align: 'right' },
                  { title: '摘要', dataIndex: 'remark' },
                ]} />
            ),
          },
        ]} />
      </Card>

      <Drawer open={openId !== null} onClose={() => { setOpenId(null); setDetail(null) }} width={820}
        title={inv ? <Space>{inv.invoiceNo}<Tag color={STATUS[inv.status].color}>{STATUS[inv.status].text}</Tag></Space> : '账单'}
        extra={inv && <Space>
          <Button size="small" onClick={() => void downloadPlatformInvoice(inv.id, inv.invoiceNo)}>下载 CSV</Button>
          {inv.status === 'issued' && (
            <>
              <Button size="small" danger onClick={() => setDisputeOpen(true)}>提出争议</Button>
              <Popconfirm title="确认这张账单？" onConfirm={() => void confirm(inv.id)}>
                <Button size="small" type="primary">确认</Button>
              </Popconfirm>
            </>
          )}
        </Space>}>
        {inv && detail && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {inv.status === 'disputed' && (
              <Alert type="warning" showIcon message={`争议中：${inv.disputeReason ?? ''}`}
                description="平台核对后会重新开票，届时再确认" />
            )}
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="结算周期">{inv.periodStart} ~ {inv.periodEnd}</Descriptions.Item>
              <Descriptions.Item label="币种">{inv.currency}</Descriptions.Item>
              <Descriptions.Item label="规则合计">{inv.grossAmount}</Descriptions.Item>
              <Descriptions.Item label="平台调整">{inv.adjustAmount}</Descriptions.Item>
              <Descriptions.Item label="应付合计">
                <Typography.Text strong>{inv.totalAmount}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="上期结转 / 结转下期">{inv.carryIn} / {inv.carryOut}</Descriptions.Item>
              {inv.note && <Descriptions.Item label="备注" span={2}>{inv.note}</Descriptions.Item>}
            </Descriptions>
            <Table rowKey={(r) => `${r.ruleType}:${r.label}`} size="small" pagination={false} dataSource={detail.items}
              columns={[
                { title: '项目', dataIndex: 'label', width: 170 },
                { title: '计费基数', dataIndex: 'basisAmount', width: 110, align: 'right' },
                { title: '费率', dataIndex: 'ratePct', width: 70, align: 'right',
                  render: (v: number | null) => v === null ? '分档' : `${v}%` },
                { title: '金额', dataIndex: 'amount', width: 110, align: 'right',
                  render: (v: number) => <Typography.Text strong>{v}</Typography.Text> },
                { title: '算法', render: (_, r) => <ItemDetail item={r} /> },
              ]} />
          </Space>
        )}
      </Drawer>

      <Modal title="提出争议" open={disputeOpen} onCancel={() => setDisputeOpen(false)} onOk={submitDispute} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label="争议原因" rules={[{ required: true, message: '请说明哪一项对不上' }]}
            help="写清是哪一项、你算出的数是多少，平台会按对账明细逐日核">
            <Input.TextArea rows={4} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
