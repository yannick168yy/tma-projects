import { useEffect, useState } from 'react'
import { Button, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Table, Tag, message } from 'antd'
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
  if (Array.isArray(value)) {
    const values = value.map(String)
    const merged = values.filter((v) => v !== 'USDT' && v !== 'UCC')
    if (values.includes('USDT') || values.includes('UCC')) merged.push('USDT(UCC)')
    return merged.join(', ')
  }
  if (!value) return '—'
  return JSON.stringify(value)
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

function mono(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  return <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{String(value)}</span>
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
          <Col span={2}><Select value={currency} placeholder="币种" allowClear style={{ width: '100%' }} options={[{ value: 'PHP', label: 'PHP' }, { value: 'USDT', label: 'USDT(UCC)' }]} onChange={setCurrency} /></Col>
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
      <Modal
        title={editing ? `568Win 游戏运营设置：${editing.name}` : '568Win 游戏运营设置'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => void saveEdit()}
        okText="保存"
        cancelText="取消"
        width={920}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
      >
        {editing && (
          <div>
            {editing.imageUrl && (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <img src={editing.imageUrl} style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 6 }} />
              </div>
            )}
            <Descriptions title="568Win 原始信息" column={2} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="UUID" span={2}>{mono(editing.uuid)}</Descriptions.Item>
              <Descriptions.Item label="GpId">{editing.gameProviderId}</Descriptions.Item>
              <Descriptions.Item label="GameId">{editing.gameId}</Descriptions.Item>
              <Descriptions.Item label="厂商">{editing.provider}</Descriptions.Item>
              <Descriptions.Item label="平台">{editing.platform || '—'}</Descriptions.Item>
              <Descriptions.Item label="newGameType">{editing.newGameType ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="gameType">{editing.gameType ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Rank">{editing.rankNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="设备">{editing.device || '—'}</Descriptions.Item>
              <Descriptions.Item label="英文名称">{editing.nameEn || '—'}</Descriptions.Item>
              <Descriptions.Item label="中文名称">{editing.nameZh || '—'}</Descriptions.Item>
              <Descriptions.Item label="支持币种" span={2}>{jsonText(editing.supportedCurrencies)}</Descriptions.Item>
              <Descriptions.Item label="屏蔽国家" span={2}>{jsonText(editing.blockCountries)}</Descriptions.Item>
              <Descriptions.Item label="RTP">{editing.rtp != null && editing.rtp >= 0 ? `${editing.rtp}%` : '—'}</Descriptions.Item>
              <Descriptions.Item label="行/轴/线">{editing.rowsCount ?? '—'} / {editing.reelsCount ?? '—'} / {editing.linesCount ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="上游状态"><Tag color={editing.upstreamAvailable ? 'green' : 'red'}>{editing.upstreamAvailable ? '可用' : '不可用'}</Tag></Descriptions.Item>
              <Descriptions.Item label="本地状态"><Tag color={editing.localActive ? 'green' : 'red'}>{editing.localActive ? '启用' : '关闭'}</Tag></Descriptions.Item>
              <Descriptions.Item label="isEnabled">{editing.isEnabled ? 'true' : 'false'}</Descriptions.Item>
              <Descriptions.Item label="isMaintain">{editing.isMaintain ? 'true' : 'false'}</Descriptions.Item>
              <Descriptions.Item label="providerStatus">{editing.providerStatus || '—'}</Descriptions.Item>
              <Descriptions.Item label="isProviderOnline">{editing.isProviderOnline ? 'true' : 'false'}</Descriptions.Item>
              <Descriptions.Item label="提供佣金">{editing.isProvideCommission ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="Hedge Bet">{editing.hasHedgeBet ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="同步时间">{formatDate(editing.syncedAt)}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDate(editing.updatedAt)}</Descriptions.Item>
            </Descriptions>

            <Descriptions title="本地覆盖与 AI 富化数据" column={2} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="最终展示名">{editing.name}</Descriptions.Item>
              <Descriptions.Item label="展示名覆盖">{editing.nameOverride || '—'}</Descriptions.Item>
              <Descriptions.Item label="最终分类"><Tag color={categoryColor(editing.sortCategory)}>{editing.sortCategory}</Tag></Descriptions.Item>
              <Descriptions.Item label="分类覆盖">{editing.overrideSortCategory || '—'}</Descriptions.Item>
              <Descriptions.Item label="权重">{editing.weight}</Descriptions.Item>
              <Descriptions.Item label="权重覆盖">{editing.overrideWeight ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="PH 热度">{editing.phBonus ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="推荐首页"><Tag color={editing.isFeatured ? 'gold' : 'default'}>{editing.isFeatured ? '已推荐' : '未推荐'}</Tag></Descriptions.Item>
              <Descriptions.Item label="主题">{editing.theme || '—'}</Descriptions.Item>
              <Descriptions.Item label="风格">{editing.gameStyle || '—'}</Descriptions.Item>
              <Descriptions.Item label="适合玩家">{editing.playerType || '—'}</Descriptions.Item>
              <Descriptions.Item label="权重更新时间">{formatDate(editing.weightUpdatedAt)}</Descriptions.Item>
              <Descriptions.Item label="权重明细" span={2}>{jsonText(editing.weightBreakdown)}</Descriptions.Item>
              <Descriptions.Item label="中文简介" span={2}><span style={{ whiteSpace: 'pre-wrap' }}>{editing.descriptionZh || '—'}</span></Descriptions.Item>
              <Descriptions.Item label="英文简介" span={2}><span style={{ whiteSpace: 'pre-wrap' }}>{editing.descriptionEn || '—'}</span></Descriptions.Item>
              <Descriptions.Item label="搜索关键词" span={2}>{mono(editing.searchKeywords)}</Descriptions.Item>
              <Descriptions.Item label="原始图标" span={2}>{editing.iconUrl ? <a href={editing.iconUrl} target="_blank" rel="noreferrer">{editing.iconUrl}</a> : '—'}</Descriptions.Item>
              <Descriptions.Item label="图片覆盖" span={2}>{editing.imageOverride ? <a href={editing.imageOverride} target="_blank" rel="noreferrer">{editing.imageOverride}</a> : '—'}</Descriptions.Item>
            </Descriptions>

            <Form form={form} layout="vertical">
              <Form.Item label="本地启用" name="isActive" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="权重" name="weight" rules={[{ required: true, message: '请输入权重' }]}><InputNumber min={0} max={10000} style={{ width: '100%' }} /></Form.Item>
              <Form.Item label="推荐" name="isFeatured" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="前端分类" name="sortCategory"><Select allowClear options={CATEGORY_OPTIONS} /></Form.Item>
              <Form.Item label="展示名覆盖" name="nameOverride"><Input allowClear /></Form.Item>
              <Form.Item label="图片覆盖" name="imageOverride"><Input allowClear /></Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </>
  )
}
