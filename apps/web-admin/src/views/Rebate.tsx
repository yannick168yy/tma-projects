import { useEffect, useState } from 'react'
import {
  Card, Form, InputNumber, Switch, Button, message, Typography,
  Row, Col, Spin, Table, Tag, Space, Input, DatePicker, Tabs,
  Popconfirm, Select, Modal,
} from 'antd'
import { PercentageOutlined, StarOutlined, DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import {
  getRebateConfig, saveRebateConfig, saveRebateThresholds,
  getFeaturedGames, addFeaturedGame, removeFeaturedGame,
  triggerRebatePayout, getRebateRecords,
  getProviderStats, getAdminGames,
  type RebateConfigItem, type RebateThresholdItem, type RebateFeaturedGame, type RebateRecord, type AdminGame,
} from '../api'

const { Title, Text } = Typography

const CATEGORY_LABELS: Record<string, string> = {
  slots: '🎰 Slots',
  live: '🎲 Live Casino',
  sports: '⚽ Sports',
  fishing: '🐟 Fishing',
  poker: '♠️ Poker',
  bingo: '🎱 Bingo',
  pinoy: '🐓 Pinoy',
  table: '🃏 Table',
  crash: '🚀 Crash',
  other: '🎮 Other',
}

const CATEGORY_ORDER = ['slots', 'live', 'sports', 'fishing', 'poker', 'bingo', 'pinoy', 'table', 'crash', 'other']
const categoryRank = (cat: string) => {
  const index = CATEGORY_ORDER.indexOf(cat)
  return index === -1 ? CATEGORY_ORDER.length : index
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  elite: { label: '⭐ Elite (2%)', color: 'gold' },
  pro: { label: '✨ Pro (1.5%)', color: 'blue' },
}

export default function Rebate() {
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configItems, setConfigItems] = useState<RebateConfigItem[]>([])
  const [thresholds, setThresholds] = useState<RebateThresholdItem[]>([])
  const [thresholdsSaving, setThresholdsSaving] = useState(false)

  const [featuredGames, setFeaturedGames] = useState<RebateFeaturedGame[]>([])
  const [featuredLoading, setFeaturedLoading] = useState(false)

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addForm] = Form.useForm<{ gameUuid: string; tier: string; sortOrder: number }>()
  const [addLoading, setAddLoading] = useState(false)

  const [providers, setProviders] = useState<string[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>()
  const [providerGames, setProviderGames] = useState<AdminGame[]>([])
  const [providerGamesLoading, setProviderGamesLoading] = useState(false)

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
      setThresholds(res.thresholds)
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

  async function loadProviders() {
    try {
      const stats = await getProviderStats()
      setProviders(stats.map((s) => s.provider).sort())
    } catch { /* ignore */ }
  }

  async function loadProviderGames(provider: string) {
    setProviderGamesLoading(true)
    setProviderGames([])
    try {
      const res = await getAdminGames({ provider, isActive: true, pageSize: 200 })
      setProviderGames(res.items)
    } catch { /* ignore */ }
    finally { setProviderGamesLoading(false) }
  }

  function openAddModal() {
    setSelectedProvider(undefined)
    setProviderGames([])
    addForm.resetFields()
    setAddModalOpen(true)
    void loadProviders()
  }

  useEffect(() => {
    void loadConfig()
    void loadFeatured()
    void loadRecords()
  }, [])

  function updateRate(level: number, category: string, value: number) {
    setConfigItems((prev) => prev.map((item) =>
      item.level === level && item.gameCategory === category ? { ...item, ratePct: value } : item
    ))
  }

  function updateMaxBonus(level: number, category: string, value: number) {
    setConfigItems((prev) => prev.map((item) =>
      item.level === level && item.gameCategory === category ? { ...item, maxBonus: value } : item
    ))
  }

  // 大类启用为级别无关：切换时同步该大类全部等级
  function updateCategoryEnabled(category: string, enabled: boolean) {
    setConfigItems((prev) => prev.map((item) =>
      item.gameCategory === category ? { ...item, enabled } : item
    ))
  }

  function updateThreshold(level: number, value: number) {
    setThresholds((prev) => prev.map((t) => t.level === level ? { ...t, minTurnover: value } : t))
  }

  async function handleSaveConfig() {
    setConfigSaving(true)
    try {
      await saveRebateConfig(configItems)
      message.success('分级费率已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setConfigSaving(false) }
  }

  async function handleSaveThresholds() {
    setThresholdsSaving(true)
    try {
      await saveRebateThresholds(thresholds)
      message.success('等级流水阈值已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setThresholdsSaving(false) }
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
      message.success(`已结算 ${date}：${res.users} 用户，共 ₱${Number(res.totalRebate).toFixed(4)} 待领取`)
      void loadRecords()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '派发失败')
    } finally { setPayoutLoading(false) }
  }

  const levels = Array.from(new Set(configItems.map((i) => i.level))).sort((a, b) => a - b)
  const categories = Array.from(new Set(configItems.map((i) => i.gameCategory)))
    .sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
  const rateOf = (level: number, cat: string) => configItems.find((i) => i.level === level && i.gameCategory === cat)
  const isCatEnabled = (cat: string) => configItems.find((i) => i.gameCategory === cat)?.enabled ?? true

  const matrixColumns: ColumnsType<{ category: string }> = [
    {
      title: '游戏大类', dataIndex: 'category', fixed: 'left', width: 150,
      render: (cat: string) => <Text strong>{CATEGORY_LABELS[cat] ?? cat}</Text>,
    },
    ...levels.map((lv) => ({
      title: `LV${lv}`,
      key: `lv${lv}`,
      width: 130,
      render: (_: unknown, row: { category: string }) => {
        const item = rateOf(lv, row.category)
        const disabled = !isCatEnabled(row.category)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <InputNumber
              value={item?.ratePct}
              onChange={(v) => { if (v !== null) updateRate(lv, row.category, v) }}
              min={0} max={10} step={0.1} precision={3}
              suffix="%" size="small" style={{ width: '100%' }}
              disabled={disabled}
            />
            <InputNumber
              value={item?.maxBonus}
              onChange={(v) => { if (v !== null) updateMaxBonus(lv, row.category, v) }}
              min={0} step={100} size="small" style={{ width: '100%' }}
              prefix="≤" placeholder="封顶(0不限)"
              disabled={disabled}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={(v) => Number((v ?? '').replace(/,/g, ''))}
            />
          </div>
        )
      },
    })),
    {
      title: '参与', key: 'enabled', fixed: 'right', width: 70,
      render: (_: unknown, row: { category: string }) => (
        <Switch
          size="small"
          checked={isCatEnabled(row.category)}
          onChange={(v) => updateCategoryEnabled(row.category, v)}
          checkedChildren="开" unCheckedChildren="关"
        />
      ),
    },
  ]

  const configTab = (
    <Spin spinning={configLoading}>
      <Card
        title={<span>📈 等级流水阈值</span>}
        extra={<Button type="primary" loading={thresholdsSaving} onClick={handleSaveThresholds}>保存阈值</Button>}
        style={{ marginBottom: 16 }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          用户累计有效流水达到阈值即升级（只升不降）。LV1 固定为 0。
        </Text>
        <Row gutter={[16, 16]}>
          {thresholds.map((t) => (
            <Col key={t.level} xs={12} sm={8} md={4}>
              <Card size="small" style={{ background: '#fafafa' }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>LV{t.level}</Text>
                <InputNumber
                  value={t.minTurnover}
                  onChange={(v) => { if (v !== null) updateThreshold(t.level, v) }}
                  min={0} step={1000} style={{ width: '100%' }}
                  disabled={t.level === 1}
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v) => Number((v ?? '').replace(/,/g, ''))}
                />
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card
        title={<span><PercentageOutlined /> 分级洗码费率（LV1–{levels.length ? levels[levels.length - 1] : 6} × 游戏大类）</span>}
        extra={<Button type="primary" loading={configSaving} onClick={handleSaveConfig}>保存费率</Button>}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          每日凌晨（PHT 00:00）按用户当前等级 × 下注流水 × 对应费率结算洗码，用户在客户端手动领取。
          每格上行=费率%，下行=该等级该大类每日洗码封顶额（≤，0=不封顶）。
        </Text>
        <Table
          rowKey="category"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={categories.map((c) => ({ category: c }))}
          columns={matrixColumns}
        />
      </Card>
    </Spin>
  )

  const featuredTab = (
    <Spin spinning={featuredLoading}>
      <Card
        title={<span><StarOutlined /> Cashback Games 精选游戏</span>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
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
            {
              title: '游戏名称', key: 'name',
              render: (_: unknown, r: RebateFeaturedGame) => {
                const zh = r.nameZh
                const en = r.name
                if (zh && en) return <span>{zh}<span style={{ color: '#999', marginLeft: 6, fontSize: 12 }}>({en})</span></span>
                return zh ?? en ?? r.gameUuid
              },
            },
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
          <Form.Item label="游戏商">
            <Select
              showSearch
              placeholder="选择游戏商"
              options={providers.map((p) => ({ value: p, label: p }))}
              value={selectedProvider}
              onChange={(v: string) => {
                setSelectedProvider(v)
                addForm.setFieldValue('gameUuid', undefined)
                void loadProviderGames(v)
              }}
              filterOption={(input, opt) =>
                String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item label="游戏" name="gameUuid" rules={[{ required: true, message: '请选择游戏' }]}>
            <Select
              showSearch
              placeholder={selectedProvider ? '选择游戏' : '请先选择游戏商'}
              disabled={!selectedProvider}
              loading={providerGamesLoading}
              options={providerGames.map((g) => {
                const label = g.nameZh ? `${g.nameZh} (${g.name})` : g.name
                return { value: g.uuid, label }
              })}
              filterOption={(input, opt) =>
                String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
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
      title="洗码结算记录"
      extra={
        <Space>
          <Popconfirm
            title={`手动结算 ${recordsDate ?? '昨日'} 洗码？`}
            description="幂等操作，已结算记录不会重复生成；结算后用户在客户端手动领取"
            onConfirm={handleManualPayout}
          >
            <Button icon={<ThunderboltOutlined />} loading={payoutLoading}>手动结算</Button>
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
            render: (v: string) => <Tag color={v === 'paid' ? 'success' : 'warning'}>{v === 'paid' ? '已领取' : '待领取'}</Tag>,
            width: 80 },
          { title: '领取时间', dataIndex: 'paidAt', key: 'paidAt',
            render: (v: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : '—', width: 110 },
        ]}
      />
    </Card>
  )

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>💰 洗码管理</Title>
        <Text type="secondary">分级费率（LV1–6），每日凌晨 PHT 00:00 结算，用户客户端手动领取</Text>
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
