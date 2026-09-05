import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Popconfirm,
  Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd'
import {
  createBillingPlan, createBillingRule, deleteBillingRule, listBillingPlans, updateBillingPlan, updateBillingRule,
  type BillingPlan, type BillingRule, type BillingRuleType,
} from '../api'
import { useAuthStore } from '../stores/auth'

export const RULE_LABEL: Record<BillingRuleType, string> = {
  deposit_commission: '充值佣金',
  ggr_share: 'GGR 分成',
  turnover_rebate: '流水返点',
  monthly_fee: '月费',
}

const SCOPE_LABEL: Record<string, string> = { all: '全部', platform: '仅平台代收', tenant: '仅自带通道' }

export function ruleSummary(r: BillingRule): string {
  if (r.ruleType === 'monthly_fee') return `${r.fixedAmount ?? 0} / 月`
  if (r.tiers?.length) {
    const mode = r.tierMode === 'progressive' ? '累进' : '整体'
    return `分档（${mode}）：` + r.tiers.map((t) => `≤${t.upTo ?? '∞'} → ${t.ratePct}%`).join('，')
  }
  return `${r.ratePct ?? 0}%`
}

/** GGR 口径三参数只对 ggr_share 有意义，其他类型的编辑器里不显示，免得让人以为改了有用 */
function ggrHint(r: BillingRule): string {
  const on: string[] = []
  if (r.deductBonus) on.push('扣活动成本')
  if (r.deductCommission) on.push('扣团队佣金')
  if (r.deductChannelFee) on.push('扣通道手续费')
  return `${on.length ? on.join(' / ') : '不扣任何成本（按毛 GGR）'}；${r.carryOver ? '负 GGR 结转下期' : '负 GGR 当期归零'}`
}

interface RuleFormValues {
  ruleType: BillingRuleType
  label: string
  ratePct: number | null
  fixedAmount: number | null
  scope: 'all' | 'platform' | 'tenant'
  tierMode: 'flat' | 'progressive'
  deductBonus: boolean
  deductCommission: boolean
  deductChannelFee: boolean
  carryOver: boolean
  tiersText: string
  venueRatesText: string
  sortOrder: number
}

/**
 * 分成方案与规则（P2-2）。
 *
 * 一个方案 = 多条规则叠加。规则的每个参数都会直接变成客户账单上的一行数字，
 * 所以编辑器里把口径写在旁边 —— 靠记忆填「扣不扣佣金」是出错最快的方式。
 */
