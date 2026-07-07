import { useEffect, useState } from 'react'
import {
  Button, Card, Col, Collapse, Form, Input, InputNumber, message, Row, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography,
} from 'antd'
import { GiftOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  getSpinConfig,
  getSpinRecords,
  saveSpinConfig,
  type SpinConfig,
  type SpinDepositRule,
  type SpinPrize,
  type SpinRecord,
} from '../api'
import { SPIN_PRIZE_IMAGES } from '../assets/spin/prizeImages'

const { Title, Text } = Typography

const LEVEL_COUNT = 6
const CHECKIN_INDEX = LEVEL_COUNT // 签到专用档位固定排在存款档位之后
const PRIZE_COUNT = 8
const DEFAULT_AMOUNTS = [108, 580, 1080, 2000, 5000, 10000]
const PRIZE_SLOTS = Array.from({ length: PRIZE_COUNT }, (_, i) => i)
const IMAGE_OPTIONS = Array.from({ length: PRIZE_COUNT }, (_, i) => {
  const value = `prize-${i + 1}`
  return {
    value,
    label: `奖品图 ${i + 1}`,
    image: SPIN_PRIZE_IMAGES[value],
  }
})

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
  { title: '入账金额', dataIndex: 'amountPhp', width: 120, render: (v) => <b>₱{Number(v).toFixed(2)}</b> },
  { title: '中奖时间', dataIndex: 'createdAt', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN', { hour12: false }) },
]

function prizeFlatIndex(ruleIndex: number, prizeIndex: number): number {
  return ruleIndex * PRIZE_COUNT + prizeIndex
}

function defaultRule(i: number): SpinDepositRule {
  const amount = DEFAULT_AMOUNTS[i] ?? (i + 1) * 1000
  return {
    kind: 'deposit',
    name: `Deposit ${amount}`,
    minDepositPhp: amount,
    depositAmountPhp: amount,
    maxDepositPhp: null,
    chances: 1,
    enabled: true,
    sortOrder: (i + 1) * 10,
  }
}

function defaultCheckinRule(): SpinDepositRule {
  return {
    kind: 'checkin',
    name: 'Check-in',
    minDepositPhp: 0,
    depositAmountPhp: 0,
    maxDepositPhp: null,
    chances: 1,
    enabled: true,
    sortOrder: 900,
  }
}

function defaultPrize(ruleId: number | null | undefined, i: number): SpinPrize {
  const amount = [7.77, 17.77, 77.77, 277.77, 777.77, 1777, 7777, 17777][i] ?? 7.77
  return {
    ruleId,
    name: `₱${amount.toLocaleString('en-PH')}`,
    imageKey: `prize-${i + 1}`,
    amountPhp: amount,
    weight: i < 2 ? 3000 : i < 5 ? 800 : 100,
    turnoverX: i < 2 ? 1 : i < 5 ? 3 : 8,
    enabled: true,
    sortOrder: (i + 1) * 10,
  }
}

function prizesForRule(config: SpinConfig, rule: SpinDepositRule, ruleIndex: number): SpinPrize[] {
  const byRuleId = config.prizes
    .filter((p) => rule.id != null && Number(p.ruleId) === Number(rule.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id ?? 0) - Number(b.id ?? 0))
  const byPosition = config.prizes.slice(
    prizeFlatIndex(ruleIndex, 0),
    prizeFlatIndex(ruleIndex, 0) + PRIZE_COUNT,
  )
  const source = byRuleId.length > 0 ? byRuleId : byPosition
  return Array.from({ length: PRIZE_COUNT }, (_, i) => ({
    ...defaultPrize(rule.id, i),
    ...source[i],
    ruleId: rule.id,
    imageKey: source[i]?.imageKey || `prize-${i + 1}`,
    sortOrder: (i + 1) * 10,
  }))
}

