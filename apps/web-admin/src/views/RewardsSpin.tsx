import { useEffect, useState } from 'react'
import {
  Button, Card, Collapse, Form, Input, InputNumber, message, Segmented, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography,
} from 'antd'
import { GiftOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  getSpinConfig,
  getSpinRecords,
  saveSpinConfig,
  CONFIG_CCY_OPTIONS,
  type SpinConfig,
  type SpinDepositRule,
  type SpinPrize,
  type SpinRecord,
} from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'
import { SPIN_PRIZE_IMAGES } from '../assets/spin/prizeImages'

const { Title, Text } = Typography

const CHECKIN_TIERS = ['starter', 'premium', 'elite'] as const
type CheckinTier = (typeof CHECKIN_TIERS)[number]
const CHECKIN_TIER_LABEL: Record<CheckinTier, string> = { starter: '初级', premium: '中级', elite: '高级' }
const PRIZE_COUNT = 8
const PRIZE_SLOTS = Array.from({ length: PRIZE_COUNT }, (_, i) => i)
const IMAGE_OPTIONS = Array.from({ length: PRIZE_COUNT }, (_, i) => {
  const value = `prize-${i + 1}`
  return {
    value,
    label: `奖品图 ${i + 1}`,
    image: SPIN_PRIZE_IMAGES[value],
  }
})

function currencyPrefix(currency: string): string {
  if (currency === 'PHP') return '₱'
  if (currency === 'IDR') return 'Rp'
  return currency
}

function formatAmount(amount: number, currency: string): string {
  return `${currencyPrefix(currency)}${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: currency === 'IDR' ? 0 : 2,
    maximumFractionDigits: currency === 'IDR' ? 0 : 4,
  })}`
}

function PrizeImageSelect({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={IMAGE_OPTIONS}
      optionRender={(option) => (
        <Space>
          <img src={option.data.image} alt="" width={36} height={36} style={{ objectFit: 'contain' }} />
          <span>{option.label}</span>
        </Space>
      )}
      labelRender={(option) => (
        <Space>
          <img src={SPIN_PRIZE_IMAGES[String(option.value)]} alt="" width={28} height={28} style={{ objectFit: 'contain' }} />
          <span>{option.label}</span>
        </Space>
      )}
    />
  )
}