export default function BillingPlans() {
  const role = useAuthStore((s) => s.role)
  const readonly = role !== 'platform_super' && role !== 'platform_finance'
  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [loading, setLoading] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [planForm] = Form.useForm()
  const [ruleTarget, setRuleTarget] = useState<{ planId: number; rule: BillingRule | null } | null>(null)
  const [ruleForm] = Form.useForm<RuleFormValues>()

  async function load() {
    setLoading(true)
    try { setPlans(await listBillingPlans()) }
    catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function submitPlan() {
    const v = await planForm.validateFields()
    try {
      await createBillingPlan(v)
      setPlanOpen(false)
      planForm.resetFields()
      await load()
      message.success('方案已创建，接着加规则')
    } catch (e) { message.error((e as Error).message) }
  }

  function openRule(planId: number, rule: BillingRule | null) {
    setRuleTarget({ planId, rule })
    ruleForm.setFieldsValue({
      ruleType: rule?.ruleType ?? 'ggr_share',
      label: rule?.label ?? '',
      ratePct: rule?.ratePct ?? null,
      fixedAmount: rule?.fixedAmount ?? null,
      scope: rule?.scope ?? 'all',
      tierMode: rule?.tierMode ?? 'flat',
      deductBonus: rule?.deductBonus ?? true,
      deductCommission: rule?.deductCommission ?? true,
      deductChannelFee: rule?.deductChannelFee ?? true,
      carryOver: rule?.carryOver ?? true,
      tiersText: rule?.tiers?.length ? rule.tiers.map((t) => `${t.upTo ?? ''}:${t.ratePct}`).join('\n') : '',
      venueRatesText: rule?.venueRates ? Object.entries(rule.venueRates).map(([k, v]) => `${k}:${v}`).join('\n') : '',
      sortOrder: rule?.sortOrder ?? 100,
    })
  }

  async function submitRule() {
    if (!ruleTarget) return
    const v = await ruleForm.validateFields()
    const tiers = v.tiersText.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [upTo, rate] = line.split(':')
      return { upTo: upTo.trim() === '' ? null : Number(upTo), ratePct: Number(rate) }
    })
    const venueRates: Record<string, number> = {}
    for (const line of v.venueRatesText.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [venue, rate] = line.split(':')
      if (venue && Number.isFinite(Number(rate))) venueRates[venue.trim()] = Number(rate)
    }
    const body = {
      ...v,
      tiers: tiers.length > 0 ? tiers : null,
      venueRates: Object.keys(venueRates).length > 0 ? venueRates : null,
    }
    try {
      if (ruleTarget.rule) await updateBillingRule(ruleTarget.rule.id, body)
      else await createBillingRule(ruleTarget.planId, body)
      setRuleTarget(null)
      await load()
      message.success('已保存，下次出账按新规则算（已出的账单不追溯）')
    } catch (e) { message.error((e as Error).message) }
  }

  return (
    <Card title="分成方案" loading={loading}
      extra={!readonly && <Button type="primary" onClick={() => setPlanOpen(true)}>新建方案</Button>}>
      {readonly && <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="只有平台超管与财务能改分成方案，这里只读" />}
      <Alert type="warning" showIcon style={{ marginBottom: 12 }}
        message="改规则只影响未来周期：已生成的账单按当时的规则算，日切快照也已锁定，不会被追溯改写" />

      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {plans.map((p) => (
          <Card key={p.id} size="small" type="inner"
            title={<Space>
              <span>{p.name}</span>
              <Typography.Text code>{p.code}</Typography.Text>
              <Tag color={p.settleMode === 'max_of_fee' ? 'purple' : 'blue'}>
                {p.settleMode === 'max_of_fee' ? '月费保底 max(月费, 分成)' : '月费与分成叠加'}
              </Tag>
              <Tag>{p.settleCurrency}</Tag>
              {p.tenantCount > 0 ? <Tag color="green">{p.tenantCount} 家在用</Tag> : <Tag>未启用</Tag>}
              {!p.enabled && <Tag color="red">已停用</Tag>}
            </Space>}
            extra={!readonly && <Space>
              <Button size="small" onClick={() => openRule(p.id, null)}>加规则</Button>
              <Button size="small" onClick={() => void updateBillingPlan(p.id, { enabled: !p.enabled }).then(load)}>
                {p.enabled ? '停用' : '启用'}
              </Button>
            </Space>}>
            <Table rowKey="id" size="small" pagination={false} dataSource={p.rules}
              locale={{ emptyText: '还没有规则 —— 挂了这个方案的租户出账金额会是 0' }}
              columns={[
                { title: '类型', dataIndex: 'ruleType', width: 110, render: (v: BillingRuleType) => RULE_LABEL[v] },
                { title: '名称', dataIndex: 'label' },
                { title: '费率', render: (_, r) => ruleSummary(r) },
                { title: '范围', dataIndex: 'scope', width: 110,
                  render: (v: string, r) => r.ruleType === 'deposit_commission' ? SCOPE_LABEL[v] : '-' },
                { title: '口径', render: (_, r) => r.ruleType === 'ggr_share'
                  ? <Tooltip title={ggrHint(r)}><Typography.Text type="secondary" ellipsis style={{ maxWidth: 220 }}>
                      {ggrHint(r)}</Typography.Text></Tooltip>
                  : '-' },
                ...(readonly ? [] : [{
                  title: '操作', width: 100,
                  render: (_: unknown, r: BillingRule) => (
                    <Space size={4}>
                      <Button size="small" type="link" onClick={() => openRule(p.id, r)}>改</Button>
                      <Popconfirm title="停用该规则？" description="下次出账不再计这一项，历史账单不变"
                        onConfirm={() => void deleteBillingRule(r.id).then(load)}>
                        <Button size="small" type="link" danger>停用</Button>
                      </Popconfirm>
                    </Space>
                  ),
                }]),
              ]} />
          </Card>
        ))}
      </Space>

      <Modal title="新建分成方案" open={planOpen} onCancel={() => setPlanOpen(false)} onOk={submitPlan} destroyOnClose>
        <Form form={planForm} layout="vertical" initialValues={{ settleMode: 'sum' }}>
          <Form.Item name="code" label="代号" rules={[{ required: true, pattern: /^[a-z0-9_]{2,32}$/, message: '小写字母、数字、下划线' }]}>
            <Input placeholder="rev_share_vip" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="大客户分成" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input placeholder="GGR 20% + 无月费" />
          </Form.Item>
          <Form.Item name="settleMode" label="月费与分成的关系"
            tooltip="max_of_fee 表示月费是保底，实收 max(月费, 分成)；sum 表示两者相加">
            <Select options={[
              { value: 'sum', label: '叠加：月费 + 分成' },
              { value: 'max_of_fee', label: '保底：max(月费, 分成)' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={ruleTarget?.rule ? '修改规则' : '新增规则'} open={ruleTarget !== null} width={620}
        onCancel={() => setRuleTarget(null)} onOk={submitRule} destroyOnClose>
        <Form form={ruleForm} layout="vertical" size="small">
          <Form.Item name="ruleType" label="规则类型" rules={[{ required: true }]}>
            <Select options={(Object.keys(RULE_LABEL) as BillingRuleType[]).map((k) => ({ value: k, label: RULE_LABEL[k] }))} />
          </Form.Item>
          <Form.Item name="label" label="账单上显示的名称" rules={[{ required: true }]}>
            <Input placeholder="GGR 分成 30%" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.ruleType !== b.ruleType}>
            {({ getFieldValue }) => {
              const t = getFieldValue('ruleType') as BillingRuleType
              if (t === 'monthly_fee') {
                return (
                  <Form.Item name="fixedAmount" label="月费（USDT）" rules={[{ required: true }]}
                    tooltip="不足整月按天折算，月中开站不会被收全月">
                    <InputNumber min={0} style={{ width: 160 }} />
                  </Form.Item>
                )
              }
              return (
                <>
                  <Form.Item name="ratePct" label="费率（%）" tooltip="填了分档就以分档为准">
                    <InputNumber min={0} max={100} step={0.1} style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item name="tiersText" label="分档（每行 上限:费率，最高档上限留空）"
                    help="例：100000:3 / 500000:2 / :1">
                    <Input.TextArea rows={3} placeholder={'100000:3\n500000:2\n:1'} />
                  </Form.Item>
                  <Form.Item name="tierMode" label="分档方式">
                    <Select options={[
                      { value: 'flat', label: '整体：落在哪档就全额按该档费率' },
                      { value: 'progressive', label: '累进：每段按各自费率' },
                    ]} />
                  </Form.Item>
                  {t === 'deposit_commission' && (
                    <Form.Item name="scope" label="计费范围"
                      tooltip="混用双资金模式时，平台代收与租户自带通道常谈不同费率">
                      <Select options={[
                        { value: 'all', label: '全部充值' },
                        { value: 'platform', label: '仅平台代收部分' },
                        { value: 'tenant', label: '仅租户自带通道部分' },
                      ]} />
                    </Form.Item>
                  )}
                  {t === 'turnover_rebate' && (
                    <Form.Item name="venueRatesText" label="分场馆费率（每行 场馆:费率）"
                      help="未列出的场馆用上面的费率。场馆名取 BI 的厂商名，如 PG / JILI">
                      <Input.TextArea rows={2} placeholder={'PG:0.8\nJILI:0.5'} />
                    </Form.Item>
                  )}
                  {t === 'ggr_share' && (
                    <>
                      <Form.Item label="GGR 口径" tooltip="签约时逐项确认，账单上会把每一项都列出来">
                        <Space direction="vertical">
                          <Form.Item name="deductBonus" valuePropName="checked" noStyle>
                            <Checkbox>扣活动成本（彩金/红包/返水/VIP/任务）</Checkbox>
                          </Form.Item>
                          <Form.Item name="deductCommission" valuePropName="checked" noStyle>
                            <Checkbox>扣团队佣金</Checkbox>
                          </Form.Item>
                          <Form.Item name="deductChannelFee" valuePropName="checked" noStyle>
                            <Checkbox>扣通道手续费（只有平台代收的通道才有）</Checkbox>
                          </Form.Item>
                          <Form.Item name="carryOver" valuePropName="checked" noStyle>
                            <Checkbox>负 GGR 结转下期（关掉=亏损月当期归零，客户下月赚回来照抽）</Checkbox>
                          </Form.Item>
                        </Space>
                      </Form.Item>
                    </>
                  )}
                </>
              )
            }}
          </Form.Item>
          <Form.Item name="sortOrder" label="账单上的排序" tooltip="小的在前。月费一般放最后">
            <InputNumber min={0} max={999} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
