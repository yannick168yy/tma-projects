import { useEffect, useState } from 'react'
import { Button, Col, Descriptions, Empty, Form, Input, InputNumber, Modal, Row, Select, Space, Spin, Switch, Table, Tag, message } from 'antd'
import type { TablePaginationConfig, TableProps } from 'antd'
import { getAdminWin568Games, getWin568CoverCandidates, toggleWin568Game, updateWin568Game, type AdminWin568Game, type CoverCandidate } from '../../api'

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

const SITE_CATEGORY_OPTIONS = [
  { value: 'slot', label: 'Slot' },
  { value: 'casino', label: 'Casino' },
  { value: 'perya', label: 'Perya' },
  { value: 'poker', label: 'Poker' },
  { value: 'fishing', label: 'Fishing' },
  { value: 'sports', label: 'Sports' },
  { value: 'lottery', label: '彩票' },
  { value: 'lobby', label: '大厅' },
  { value: 'other', label: '其他' },
]

const COVER_SOURCE_META: Record<string, { label: string; color: string }> = {
  playtime: { label: 'Playtime 方图', color: 'gold' },
  fbmplay: { label: 'FBM', color: 'geekblue' },
  casinoplus: { label: 'CasinoPlus', color: 'magenta' },
  gzone: { label: 'GZone', color: 'cyan' },
  '568win': { label: '568Win 原图', color: 'default' },
}

function coverSourceMeta(source: string) {
  return COVER_SOURCE_META[source] ?? { label: source, color: 'default' }
}

function siteCategoryColor(cat: string) {
  const colors: Record<string, string> = {
    slot: 'purple', casino: 'red', perya: 'magenta', poker: 'geekblue',
    fishing: 'cyan', sports: 'green', lottery: 'orange', lobby: 'default', other: 'default',
  }
  return colors[cat] ?? 'default'
}

const COVER_STATUS_OPTIONS = [
  { value: 'landscape', label: '横版', color: 'blue' },
  { value: 'portrait', label: '竖版', color: 'purple' },
  { value: 'square', label: '正方形', color: 'geekblue' },
  { value: 'none', label: '无封面', color: 'red' },
]

function coverStatusMeta(status: string) {
  return COVER_STATUS_OPTIONS.find((o) => o.value === status) ?? { value: status, label: status, color: 'default' }
}