const recordColumns: ColumnsType<SpinRecord> = [
  { title: '记录ID', dataIndex: 'id', width: 170, render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
  { title: '用户', dataIndex: 'userId', width: 130, render: (id, r) => (
    <span><div style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</div><div style={{ color: '#999', fontSize: 12 }}>{r.displayName}</div></span>
  ) },
  { title: '奖品', dataIndex: 'prizeName', width: 120, render: (v) => <Tag color="gold">{v}</Tag> },
  { title: '入账金额', dataIndex: 'amountPhp', width: 140, render: (v, r) => <b>{formatAmount(Number(v), r.currency)}</b> },
  { title: '中奖时间', dataIndex: 'createdAt', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN', { hour12: false }) },
]

function prizeFlatIndex(ruleIndex: number, prizeIndex: number): number {
  return ruleIndex * PRIZE_COUNT + prizeIndex
}

function defaultCheckinRule(tier: CheckinTier, tierIndex: number): SpinDepositRule {
  return {
    kind: 'checkin',
    checkinTier: tier,
    name: `Check-in ${tier[0].toUpperCase()}${tier.slice(1)}`,
    minDepositPhp: 0,
    depositAmountPhp: 0,
    maxDepositPhp: null,
    chances: 1,
    enabled: true,
    sortOrder: 900 + tierIndex * 10,
  }
}

function defaultPrize(ruleId: number | null | undefined, i: number, currency: string): SpinPrize {
  const phpAmount = [7.77, 17.77, 77.77, 277.77, 777.77, 1777, 7777, 17777][i] ?? 7.77
  const amount = currency === 'IDR' ? Math.max(100, Math.round(phpAmount * 287 / 100) * 100) : phpAmount
  return {
    ruleId,
    name: formatAmount(amount, currency),
    imageKey: `prize-${i + 1}`,
    amountPhp: amount,
    weight: i < 2 ? 3000 : i < 5 ? 800 : 100,
    turnoverX: i < 2 ? 1 : i < 5 ? 3 : 8,
    enabled: true,
    sortOrder: (i + 1) * 10,
  }
}

function prizesForRule(config: SpinConfig, rule: SpinDepositRule, ruleIndex: number, currency: string): SpinPrize[] {
  const byRuleId = config.prizes
    .filter((p) => rule.id != null && Number(p.ruleId) === Number(rule.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id ?? 0) - Number(b.id ?? 0))
  const byPosition = config.prizes.slice(
    prizeFlatIndex(ruleIndex, 0),
    prizeFlatIndex(ruleIndex, 0) + PRIZE_COUNT,
  )
  const source = byRuleId.length > 0 ? byRuleId : byPosition
  return Array.from({ length: PRIZE_COUNT }, (_, i) => ({
    ...defaultPrize(rule.id, i, currency),
    ...source[i],
    ruleId: rule.id,
    imageKey: source[i]?.imageKey || `prize-${i + 1}`,
    sortOrder: (i + 1) * 10,
  }))
}

function normalizeConfig(config: SpinConfig, currency: string): SpinConfig {
  const checkinRules = CHECKIN_TIERS.map((tier, tierIndex) => {
    const existing = config.depositRules.find((r) => r.kind === 'checkin' && r.checkinTier === tier)
    return {
      ...defaultCheckinRule(tier, tierIndex),
      ...existing,
      kind: 'checkin' as const,
      checkinTier: tier,
      name: `Check-in ${tier[0].toUpperCase()}${tier.slice(1)}`,
      minDepositPhp: 0,
      depositAmountPhp: 0,
      maxDepositPhp: null,
      chances: 1,
      sortOrder: 900 + tierIndex * 10,
    }
  })

  const prizes = checkinRules.flatMap((rule, ruleIndex) => prizesForRule(config, rule, ruleIndex, currency))

  return { enabled: config.enabled, depositRules: checkinRules, prizes }
}

function PrizeRowFields({ flatIndex }: { flatIndex: number }) {
  return (
    <>
      <Form.Item name={['prizes', flatIndex, 'id']} hidden><InputNumber /></Form.Item>
      <Form.Item name={['prizes', flatIndex, 'ruleId']} hidden><InputNumber /></Form.Item>
      <Form.Item name={['prizes', flatIndex, 'sortOrder']} hidden><InputNumber /></Form.Item>
    </>
  )
}

function PrizeTable({ ruleIndex, currency }: { ruleIndex: number; currency: string }) {
  return (
    <Table
      rowKey={(slot) => String(slot)}
      pagination={false}
      size="small"
      dataSource={PRIZE_SLOTS}
      columns={[
        { title: '位置', width: 60, render: (_, __, slot) => slot + 1 },
        {
          title: '奖品图',
          width: 130,
          render: (_, __, slot) => {
            const flatIndex = prizeFlatIndex(ruleIndex, slot)
            return (
              <>
                <PrizeRowFields flatIndex={flatIndex} />
                <Form.Item name={['prizes', flatIndex, 'imageKey']} noStyle rules={[{ required: true }]}>
                  <PrizeImageSelect />
                </Form.Item>
              </>
            )
          },
        },
        {
          title: '展示名称',
          render: (_, __, slot) => (
            <Form.Item name={['prizes', prizeFlatIndex(ruleIndex, slot), 'name']} noStyle rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          ),
        },
        {
          title: `奖金 ${currency}`,
          width: 130,
          render: (_, __, slot) => (
            <Form.Item name={['prizes', prizeFlatIndex(ruleIndex, slot), 'amountPhp']} noStyle rules={[{ required: true, type: 'number', min: 0.01 }]}>
              <InputNumber prefix={currencyPrefix(currency)} min={currency === 'IDR' ? 100 : 0.01} precision={currency === 'IDR' ? 0 : 2} style={{ width: '100%' }} />
            </Form.Item>
          ),
        },
        {
          title: '权重',
          width: 110,
          render: (_, __, slot) => (
            <Form.Item name={['prizes', prizeFlatIndex(ruleIndex, slot), 'weight']} noStyle rules={[{ required: true, type: 'number', min: 1 }]}>
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          ),
        },
        {
          title: '流水倍率',
          width: 120,
          render: (_, __, slot) => (
            <Form.Item name={['prizes', prizeFlatIndex(ruleIndex, slot), 'turnoverX']} noStyle rules={[{ required: true, type: 'number', min: 0 }]}>
              <InputNumber suffix="x" min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          ),
        },
        {
          title: '启用',
          width: 80,
          render: (_, __, slot) => (
            <Form.Item name={['prizes', prizeFlatIndex(ruleIndex, slot), 'enabled']} noStyle valuePropName="checked">
              <Switch size="small" />
            </Form.Item>
          ),
        },
      ]}
    />
  )
}

export default function RewardsSpin() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [records, setRecords] = useState<SpinRecord[]>([])
  const [recordTotal, setRecordTotal] = useState(0)
  const [recordPage, setRecordPage] = useState(1)
  const [recordPageSize, setRecordPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [userId, setUserId] = useState('')
  const [currency, setCurrency] = useState<string>('PHP')
  const [form] = Form.useForm<SpinConfig>()
  const watchedRules = Form.useWatch('depositRules', form) ?? []

  async function loadConfig(cur = currency) {
    setLoading(true)
    try {
      form.setFieldsValue(normalizeConfig(await getSpinConfig(cur), cur))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadRecords(page = recordPage, uid = userId, ps = recordPageSize) {
    setRecordsLoading(true)
    try {
      const res = await getSpinRecords({ page, pageSize: ps, userId: uid.trim() || undefined })
      setRecords(res.items)
      setRecordTotal(res.total)
      setRecordPage(res.page)
      setRecordPageSize(ps)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '记录加载失败')
    } finally {
      setRecordsLoading(false)
    }
  }

  useEffect(() => {
    void loadConfig(currency)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency])
  useEffect(() => { void loadRecords(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function handleSave() {
    let values: SpinConfig
    try { values = await form.validateFields() } catch { return }
    const normalized = normalizeConfig(values, currency)
    setSaving(true)
    try {
      form.setFieldsValue(normalizeConfig(await saveSpinConfig(normalized, currency), currency))
      message.success(`转盘配置已保存（${currency}）`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>

  return (
    <div style={{ maxWidth: 1180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <GiftOutlined style={{ fontSize: 20, color: '#faad14' }} />
        <Title level={4} style={{ margin: 0 }}>每日签到转盘</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>签到三档独立奖池，用户按连签档位获得转盘次数并在对应奖池兑奖</Text>
      </div>
      <Space style={{ marginBottom: 16 }} align="center">
        <Text strong>币种：</Text>
        <Segmented value={currency} onChange={(v) => setCurrency(String(v))} options={CONFIG_CCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <Text type="secondary" style={{ fontSize: 12 }}>每币种一套独立奖池，抽奖按用户当前币种发对应币种奖金；切换即加载该币种奖池</Text>
      </Space>

      <Tabs
        items={[
          {
            key: 'config',
            label: '抽奖配置',
            children: (
              <Form form={form} layout="vertical" requiredMark={false}>
                <Card style={{ marginBottom: 16 }}>
                  <Form.Item name="enabled" valuePropName="checked" label="活动开关">
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Card>

                <Card title="签到专用档位（三档独立奖池）" style={{ marginBottom: 16 }}>
                  <Text type="secondary">每日签到按连签档位发放转盘次数，进入对应 tier 的奖池。客户端签到页显示为「初级/中级/高级」三个 tab。</Text>
                  <div style={{ marginTop: 16 }}>
                    {CHECKIN_TIERS.map((tier, tierIndex) => {
                      const ruleIndex = tierIndex
                      const rule = watchedRules[ruleIndex]
                      return (
                        <Collapse
                          key={tier}
                          style={{ marginBottom: 12 }}
                          items={[{
                            key: tier,
                            forceRender: true,
                            label: (
                              <Space>
                                <b>签到{CHECKIN_TIER_LABEL[tier]}档</b>
                                <Tag color="purple">{tier.toUpperCase()}</Tag>
                                <Tag color={rule?.enabled ? 'green' : 'default'}>{rule?.enabled ? '启用' : '关闭'}</Tag>
                              </Space>
                            ),
                            children: (
                              <>
                                <Form.Item name={['depositRules', ruleIndex, 'id']} hidden><InputNumber /></Form.Item>
                                <Form.Item name={['depositRules', ruleIndex, 'kind']} hidden><Input /></Form.Item>
                                <Form.Item name={['depositRules', ruleIndex, 'checkinTier']} hidden><Input /></Form.Item>
                                <Form.Item name={['depositRules', ruleIndex, 'name']} hidden><Input /></Form.Item>
                                <Form.Item name={['depositRules', ruleIndex, 'sortOrder']} hidden><InputNumber /></Form.Item>
                                <Form.Item label="启用" name={['depositRules', ruleIndex, 'enabled']} valuePropName="checked">
                                  <Switch />
                                </Form.Item>
                                <PrizeTable ruleIndex={ruleIndex} currency={currency} />
                              </>
                            ),
                          }]}
                        />
                      )
                    })}
                  </div>
                </Card>

                <Button type="primary" size="large" loading={saving} onClick={handleSave}>保存配置</Button>
              </Form>
            ),
          },
          {
            key: 'records',
            label: '中奖记录',
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Input value={userId} placeholder="用户ID" allowClear onChange={(e) => setUserId(e.target.value)} style={{ width: 180 }} />
                  <Button onClick={() => void loadRecords(1)}>查询</Button>
                </Space>
                <Table<SpinRecord>
                  rowKey="id"
                  loading={recordsLoading}
                  dataSource={records}
                  columns={recordColumns}
                  pagination={{
                    current: recordPage,
                    pageSize: recordPageSize,
                    total: recordTotal,
                    showTotal: (t) => `共 ${t} 条`,
                    pageSizeOptions: PAGE_SIZE_OPTIONS,
                    onChange: (p, ps) => void loadRecords(p, userId, ps),
                  }}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  )
}
