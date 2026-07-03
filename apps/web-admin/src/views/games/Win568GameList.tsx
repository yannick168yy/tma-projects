import { useEffect, useState } from 'react'
import { Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Table, Tag, message } from 'antd'
import type { TablePaginationConfig, TableProps } from 'antd'
import { getAdminWin568Games, toggleWin568Game, updateWin568Game, type AdminWin568Game } from '../../api'

interface Props { refreshKey: number }

const CATEGORY_OPTIONS = [
  { value: 'slots', label: 'Slots' },
  { value: 'live', label: 'Live' },
  { value: 'fishing', label: 'Fishing' },
  { value: 'table', label: 'Table' },
  { value: 'sports', label: 'Sports' },
  { value: 'other', label: 'Other' },
]

function categoryColor(cat: string) {
  const colors: Record<string, string> = { slots: 'purple', live: 'red', fishing: 'cyan', table: 'blue', sports: 'green', other: 'default' }
  return colors[cat] ?? 'default'
}

function jsonText(value: unknown) {
  if (Array.isArray(value)) return value.join(', ')
  if (!value) return '—'
  return JSON.stringify(value)
}

export default function Win568GameList({ refreshKey }: Props) {
  const [search, setSearch] = useState('')
  const [provider, setProvider] = useState<string | undefined>()
  const [sortCategory, setSortCategory] = useState<string | undefined>()
  const [isActive, setIsActive] = useState<string | undefined>()
  const [upstreamAvailable, setUpstreamAvailable] = useState<string | undefined>('true')
  const [isFeatured, setIsFeatured] = useState<string | undefined>()
  const [currency, setCurrency] = useState<string | undefined>('PHP')
  const [device, setDevice] = useState<string | undefined>('m')
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState<AdminWin568Game[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string | undefined>()
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>()
  const [toggling, setToggling] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminWin568Game | null>(null)
  const [form] = Form.useForm()

  async function load(p = 1, clearFilters = false) {
    setPage(p)
    setLoading(true)
    try {
      const eff = !clearFilters
      const res = await getAdminWin568Games({
        page: p,
        pageSize: 20,
        provider: eff ? provider : undefined,
        search: eff ? search || undefined : undefined,
        sortCategory: eff ? sortCategory : undefined,
        isActive: eff && isActive !== undefined ? isActive === 'true' : undefined,
        upstreamAvailable: eff && upstreamAvailable !== undefined ? upstreamAvailable === 'true' : undefined,
        isFeatured: eff && isFeatured !== undefined ? isFeatured === 'true' : undefined,
        currency: eff ? currency : undefined,
        device: eff ? device : undefined,
        sortField,
        sortOrder,
      })
      setGames(res.items)
      setProviders(res.providers)
      setTotal(res.total)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(1) }, [refreshKey])

  function resetFilters() {
    setSearch('')
    setProvider(undefined)
    setSortCategory(undefined)
    setIsActive(undefined)
    setUpstreamAvailable('true')
    setIsFeatured(undefined)
    setCurrency('PHP')
    setDevice('m')
    void load(1, true)
  }

  async function onToggle(record: AdminWin568Game, value: boolean) {
    setToggling(record.uuid)
    try {
      await toggleWin568Game(record.gameProviderId, record.gameId, value)
      setGames((prev) => prev.map((g) => g.uuid === record.uuid ? { ...g, localActive: value, isActive: value && g.upstreamAvailable, overrideActive: value } : g))
      message.success(value ? '已启用' : '已关闭')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setToggling(null)
    }
  }

  function openEdit(record: AdminWin568Game) {
    setEditing(record)
    form.setFieldsValue({
      isActive: record.localActive,
      weight: record.overrideWeight ?? record.weight,
      isFeatured: record.isFeatured,
      sortCategory: record.overrideSortCategory ?? record.sortCategory,
      nameOverride: record.nameOverride ?? '',
      imageOverride: record.imageOverride ?? '',
    })
  }

  async function saveEdit() {
    if (!editing) return
    const values = await form.validateFields()
    await updateWin568Game(editing.gameProviderId, editing.gameId, {
      isActive: values.isActive,
      weight: values.weight,
      isFeatured: values.isFeatured,
      sortCategory: values.sortCategory || null,
      nameOverride: values.nameOverride || null,
      imageOverride: values.imageOverride || null,
    })
    message.success('已保存')
    setEditing(null)
    void load(page)
  }

  const handleTableChange: TableProps<AdminWin568Game>['onChange'] = (pag, _filters, sorter) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter
    if (s.columnKey && s.order) {
      setSortField(String(s.columnKey))
      setSortOrder(s.order === 'ascend' ? 'asc' : 'desc')
    } else {
      setSortField(undefined)
      setSortOrder(undefined)
    }
    void load(pag.current ?? 1)
  }

  const columns = [
    {
      title: '游戏', key: 'game', width: 280,
      render: (_: unknown, r: AdminWin568Game) => (
        <div style={{ display: 'flex', gap: 8 }}>
          {r.imageUrl && <img src={r.imageUrl} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
            <div style={{ color: '#999', fontSize: 12 }}>GpId {r.gameProviderId} · Game {r.gameId}</div>
            <Space size={4} wrap>
              {r.isFeatured && <Tag color="gold">推荐</Tag>}
              {r.hasHedgeBet && <Tag color="volcano">Hedge</Tag>}
              {r.isProvideCommission && <Tag color="blue">Commission</Tag>}
            </Space>
          </div>
        </div>
      ),
    },
    { title: '厂商', dataIndex: 'provider', key: 'provider', width: 140 },
    {
      title: '分类', key: 'category', width: 120,
      render: (_: unknown, r: AdminWin568Game) => (
        <div>
          <Tag color={categoryColor(r.sortCategory)}>{r.sortCategory}</Tag>
          <div style={{ color: '#999', fontSize: 12 }}>newGameType {r.newGameType ?? '—'}</div>
        </div>
      ),
    },
    {
      title: '状态', key: 'status', width: 150,
      render: (_: unknown, r: AdminWin568Game) => (
        <Space direction="vertical" size={2}>
          <Tag color={r.upstreamAvailable ? 'green' : 'red'}>{r.upstreamAvailable ? '上游可用' : '上游不可用'}</Tag>
          <Tag color={r.localActive ? 'green' : 'red'}>{r.localActive ? '本地启用' : '本地关闭'}</Tag>
          {!r.isEnabled && <Tag color="red">disabled</Tag>}
          {r.isMaintain && <Tag color="orange">maintain</Tag>}
          {r.providerStatus && r.providerStatus !== 'Online' && <Tag color="red">{r.providerStatus}</Tag>}
        </Space>
      ),
    },
    {
      title: '设备/币种', key: 'device', width: 180,
      render: (_: unknown, r: AdminWin568Game) => (
        <div>
          <div>{r.device || '—'} · {r.platform || '—'}</div>
          <div style={{ color: '#999', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{jsonText(r.supportedCurrencies)}</div>
        </div>
      ),
    },
    {
      title: '参数', key: 'params', width: 120,
      render: (_: unknown, r: AdminWin568Game) => (
        <div>
          {r.rtp != null && r.rtp >= 0 && <div>RTP {r.rtp}%</div>}
          <div style={{ color: '#999', fontSize: 12 }}>{r.rowsCount ?? '—'}R / {r.reelsCount ?? '—'} reels / {r.linesCount ?? '—'} lines</div>
        </div>
      ),
    },
    { title: 'Rank', dataIndex: 'rankNo', key: 'rank', width: 90, sorter: true },
    { title: '权重', dataIndex: 'weight', key: 'weight', width: 90, sorter: true },
    {
      title: '操作', key: 'action', width: 130, fixed: 'right' as const,
      render: (_: unknown, r: AdminWin568Game) => (
        <Space>
          <Switch checked={r.localActive} loading={toggling === r.uuid} onChange={(val) => onToggle(r, val)} />
          <Button size="small" onClick={() => openEdit(r)}>设置</Button>
        </Space>
      ),
    },
  ]

  const pagination: TablePaginationConfig = { current: page, pageSize: 20, total, showTotal: (t) => `共 ${t} 款`, showSizeChanger: false }

  return (
    <>
      <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '12px 16px', marginBottom: 14 }}>
        <Row gutter={[8, 8]}>
          <Col span={5}><Input.Search value={search} placeholder="搜索游戏名 / GpId / GameId" onSearch={() => load(1)} allowClear onChange={(e) => setSearch(e.target.value)} /></Col>
          <Col span={4}><Select value={provider} placeholder="厂商" allowClear style={{ width: '100%' }} options={providers.map((p) => ({ value: p, label: p }))} onChange={setProvider} /></Col>
          <Col span={3}><Select value={sortCategory} placeholder="分类" allowClear style={{ width: '100%' }} options={CATEGORY_OPTIONS} onChange={setSortCategory} /></Col>
          <Col span={3}><Select value={isActive} placeholder="本地状态" allowClear style={{ width: '100%' }} options={[{ value: 'true', label: '本地启用' }, { value: 'false', label: '本地关闭' }]} onChange={setIsActive} /></Col>
          <Col span={3}><Select value={upstreamAvailable} placeholder="上游状态" allowClear style={{ width: '100%' }} options={[{ value: 'true', label: '上游可用' }, { value: 'false', label: '上游不可用' }]} onChange={setUpstreamAvailable} /></Col>
          <Col span={3}><Select value={isFeatured} placeholder="推荐" allowClear style={{ width: '100%' }} options={[{ value: 'true', label: '已推荐' }, { value: 'false', label: '未推荐' }]} onChange={setIsFeatured} /></Col>
          <Col span={2}><Select value={currency} placeholder="币种" allowClear style={{ width: '100%' }} options={['PHP', 'USDT', 'UCC'].map((v) => ({ value: v, label: v }))} onChange={setCurrency} /></Col>
          <Col span={2}><Select value={device} placeholder="设备" allowClear style={{ width: '100%' }} options={[{ value: 'm', label: 'Mobile' }, { value: 'd', label: 'Desktop' }]} onChange={setDevice} /></Col>
          <Col span={3}>
            <Space>
              <Button type="primary" onClick={() => load(1)}>查询</Button>
              <Button onClick={resetFilters}>重置</Button>
            </Space>
          </Col>
          <Col span={2} style={{ display: 'flex', alignItems: 'center' }}><Tag color="blue">共 {total} 款</Tag></Col>
        </Row>
      </div>
      <Table columns={columns} dataSource={games} loading={loading} pagination={pagination} rowKey="uuid" size="small" scroll={{ x: 1320 }} onChange={handleTableChange} />
      <Modal title="568Win 游戏运营设置" open={!!editing} onCancel={() => setEditing(null)} onOk={() => void saveEdit()} okText="保存" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item label="本地启用" name="isActive" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item label="权重" name="weight" rules={[{ required: true, message: '请输入权重' }]}><InputNumber min={0} max={10000} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="推荐" name="isFeatured" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item label="前端分类" name="sortCategory"><Select allowClear options={CATEGORY_OPTIONS} /></Form.Item>
          <Form.Item label="展示名覆盖" name="nameOverride"><Input allowClear /></Form.Item>
          <Form.Item label="图片覆盖" name="imageOverride"><Input allowClear /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