function jsonText(value: unknown) {
  if (Array.isArray(value)) {
    const values = value.map(String)
    // USD/USDC 视同 USDT(UCC)：后端把美元游戏开放给 USDT 账户，展示上归并一致
    const usdtAliases = ['USDT', 'UCC', 'USD', 'USDC']
    const merged = values.filter((v) => !usdtAliases.includes(v))
    if (values.some((v) => usdtAliases.includes(v))) merged.push('USDT(UCC)')
    return merged.join(', ')
  }
  if (!value) return '—'
  return JSON.stringify(value)
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

// 568Win 上游 rtp 为 0-1 小数，统一按百分数展示
function rtpPct(rtp: number | null): number | null {
  if (rtp == null || rtp < 0) return null
  return rtp <= 1 ? Math.round(rtp * 10000) / 100 : rtp
}

function mono(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  return <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{String(value)}</span>
}

export default function Win568GameList({ refreshKey }: Props) {
  const [search, setSearch] = useState('')
  const [provider, setProvider] = useState<string[]>([])
  const [sortCategory, setSortCategory] = useState<string | undefined>()
  const [siteCategory, setSiteCategory] = useState<string | undefined>()
  const [isActive, setIsActive] = useState<string | undefined>()
  const [upstreamAvailable, setUpstreamAvailable] = useState<string | undefined>('true')
  const [isFeatured, setIsFeatured] = useState<string | undefined>()
  const [coverStatus, setCoverStatus] = useState<string | undefined>()
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
  // 换封面弹窗
  const [coverPicker, setCoverPicker] = useState<AdminWin568Game | null>(null)
  const [candidates, setCandidates] = useState<CoverCandidate[]>([])
  const [currentSource, setCurrentSource] = useState<string>('568win')
  const [candLoading, setCandLoading] = useState(false)
  const [savingCover, setSavingCover] = useState<string | null>(null)

  async function openCoverPicker(record: AdminWin568Game) {
    setCoverPicker(record)
    setCandidates([])
    setCurrentSource('568win')
    setCandLoading(true)
    try {
      const res = await getWin568CoverCandidates(record.gameProviderId, record.gameId)
      setCandidates(res.candidates)
      setCurrentSource(res.currentSource)  // 与前台一致的实际生效来源（override>playtime>fbmplay>bingoplus>568win）
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载候选封面失败')
    } finally {
      setCandLoading(false)
    }
  }

  async function pickCover(c: CoverCandidate) {
    if (!coverPicker) return
    setSavingCover(c.url)
    try {
      // 固定(pin)所选来源：写 image_override + source + 动图(仅 playtime 带)。
      // 含 568win 原图也显式 pin（不能清空覆盖——清空会回退到"自动优先级"=playtime，反而拿不到原图）
      await updateWin568Game(coverPicker.gameProviderId, coverPicker.gameId, {
        imageOverride: c.url,
        imageOverrideSource: c.source,
        imageAnim: c.animUrl ?? null,
      })
      message.success(`已固定为 ${coverSourceMeta(c.source).label}`)
      setGames((prev) => prev.map((g) => g.uuid === coverPicker.uuid ? { ...g, imageUrl: c.url, imageOverride: c.url } : g))
      setCoverPicker(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingCover(null)
    }
  }

  async function load(p = 1, clearFilters = false) {
    setPage(p)
    setLoading(true)
    try {
      const eff = !clearFilters
      const res = await getAdminWin568Games({
        page: p,
        pageSize: 20,
        provider: eff && provider.length ? provider.join(',') : undefined,
        search: eff ? search || undefined : undefined,
        sortCategory: eff ? sortCategory : undefined,
        siteCategory: eff ? siteCategory : undefined,
        isActive: eff && isActive !== undefined ? isActive === 'true' : undefined,
        upstreamAvailable: eff && upstreamAvailable !== undefined ? upstreamAvailable === 'true' : undefined,
        isFeatured: eff && isFeatured !== undefined ? isFeatured === 'true' : undefined,
        coverStatus: eff ? (coverStatus as 'landscape' | 'portrait' | 'square' | 'none' | undefined) : undefined,
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
    setProvider([])
    setSortCategory(undefined)
    setSiteCategory(undefined)
    setIsActive(undefined)
    setUpstreamAvailable('true')
    setIsFeatured(undefined)
    setCoverStatus(undefined)
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
      siteCategory: record.overrideSiteCategory ?? record.siteCategory,
      nameOverride: record.nameOverride ?? '',
      imageOverride: record.imageOverride ?? '',
    })
  }

  async function saveEdit() {
    if (!editing) return
    const values = await form.validateFields()
    // 手动改/清封面 URL 时同步来源(manual/清空)并清掉旧来源残留的动图；没动封面则不发这两个字段
    const imageChanged = (values.imageOverride || null) !== (editing.imageOverride ?? null)
    await updateWin568Game(editing.gameProviderId, editing.gameId, {
      isActive: values.isActive,
      weight: values.weight,
      isFeatured: values.isFeatured,
      sortCategory: values.sortCategory || null,
      siteCategory: values.siteCategory || null,
      nameOverride: values.nameOverride || null,
      imageOverride: values.imageOverride || null,
      ...(imageChanged ? { imageOverrideSource: values.imageOverride ? 'manual' : null, imageAnim: null } : {}),
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
          <div
            onClick={() => void openCoverPicker(r)}
            title="点击更换封面"
            style={{ position: 'relative', width: 40, height: 40, flexShrink: 0, cursor: 'pointer', borderRadius: 4, overflow: 'hidden', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {r.imageUrl
              ? <img src={r.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 10, color: '#bbb' }}>无图</span>}
            <span style={{ position: 'absolute', bottom: 0, right: 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 9, padding: '0 2px', borderTopLeftRadius: 3 }}>换</span>
          </div>
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
      title: '网站分类', key: 'siteCategory', width: 110,
      render: (_: unknown, r: AdminWin568Game) => (
        <div>
          <Tag color={siteCategoryColor(r.siteCategory)}>{SITE_CATEGORY_OPTIONS.find((o) => o.value === r.siteCategory)?.label ?? r.siteCategory}</Tag>
          {r.overrideSiteCategory && <div style={{ color: '#999', fontSize: 12 }}>人工覆盖</div>}
        </div>
      ),
    },
    {
      title: '封面', key: 'cover', width: 100,
      render: (_: unknown, r: AdminWin568Game) => {
        const m = coverStatusMeta(r.coverStatus)
        return (
          <div>
            <Tag color={m.color}>{m.label}</Tag>
            {r.iconWidth && r.iconHeight && <div style={{ color: '#999', fontSize: 12 }}>{r.iconWidth}×{r.iconHeight}</div>}
          </div>
        )
      },
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
      title: '参数', key: 'params', width: 150,
      render: (_: unknown, r: AdminWin568Game) => (
        <div>
          {rtpPct(r.rtp) != null && <div>RTP {rtpPct(r.rtp)}%</div>}
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
          <Button size="small" onClick={() => openEdit(r)}>详情设置</Button>
        </Space>
      ),
    },
  ]

  const pagination: TablePaginationConfig = { current: page, pageSize: 20, total, showTotal: (t) => `共 ${t} 款`, showSizeChanger: false }

  return (
    <>
      <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '12px 16px', marginBottom: 14 }}>
        <Row gutter={[8, 8]} className="responsive-cols">
          <Col span={5}><Input.Search value={search} placeholder="搜索游戏名 / GpId / GameId" onSearch={() => load(1)} allowClear onChange={(e) => setSearch(e.target.value)} /></Col>
          <Col span={4}><Select mode="multiple" value={provider} placeholder="厂商" allowClear showSearch maxTagCount="responsive" optionFilterProp="label" style={{ width: '100%' }} options={providers.map((p) => ({ value: p, label: p }))} onChange={setProvider} /></Col>
          <Col span={3}><Select value={sortCategory} placeholder="分类" allowClear style={{ width: '100%' }} options={CATEGORY_OPTIONS} onChange={setSortCategory} /></Col>
          <Col span={3}><Select value={siteCategory} placeholder="网站分类" allowClear style={{ width: '100%' }} options={SITE_CATEGORY_OPTIONS} onChange={setSiteCategory} /></Col>
          <Col span={3}><Select value={isActive} placeholder="本地状态" allowClear style={{ width: '100%' }} options={[{ value: 'true', label: '本地启用' }, { value: 'false', label: '本地关闭' }]} onChange={setIsActive} /></Col>
          <Col span={3}><Select value={upstreamAvailable} placeholder="上游状态" allowClear style={{ width: '100%' }} options={[{ value: 'true', label: '上游可用' }, { value: 'false', label: '上游不可用' }]} onChange={setUpstreamAvailable} /></Col>
          <Col span={3}><Select value={isFeatured} placeholder="推荐" allowClear style={{ width: '100%' }} options={[{ value: 'true', label: '已推荐' }, { value: 'false', label: '未推荐' }]} onChange={setIsFeatured} /></Col>
          <Col span={3}><Select value={coverStatus} placeholder="封面状态" allowClear style={{ width: '100%' }} options={COVER_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={setCoverStatus} /></Col>
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
      <Table columns={columns} dataSource={games} loading={loading} pagination={pagination} rowKey="uuid" size="small" scroll={{ x: 1560 }} onChange={handleTableChange} />
      <Modal
        title={editing ? `568Win 游戏详情设置：${editing.name}` : '568Win 游戏详情设置'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => void saveEdit()}
        okText="保存"
        cancelText="取消"
        width="100vw"
        style={{ top: 0, maxWidth: '100vw', paddingBottom: 0 }}
        styles={{ content: { borderRadius: 0, minHeight: '100vh' }, body: { height: 'calc(100vh - 110px)', overflowY: 'auto' } }}
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
              <Descriptions.Item label="RTP">{rtpPct(editing.rtp) != null ? `${rtpPct(editing.rtp)}%` : '—'}</Descriptions.Item>
              <Descriptions.Item label="行/轴/线">{editing.rowsCount ?? '—'} / {editing.reelsCount ?? '—'} / {editing.linesCount ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="上游状态"><Tag color={editing.upstreamAvailable ? 'green' : 'red'}>{editing.upstreamAvailable ? '可用' : '不可用'}</Tag></Descriptions.Item>
              <Descriptions.Item label="本地状态"><Tag color={editing.localActive ? 'green' : 'red'}>{editing.localActive ? '启用' : '关闭'}</Tag></Descriptions.Item>
              <Descriptions.Item label="isEnabled">{editing.isEnabled ? 'true' : 'false'}</Descriptions.Item>
              <Descriptions.Item label="isMaintain">{editing.isMaintain ? 'true' : 'false'}</Descriptions.Item>
              <Descriptions.Item label="providerStatus">{editing.providerStatus || '—'}</Descriptions.Item>
              <Descriptions.Item label="isProviderOnline">{editing.isProviderOnline ? 'true' : 'false'}</Descriptions.Item>
              <Descriptions.Item label="提供佣金">{editing.isProvideCommission ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="Hedge Bet">{editing.hasHedgeBet ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="封面状态">
                <Tag color={coverStatusMeta(editing.coverStatus).color}>{coverStatusMeta(editing.coverStatus).label}</Tag>
                {editing.iconWidth && editing.iconHeight ? `${editing.iconWidth}×${editing.iconHeight}` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="封面探测时间">{formatDate(editing.iconProbedAt)}</Descriptions.Item>
              <Descriptions.Item label="同步时间">{formatDate(editing.syncedAt)}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDate(editing.updatedAt)}</Descriptions.Item>
            </Descriptions>

            <Descriptions title="本地覆盖" column={3} bordered size="small" style={{ marginBottom: 10 }}>
              <Descriptions.Item label="权重明细" span={2}>{jsonText(editing.weightBreakdown)}</Descriptions.Item>
              <Descriptions.Item label="权重更新时间">{formatDate(editing.weightUpdatedAt)}</Descriptions.Item>
              <Descriptions.Item label="原始图标" span={3}>{editing.iconUrl ? <a href={editing.iconUrl} target="_blank" rel="noreferrer">{editing.iconUrl}</a> : '—'}</Descriptions.Item>
              <Descriptions.Item label="最终展示名">{editing.name}</Descriptions.Item>
              <Descriptions.Item label="展示名覆盖">{editing.nameOverride || '—'}</Descriptions.Item>
              <Descriptions.Item label="最终分类"><Tag color={categoryColor(editing.sortCategory)}>{editing.sortCategory}</Tag></Descriptions.Item>
              <Descriptions.Item label="分类覆盖">{editing.overrideSortCategory || '—'}</Descriptions.Item>
              <Descriptions.Item label="网站分类"><Tag color={siteCategoryColor(editing.siteCategory)}>{SITE_CATEGORY_OPTIONS.find((o) => o.value === editing.siteCategory)?.label ?? editing.siteCategory}</Tag></Descriptions.Item>
              <Descriptions.Item label="网站分类覆盖">{editing.overrideSiteCategory || `— (自动: ${editing.siteCategoryAuto ?? '—'})`}</Descriptions.Item>
              <Descriptions.Item label="权重">{editing.weight}</Descriptions.Item>
              <Descriptions.Item label="权重覆盖">{editing.overrideWeight ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="推荐首页"><Tag color={editing.isFeatured ? 'gold' : 'default'}>{editing.isFeatured ? '已推荐' : '未推荐'}</Tag></Descriptions.Item>
              <Descriptions.Item label="图片覆盖" span={3}>{editing.imageOverride ? <a href={editing.imageOverride} target="_blank" rel="noreferrer">{editing.imageOverride}</a> : '—'}</Descriptions.Item>
            </Descriptions>

            <Form form={form} layout="vertical">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>游戏设置</div>
              <Row gutter={12}>
                <Col span={6}><Form.Item label="本地启用" name="isActive" valuePropName="checked"><Switch /></Form.Item></Col>
                <Col span={6}><Form.Item label="推荐" name="isFeatured" valuePropName="checked"><Switch /></Form.Item></Col>
                <Col span={12}><Form.Item label="权重" name="weight" rules={[{ required: true, message: '请输入权重' }]}><InputNumber min={0} max={10000} style={{ width: '100%' }} /></Form.Item></Col>
                <Col span={12}><Form.Item label="前端分类" name="sortCategory"><Select allowClear options={CATEGORY_OPTIONS} /></Form.Item></Col>
                <Col span={12}><Form.Item label="网站分类" name="siteCategory" extra="清空则跟随自动分类"><Select allowClear options={SITE_CATEGORY_OPTIONS} /></Form.Item></Col>
                <Col span={12}><Form.Item label="展示名覆盖" name="nameOverride"><Input allowClear /></Form.Item></Col>
                <Col span={12}><Form.Item label="图片覆盖" name="imageOverride"><Input allowClear /></Form.Item></Col>
              </Row>
            </Form>
          </div>
        )}
      </Modal>

      <Modal
        title={coverPicker ? `更换封面：${coverPicker.name}` : '更换封面'}
        open={!!coverPicker}
        onCancel={() => setCoverPicker(null)}
        footer={null}
        width={720}
      >
        {candLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : candidates.length === 0 ? (
          <Empty description="该游戏暂无候选封面（各竞品源均未匹配到）" />
        ) : (
          <div>
            <div style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>
              点击任一封面即固定为该游戏封面（前台实际使用）。当前来源：<Tag color={coverSourceMeta(currentSource).color}>{coverSourceMeta(currentSource).label}</Tag>
              {!coverPicker?.imageOverride && <span style={{ marginLeft: 6 }}>（未手动指定，按优先级自动选中）</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {candidates.map((c) => {
                const meta = coverSourceMeta(c.source)
                const active = c.source === currentSource
                return (
                  <div
                    key={c.source + c.url}
                    onClick={() => !savingCover && void pickCover(c)}
                    style={{
                      border: active ? '2px solid #1677ff' : '1px solid #eee',
                      borderRadius: 8, padding: 6, cursor: savingCover ? 'wait' : 'pointer',
                      position: 'relative', textAlign: 'center', background: '#fff',
                      opacity: savingCover && savingCover !== c.url ? 0.5 : 1,
                    }}
                  >
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 6, overflow: 'hidden', background: '#f5f5f5' }}>
                      <img src={c.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {c.animUrl && <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.6)', color: '#ffd75e', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>动图</span>}
                      {savingCover === c.url && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.6)' }}><Spin size="small" /></div>}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>
                      {active && <Tag color="blue" style={{ margin: '0 0 0 4px' }}>当前</Tag>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