function normalizeConfig(config: SpinConfig): SpinConfig {
  const depositExisting = config.depositRules.filter((r) => r.kind !== 'checkin')
  const depositRules = Array.from({ length: LEVEL_COUNT }, (_, i) => {
    const existing = depositExisting[i]
    const amount = Number(existing?.depositAmountPhp ?? existing?.minDepositPhp ?? DEFAULT_AMOUNTS[i])
    return {
      ...defaultRule(i),
      ...existing,
      kind: 'deposit' as const,
      name: `Deposit ${Math.round(amount)}`,
      minDepositPhp: amount,
      depositAmountPhp: amount,
      maxDepositPhp: null,
      chances: 1,
      sortOrder: (i + 1) * 10,
    }
  })

  const checkinExisting = config.depositRules.find((r) => r.kind === 'checkin')
  const checkinRule: SpinDepositRule = {
    ...defaultCheckinRule(),
    ...checkinExisting,
    kind: 'checkin',
    name: 'Check-in',
    minDepositPhp: 0,
    depositAmountPhp: 0,
    maxDepositPhp: null,
    chances: 1,
    sortOrder: 900,
  }

  const rules = [...depositRules, checkinRule]
  const prizes = rules.flatMap((rule, ruleIndex) => prizesForRule(config, rule, ruleIndex))

  return { enabled: config.enabled, depositRules: rules, prizes }
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

function PrizeTable({ ruleIndex }: { ruleIndex: number }) {
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
          title: '奖金 PHP',
          width: 130,
          render: (_, __, slot) => (
            <Form.Item name={['prizes', prizeFlatIndex(ruleIndex, slot), 'amountPhp']} noStyle rules={[{ required: true, type: 'number', min: 0.01 }]}>
              <InputNumber prefix="₱" min={0.01} precision={2} style={{ width: '100%' }} />
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
  const [userId, setUserId] = useState('')
  const [form] = Form.useForm<SpinConfig>()
  const watchedRules = Form.useWatch('depositRules', form) ?? []

  async function loadConfig() {
    setLoading(true)
    try {
      form.setFieldsValue(normalizeConfig(await getSpinConfig()))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadRecords(page = recordPage, uid = userId) {
    setRecordsLoading(true)
    try {
      const res = await getSpinRecords({ page, pageSize: 20, userId: uid.trim() || undefined })
      setRecords(res.items)
      setRecordTotal(res.total)
      setRecordPage(res.page)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '记录加载失败')
    } finally {
      setRecordsLoading(false)
    }
  }

  useEffect(() => {
    void loadConfig()
    void loadRecords(1)
  }, [])

  async function handleSave() {
    let values: SpinConfig
    try { values = await form.validateFields() } catch { return }
    const normalized = normalizeConfig(values)
    setSaving(true)
    try {
      form.setFieldsValue(normalizeConfig(await saveSpinConfig(normalized)))
      message.success('转盘配置已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>

  return (
    <div style={{ maxWidth: 1180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <GiftOutlined style={{ fontSize: 20, color: '#faad14' }} />
        <Title level={4} style={{ margin: 0 }}>转盘抽奖</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>固定 6 个存款级别，每笔 paid PHP 存款只发放命中的最高级别 1 次机会</Text>
      </div>

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

                <Card title="存款级别" style={{ marginBottom: 16 }}>
                  <Text type="secondary">客户端固定显示为 DEPOSIT {'{金额}'}。单次存款达到多个级别时，只发放最高级别 1 次机会。</Text>
                  <div style={{ marginTop: 16 }}>
                    {Array.from({ length: LEVEL_COUNT }, (_, ruleIndex) => {
                      const rule = watchedRules[ruleIndex]
                      return (
                        <Collapse
                          key={ruleIndex}
                          style={{ marginBottom: 12 }}
                          items={[{
                            key: String(ruleIndex),
                            forceRender: true,
                            label: (
                              <Space>
                                <b>存款级别 {ruleIndex + 1}</b>
                                <Tag color={rule?.enabled ? 'green' : 'default'}>{rule?.enabled ? '启用' : '关闭'}</Tag>
                                <Tag color="blue">DEPOSIT {Number(rule?.depositAmountPhp ?? rule?.minDepositPhp ?? DEFAULT_AMOUNTS[ruleIndex]).toLocaleString('en-PH')}</Tag>
                              </Space>
                            ),
                            children: (
                              <>
                                <Form.Item name={['depositRules', ruleIndex, 'id']} hidden><InputNumber /></Form.Item>
                                <Form.Item name={['depositRules', ruleIndex, 'name']} hidden><Input /></Form.Item>
                                <Form.Item name={['depositRules', ruleIndex, 'sortOrder']} hidden><InputNumber /></Form.Item>
                                <Row gutter={16}>
                                  <Col span={8}>
                                    <Form.Item label="达标金额 PHP" name={['depositRules', ruleIndex, 'depositAmountPhp']} rules={[{ required: true, type: 'number', min: 1 }]}>
                                      <InputNumber prefix="₱" min={1} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                  </Col>
                                  <Col span={4}>
                                    <Form.Item label="启用" name={['depositRules', ruleIndex, 'enabled']} valuePropName="checked">
                                      <Switch />
                                    </Form.Item>
                                  </Col>
                                </Row>
                                <PrizeTable ruleIndex={ruleIndex} />
                              </>
                            ),
                          }]}
                        />
                      )
                    })}
                  </div>
                </Card>

                <Card
                  title={(
                    <Space>
                      签到专用档位
                      <Tag color="purple">CHECK-IN</Tag>
                      <Tag color={watchedRules[CHECKIN_INDEX]?.enabled ? 'green' : 'default'}>
                        {watchedRules[CHECKIN_INDEX]?.enabled ? '启用' : '关闭'}
                      </Tag>
                    </Space>
                  )}
                  style={{ marginBottom: 16 }}
                >
                  <Text type="secondary">每日签到发放的转盘次数进入此档位（客户端显示为「签到」，排在存款档位之后）。</Text>
                  <div style={{ marginTop: 16 }}>
                    <Form.Item name={['depositRules', CHECKIN_INDEX, 'id']} hidden><InputNumber /></Form.Item>
                    <Form.Item name={['depositRules', CHECKIN_INDEX, 'kind']} hidden><Input /></Form.Item>
                    <Form.Item name={['depositRules', CHECKIN_INDEX, 'name']} hidden><Input /></Form.Item>
                    <Form.Item name={['depositRules', CHECKIN_INDEX, 'sortOrder']} hidden><InputNumber /></Form.Item>
                    <Form.Item label="启用" name={['depositRules', CHECKIN_INDEX, 'enabled']} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <PrizeTable ruleIndex={CHECKIN_INDEX} />
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
                    pageSize: 20,
                    total: recordTotal,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (p) => void loadRecords(p),
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
