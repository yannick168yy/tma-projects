import { useEffect, useState } from 'react'
import {
  Button, Card, Col, Form, Input, InputNumber, message, Row, Space, Spin, Switch, Table, Tabs, Tag, Typography,
} from 'antd'
import { GiftOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  getSpinConfig,
  getSpinRecords,
  saveSpinConfig,
  type SpinConfig,
  type SpinRecord,
} from '../api'

const { Title, Text } = Typography

const emptyRule = { minDepositPhp: 108, chances: 1, enabled: true, sortOrder: 10 }
const emptyPrize = { name: '₱7.77', amountPhp: 7.77, weight: 100, turnoverX: 1, enabled: true, sortOrder: 10 }

const recordColumns: ColumnsType<SpinRecord> = [
  { title: '记录ID', dataIndex: 'id', width: 170, render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
  { title: '用户', dataIndex: 'userId', width: 130, render: (id, r) => (
    <span><div style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</div><div style={{ color: '#999', fontSize: 12 }}>{r.displayName}</div></span>
  ) },
  { title: '奖品', dataIndex: 'prizeName', width: 120, render: (v) => <Tag color="gold">{v}</Tag> },
  { title: '入账金额', dataIndex: 'amountPhp', width: 120, render: (v) => <b>₱{Number(v).toFixed(2)}</b> },
  { title: '中奖时间', dataIndex: 'createdAt', width: 170, render: (v) => new Date(v).toLocaleString('zh-CN', { hour12: false }) },
]

export default function RewardsSpin() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [records, setRecords] = useState<SpinRecord[]>([])
  const [recordTotal, setRecordTotal] = useState(0)
  const [recordPage, setRecordPage] = useState(1)
  const [userId, setUserId] = useState('')
  const [form] = Form.useForm<SpinConfig>()

  async function loadConfig() {
    setLoading(true)
    try {
      form.setFieldsValue(await getSpinConfig())
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
    setSaving(true)
    try {
      form.setFieldsValue(await saveSpinConfig(values))
      message.success('转盘配置已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <GiftOutlined style={{ fontSize: 20, color: '#faad14' }} />
        <Title level={4} style={{ margin: 0 }}>转盘抽奖</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>按 paid deposit 发放机会，中奖直接入 PHP 钱包</Text>
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

                <Card title="存款达标发放机会" style={{ marginBottom: 16 }}>
                  <Form.List name="depositRules">
                    {(fields, { add, remove }) => (
                      <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        {fields.map((field) => (
                          <Card key={field.key} size="small">
                            <Form.Item name={[field.name, 'id']} hidden><InputNumber /></Form.Item>
                            <Row gutter={16}>
                              <Col span={6}>
                                <Form.Item label="最低存款 PHP" name={[field.name, 'minDepositPhp']} rules={[{ required: true, type: 'number', min: 1 }]}>
                                  <InputNumber prefix="₱" min={1} precision={2} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={5}>
                                <Form.Item label="机会次数" name={[field.name, 'chances']} rules={[{ required: true, type: 'number', min: 1 }]}>
                                  <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={5}>
                                <Form.Item label="排序" name={[field.name, 'sortOrder']} rules={[{ required: true, type: 'number' }]}>
                                  <InputNumber precision={0} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={4}>
                                <Form.Item label="启用" name={[field.name, 'enabled']} valuePropName="checked">
                                  <Switch />
                                </Form.Item>
                              </Col>
                              <Col span={4}>
                                <Form.Item label="操作">
                                  <Button danger onClick={() => remove(field.name)}>移除</Button>
                                </Form.Item>
                              </Col>
                            </Row>
                          </Card>
                        ))}
                        <Button icon={<PlusOutlined />} onClick={() => add(emptyRule)}>新增档位</Button>
                      </Space>
                    )}
                  </Form.List>
                </Card>

                <Card title="奖品与流水要求" style={{ marginBottom: 16 }}>
                  <Form.List name="prizes">
                    {(fields, { add, remove }) => (
                      <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        {fields.map((field) => (
                          <Card key={field.key} size="small">
                            <Form.Item name={[field.name, 'id']} hidden><InputNumber /></Form.Item>
                            <Row gutter={16}>
                              <Col span={5}>
                                <Form.Item label="展示名称" name={[field.name, 'name']} rules={[{ required: true }]}>
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col span={4}>
                                <Form.Item label="奖金 PHP" name={[field.name, 'amountPhp']} rules={[{ required: true, type: 'number', min: 0.01 }]}>
                                  <InputNumber prefix="₱" min={0.01} precision={2} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={4}>
                                <Form.Item label="权重" name={[field.name, 'weight']} rules={[{ required: true, type: 'number', min: 1 }]}>
                                  <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={4}>
                                <Form.Item label="流水倍率" name={[field.name, 'turnoverX']} rules={[{ required: true, type: 'number', min: 0 }]}>
                                  <InputNumber suffix="x" min={0} precision={2} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={3}>
                                <Form.Item label="排序" name={[field.name, 'sortOrder']} rules={[{ required: true, type: 'number' }]}>
                                  <InputNumber precision={0} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={2}>
                                <Form.Item label="启用" name={[field.name, 'enabled']} valuePropName="checked">
                                  <Switch />
                                </Form.Item>
                              </Col>
                              <Col span={2}>
                                <Form.Item label="操作">
                                  <Button danger onClick={() => remove(field.name)}>移除</Button>
                                </Form.Item>
                              </Col>
                            </Row>
                          </Card>
                        ))}
                        <Button icon={<PlusOutlined />} onClick={() => add(emptyPrize)}>新增奖品</Button>
                      </Space>
                    )}
                  </Form.List>
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
