import { useEffect, useState } from 'react'
import {
  Card, Form, InputNumber, Switch, Button, message, Typography,
  Row, Col, Spin, Table, Tag, Space, Input, DatePicker, Tabs,
  Popconfirm, Select, Modal,
} from 'antd'
import { PercentageOutlined, StarOutlined, DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  getRebateConfig, saveRebateConfig,
  getFeaturedGames, addFeaturedGame, removeFeaturedGame,
  triggerRebatePayout, getRebateRecords,
  type RebateConfigItem, type RebateFeaturedGame, type RebateRecord,
} from '../api'

const { Title, Text } = Typography

const CATEGORY_LABELS: Record<string, string> = {
  slots: '🎰 Slots',
  live: '🎲 Live Casino',
  sports: '⚽ Sports',
  fishing: '🐟 Fishing',
  table: '🃏 Table / Poker',
  bingo: '🎱 Bingo',
  crash: '🚀 Crash',
  pinoy: '🐓 Pinoy',
  other: '🎮 Other',
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  elite: { label: '⭐ Elite (2%)', color: 'gold' },
  pro: { label: '✨ Pro (1.5%)', color: 'blue' },
}

export default function Rebate() {
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configItems, setConfigItems] = useState<RebateConfigItem[]>([])

  const [featuredGames, setFeaturedGames] = useState<RebateFeaturedGame[]>([])
  const [featuredLoading, setFeaturedLoading] = useState(false)

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addForm] = Form.useForm<{ gameUuid: string; tier: string; sortOrder: number }>()
  const [addLoading, setAddLoading] = useState(false)

  const [records, setRecords] = useState<RebateRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsDate, setRecordsDate] = useState<string | undefined>()
  const [recordsUser, setRecordsUser] = useState('')

  const [payoutLoading, setPayoutLoading] = useState(false)

  async function loadConfig() {
    setConfigLoading(true)
    try {
      const res = await getRebateConfig()
      setConfigItems(res.config)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setConfigLoading(false) }
  }

  async function loadFeatured() {
    setFeaturedLoading(true)
    try {
      const res = await getFeaturedGames()
      setFeaturedGames(res.games)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setFeaturedLoading(false) }
  }

  async function loadRecords(page = 1) {
    setRecordsLoading(true)
    try {
      const res = await getRebateRecords({
        page,
        pageSize: 50,
        date: recordsDate,
        userId: recordsUser || undefined,
      })
      setRecords(res.items)
      setRecordsTotal(res.total)
      setRecordsPage(page)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setRecordsLoading(false) }
  }

  useEffect(() => {
    void loadConfig()
    void loadFeatured()
    void loadRecords()
  }, [])

  function updateItem(category: string, field: 'ratePct' | 'enabled', value: number | boolean) {
    setConfigItems((prev) => prev.map((item) =>
      item.gameCategory === category ? { ...item, [field]: value } : item
    ))
  }

  async function handleSaveConfig() {
    setConfigSaving(true)
    try {
      await saveRebateConfig(configItems)
      message.success('洗码费率已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setConfigSaving(false) }
  }

  async function handleRemoveFeatured(id: number) {
    try {
      await removeFeaturedGame(id)
      message.success('已移除')
      void loadFeatured()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  async function handleAddFeatured() {
    let values: { gameUuid: string; tier: string; sortOrder: number }
    try { values = await addForm.validateFields() } catch { return }
    setAddLoading(true)
    try {
      await addFeaturedGame(values)
      message.success('精选游戏已添加')
      setAddModalOpen(false)
      addForm.resetFields()
      void loadFeatured()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '添加失败')
    } finally { setAddLoading(false) }
  }

  async function handleManualPayout() {
    const date = recordsDate ?? dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    setPayoutLoading(true)
    try {
      const res = await triggerRebatePayout(date)
      message.success(`已派发 ${date}：${res.users} 用户，共 ₱${Number(res.totalRebate).toFixed(4)}`)
      void loadRecords()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '派发失败')
    } finally { setPayoutLoading(false) }
  }

  const configTab = (
    <Spin spinning={configLoading}>
      <Card
        title={<span><PercentageOutlined /> 各游戏大类洗码费率</span>}
        extra={<Button type="primary" loading={configSaving} onClick={handleSaveConfig}>保存费率</Button>}
        style={{ marginBottom: 16 }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          每日凌晨（PHT 00:00）自动按下注流水 × 费率派发洗码到余额，无流水要求。
        </Text>
        <Row gutter={[16, 16]}>
          {configItems.map((item) => (
            <Col key={item.gameCategory} xs={24} sm={12} md={8}>
              <Card size="small" style={{ background: '#fafafa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong>{CATEGORY_LABELS[item.gameCategory] ?? item.gameCategory}</Text>
                  <Switch
                    size="small"
                    checked={item.enabled}
                    onChange={(v) => updateItem(item.gameCategory, 'enabled', v)}
                    checkedChildren="开" unCheckedChildren="关"
                  />
                </div>
                <InputNumber
                  value={item.ratePct}
                  onChange={(v) => { if (v !== null) updateItem(item.gameCategory, 'ratePct', v) }}
                  min={0} max={10} step={0.1} precision={3}
                  suffix="%" style={{ width: '100%' }}
                  disabled={!item.enabled}
                />
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    </Spin>
  )

  const featuredTab = (
    <Spin spinning={featuredLoading}>
      <Card
        title={<span><StarOutlined /> Cashback Games 精选游戏</span>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
            添加游戏
          </Button>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          配置 C 端"Cashback Games"展示区的精选游戏。Elite = 2% 噱头档，Pro = 1.5% 噱头档，仅为展示分组，不影响实际洗码计算。
        </Text>
        <Table
          dataSource={featuredGames}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            { title: '游戏名称', dataIndex: 'name', key: 'name', render: (v, r) => v ?? r.gameUuid },
            { title: '厂商', dataIndex: 'provider', key: 'provider' },
            {
              title: '档位', dataIndex: 'tier', key: 'tier',
              render: (v: string) => <Tag color={TIER_LABELS[v]?.color ?? 'default'}>{TIER_LABELS[v]?.label ?? v}</Tag>,
            },
            { title: '排序', dataIndex: 'sortOrder', key: 'sortOrder' },
            {
              title: '操作', key: 'action',
              render: (_, r) => (
                <Popconfirm title="确认移除？" onConfirm={() => void handleRemoveFeatured(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="添加精选游戏"
        open={addModalOpen}
        onOk={handleAddFeatured}
        onCancel={() => setAddModalOpen(false)}
        confirmLoading={addLoading}
        okText="添加"
        cancelText="取消"
      >
        <Form form={addForm} layout="vertical" requiredMark={false}>
          <Form.Item label="游戏 UUID" name="gameUuid" rules={[{ required: true, message: '请输入游戏 UUID' }]}>
            <Input placeholder="sg_games.uuid" />
          </Form.Item>
          <Form.Item label="展示档位" name="tier" initialValue="elite" rules={[{ required: true }]}>
            <Select options={[
              { value: 'elite', label: '⭐ Elite (2% 档)' },
              { value: 'pro', label: '✨ Pro (1.5% 档)' },
            ]} />
          </Form.Item>
          <Form.Item label="排序（升序）" name="sortOrder" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  )

  const recordsTab = (
    <Card
      title="洗码派发记录"
      extra={
        <Space>
          <Popconfirm
            title={`手动触发 ${recordsDate ?? '昨日'} 洗码派发？`}
            description="幂等操作，已派发记录不会重复发放"
            onConfirm={handleManualPayout}
          >
            <Button icon={<ThunderboltOutlined />} loading={payoutLoading}>手动触发</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <DatePicker
          placeholder="筛选日期"
          onChange={(d) => { setRecordsDate(d ? d.format('YYYY-MM-DD') : undefined) }}
          style={{ width: 160 }}
        />
        <Input
          placeholder="用户 ID"
          value={recordsUser}
          onChange={(e) => setRecordsUser(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />
        <Button onClick={() => void loadRecords(1)}>查询</Button>
      </Space>
      <Table
        dataSource={records}
        rowKey="id"
        size="small"
        loading={recordsLoading}
        pagination={{
          total: recordsTotal,
          current: recordsPage,
          pageSize: 50,
          onChange: (p) => void loadRecords(p),
          showTotal: (t) => `共 ${t} 条`,
        }}
        columns={[
          { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
          { title: '用户', dataIndex: 'displayName', key: 'displayName', render: (v, r) => v ?? r.userId },
          { title: '游戏大类', dataIndex: 'gameCategory', key: 'gameCategory',
            render: (v: string) => CATEGORY_LABELS[v] ?? v },
          { title: '币种', dataIndex: 'currencyCode', key: 'currencyCode', width: 80 },
          { title: '投注额', dataIndex: 'betAmount', key: 'betAmount',
            render: (v: number) => v.toFixed(2), align: 'right' },
          { title: '洗码金额', dataIndex: 'rebateAmount', key: 'rebateAmount',
            render: (v: number) => <Text strong style={{ color: '#52c41a' }}>+{v.toFixed(4)}</Text>,
            align: 'right' },
          { title: '费率', dataIndex: 'ratePct', key: 'ratePct',
            render: (v: number) => `${v}%`, width: 70 },
          { title: '状态', dataIndex: 'status', key: 'status',
            render: (v: string) => <Tag color={v === 'paid' ? 'success' : 'processing'}>{v === 'paid' ? '已发放' : '处理中'}</Tag>,
            width: 80 },
          { title: '发放时间', dataIndex: 'paidAt', key: 'paidAt',
            render: (v: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : '—', width: 110 },
        ]}
      />
    </Card>
  )

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>💰 洗码管理</Title>
        <Text type="secondary">每日凌晨 PHT 00:00 自动派发，无流水要求</Text>
      </div>
      <Tabs
        items={[
          { key: 'config', label: '费率配置', children: configTab },
          { key: 'featured', label: 'Cashback Games', children: featuredTab },
          { key: 'records', label: '派发记录', children: recordsTab },
        ]}
      />
    </div>
  )
}
