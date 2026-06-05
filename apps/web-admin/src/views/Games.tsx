import { useEffect, useState, useCallback } from 'react'
import { Table, Space, Input, Select, Button, Tag, Switch, Modal, Progress, Spin, Row, Col, Descriptions, message, Tabs } from 'antd'
import type { TablePaginationConfig, TableProps } from 'antd'
import {
  getAdminGames, toggleGame, startSyncGames, startTranslateGames, getGameJob,
  getProviderStats, toggleProviderGames,
  type AdminGame, type AdminGameJob, type ProviderStat,
} from '../api'

function volatilityColor(v: string) {
  if (v.includes('very')) return 'magenta'
  if (v.includes('high')) return 'red'
  if (v.includes('medium')) return 'orange'
  return 'green'
}
function sortCategoryColor(cat: string) {
  const m: Record<string, string> = { slots: 'purple', fishing: 'cyan', live: 'red', bingo: 'green', crash: 'orange', table: 'blue' }
  return m[cat] ?? 'default'
}
function playerTypeColor(pt: string) {
  if (pt === 'high-roller') return 'red'
  if (pt === 'regular') return 'blue'
  return 'green'
}
function weightColor(w: number) {
  if (w >= 80) return '#52c41a'
  if (w >= 50) return '#faad14'
  return '#1677ff'
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

export default function Games() {
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState<string | undefined>()
  const [sortCategoryFilter, setSortCategoryFilter] = useState<string | undefined>()
  const [themeFilter, setThemeFilter] = useState<string | undefined>()
  const [gameStyleFilter, setGameStyleFilter] = useState<string | undefined>()
  const [playerTypeFilter, setPlayerTypeFilter] = useState<string | undefined>()
  const [weightRangeFilter, setWeightRangeFilter] = useState<string | undefined>()
  const [volatilityFilter, setVolatilityFilter] = useState<string | undefined>()
  const [demoFilter, setDemoFilter] = useState<string | undefined>()
  const [featuredFilter, setFeaturedFilter] = useState<string | undefined>()
  const [techFilter, setTechFilter] = useState<string | undefined>()
  const [activeFilter, setActiveFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [games, setGames] = useState<AdminGame[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string | undefined>()
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>()
  const [togglingUuid, setTogglingUuid] = useState<string | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailGame, setDetailGame] = useState<AdminGame | null>(null)
  const [activeTab, setActiveTab] = useState('games')
  const [providerStats, setProviderStats] = useState<ProviderStat[]>([])
  const [providerStatsLoading, setProviderStatsLoading] = useState(false)
  const [togglingProvider, setTogglingProvider] = useState<string | null>(null)
  const [jobModal, setJobModal] = useState({ visible: false, title: '', msg: '', total: 0, percent: 0, closable: false, status: 'active' as 'active' | 'success' | 'exception' })

  async function load(p = 1, clearFilters = false) {
    setPage(p); setLoading(true)
    try {
      const eff = !clearFilters
      const isActive = (eff && activeFilter !== undefined) ? activeFilter === 'true' : undefined
      const isFeatured = (eff && featuredFilter !== undefined) ? featuredFilter === 'true' : undefined
      const hasDemo = (eff && demoFilter !== undefined) ? demoFilter === 'true' : undefined
      let weightMin: number | undefined, weightMax: number | undefined
      if (eff && weightRangeFilter) {
        const [mn, mx] = weightRangeFilter.split('-').map(Number)
        weightMin = mn; weightMax = mx
      }
      const res = await getAdminGames({
        page: p, pageSize: 20,
        provider: eff ? providerFilter : undefined,
        search: eff ? (search || undefined) : undefined,
        isActive,
        sortCategory: eff ? sortCategoryFilter : undefined,
        volatility: eff ? volatilityFilter : undefined,
        isFeatured, hasDemo,
        theme: eff ? themeFilter : undefined,
        gameStyle: eff ? gameStyleFilter : undefined,
        playerType: eff ? playerTypeFilter : undefined,
        technology: eff ? techFilter : undefined,
        weightMin, weightMax, sortField, sortOrder,
      })
      setGames(res.items); setTotal(res.total)
      if (res.providers.length) setProviders(res.providers)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function resetFilters() {
    setSearch(''); setProviderFilter(undefined); setSortCategoryFilter(undefined); setThemeFilter(undefined)
    setGameStyleFilter(undefined); setPlayerTypeFilter(undefined); setWeightRangeFilter(undefined)
    setVolatilityFilter(undefined); setDemoFilter(undefined); setFeaturedFilter(undefined)
    setTechFilter(undefined); setActiveFilter(undefined)
    void load(1, true)
  }

  const loadProviderStats = useCallback(async () => {
    setProviderStatsLoading(true)
    try { setProviderStats(await getProviderStats()) }
    catch { message.error('加载失败') }
    finally { setProviderStatsLoading(false) }
  }, [])

  useEffect(() => { if (activeTab === 'providers') void loadProviderStats() }, [activeTab])

  async function onToggleProvider(provider: string, isActive: boolean) {
    const stat = providerStats.find((s) => s.provider === provider)
    const count = stat?.total ?? 0
    Modal.confirm({
      title: `${isActive ? '启用' : '关闭'}「${provider}」全部游戏`,
      content: `将${isActive ? '启用' : '关闭'} ${count} 款游戏，确认操作？`,
      okType: isActive ? 'primary' : 'danger',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setTogglingProvider(provider)
        try {
          const res = await toggleProviderGames(provider, isActive)
          setProviderStats((prev) => prev.map((s) => s.provider === provider ? { ...s, active: isActive ? s.total : 0 } : s))
          message.success(`已${isActive ? '启用' : '关闭'} ${res.affected} 款游戏`)
        } catch { message.error('操作失败') }
        finally { setTogglingProvider(null) }
      },
    })
  }

  async function onToggle(record: AdminGame, val: boolean) {
    setTogglingUuid(record.uuid)
    try {
      await toggleGame(record.uuid, val)
      setGames((prev) => prev.map((g) => g.uuid === record.uuid ? { ...g, isActive: val } : g))
      message.success(val ? '已启用' : '已禁用')
    } catch { message.error('操作失败') }
    finally { setTogglingUuid(null) }
  }

  async function pollGameJob(jobId: string, onUpdate: (j: AdminGameJob) => void): Promise<AdminGameJob> {
    for (let i = 0; i < 3600; i++) {
      const job = await getGameJob(jobId)
      onUpdate(job)
      if (job.status === 'done' || job.status === 'failed') return job
      await sleep(2000)
    }
    throw new Error('任务超时')
  }

  async function runBatchJob(kind: 'sync' | 'translate', start: () => Promise<{ jobId: string; alreadyRunning?: boolean }>) {
    const isSync = kind === 'sync'
    if (isSync) setSyncing(true); else setTranslating(true)
    setJobModal({ visible: true, title: isSync ? '同步游戏库' : 'AI 翻译游戏名', msg: '正在启动任务…', total: 0, percent: 0, closable: false, status: 'active' })
    try {
      const { jobId, alreadyRunning } = await start()
      if (alreadyRunning) message.info('已有任务在运行，继续跟踪进度')
      const final = await pollGameJob(jobId, (job) => {
        setJobModal((m) => ({
          ...m,
          msg: job.message || '处理中…',
          total: job.total,
          percent: job.total > 0 ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0,
        }))
      })
      if (final.status === 'failed') {
        setJobModal((m) => ({ ...m, status: 'exception', closable: true }))
        message.error(final.error ?? '任务失败'); return
      }
      setJobModal((m) => ({ ...m, status: 'success', closable: true }))
      if (isSync) {
        message.success(`同步完成，共 ${final.result?.synced ?? 0} 款游戏`); void load(1)
      } else {
        const r = final.result
        const t = r?.total ?? 0
        if (t === 0) message.info('所有游戏名称已翻译，无需重复操作')
        else { message.success(`翻译完成：${r?.translated ?? 0} 款成功，${r?.errors ?? 0} 款失败（共 ${t} 款待翻译）`); void load(1) }
      }
    } catch (e) {
      setJobModal((m) => ({ ...m, status: 'exception', closable: true }))
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      if (isSync) setSyncing(false); else setTranslating(false)
    }
  }

  const handleTableChange: TableProps<AdminGame>['onChange'] = (pag, _filters, sorter) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter
    if (s.columnKey && s.order) {
      setSortField(String(s.columnKey))
      setSortOrder(s.order === 'ascend' ? 'asc' : 'desc')
    } else {
      setSortField(undefined); setSortOrder(undefined)
    }
    void load(pag.current ?? 1)
  }

  const columns = [
    {
      title: '游戏', key: 'name', width: 220,
      render: (_: unknown, r: AdminGame) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {(r.imageHqUrl || r.imageUrl) && <img src={r.imageHqUrl || r.imageUrl || ''} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, flexShrink: 0, marginTop: 2 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
              {r.isFeatured && <Tag color="gold" style={{ fontSize: 10, padding: '0 3px', lineHeight: '16px', margin: 0 }}>推荐</Tag>}
              {r.hasDemo && <Tag color="blue" style={{ fontSize: 10, padding: '0 3px', lineHeight: '16px', margin: 0 }}>Demo</Tag>}
              {r.isMobile && <Tag color="green" style={{ fontSize: 10, padding: '0 3px', lineHeight: '16px', margin: 0 }}>手机</Tag>}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: '游戏商', key: 'provider', width: 130,
      render: (_: unknown, r: AdminGame) => (
        <div>
          <div style={{ fontSize: 13 }}>{r.provider}</div>
          {r.label && <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{r.label}</div>}
          {r.technology && <Tag color={r.technology === 'HTML5' ? 'blue' : 'orange'} style={{ fontSize: 10, padding: '0 4px', marginTop: 2 }}>{r.technology}</Tag>}
        </div>
      ),
    },
    {
      title: '前端分类', key: 'sortCategory', width: 100,
      render: (_: unknown, r: AdminGame) => r.sortCategory
        ? <><Tag color={sortCategoryColor(r.sortCategory)} style={{ fontSize: 11, marginBottom: 2 }}>{r.sortCategory}</Tag><div style={{ fontSize: 11, color: '#aaa' }}>{r.type || r.category || ''}</div></>
        : <div style={{ color: '#ccc', fontSize: 12 }}>—</div>,
    },
    {
      title: '主题/风格/玩家', key: 'aiAttrs', width: 150,
      render: (_: unknown, r: AdminGame) => (r.theme || r.gameStyle || r.playerType) ? (
        <div>
          {r.theme && <div style={{ fontSize: 11, color: '#595959' }}><span style={{ color: '#999' }}>主题:</span> {r.theme}</div>}
          {r.gameStyle && <div style={{ fontSize: 11, color: '#595959', marginTop: 1 }}><span style={{ color: '#999' }}>风格:</span> {r.gameStyle}</div>}
          {r.playerType && <div style={{ fontSize: 11, marginTop: 1 }}><Tag color={playerTypeColor(r.playerType)} style={{ fontSize: 10, padding: '0 4px' }}>{r.playerType}</Tag></div>}
        </div>
      ) : <div style={{ color: '#ccc', fontSize: 12 }}>—</div>,
    },
    {
      title: '参数', key: 'params', width: 110,
      render: (_: unknown, r: AdminGame) => (
        <div>
          {r.rtp != null && <div style={{ fontSize: 12 }}>RTP <b>{r.rtp}%</b></div>}
          {r.volatility && <Tag color={volatilityColor(r.volatility)} style={{ fontSize: 10, padding: '0 4px', marginTop: 2 }}>{r.volatility}</Tag>}
          {(r.reelsCount || r.linesCount) && <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{r.reelsCount && `${r.reelsCount}轮`}{r.reelsCount && r.linesCount && ' · '}{r.linesCount && `${r.linesCount}线`}</div>}
        </div>
      ),
    },
    {
      title: '热度权重', key: 'weight', width: 120, sorter: true, sortDirections: ['ascend' as const, 'descend' as const],
      render: (_: unknown, r: AdminGame) => r.weight > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Progress type="line" percent={r.weight} strokeWidth={8} strokeColor={weightColor(r.weight)} showInfo={false} style={{ flex: 1, minWidth: 50, margin: 0 }} />
          <span style={{ fontSize: 11, color: '#595959', width: 22, textAlign: 'right', flexShrink: 0 }}>{r.weight}</span>
        </div>
      ) : <span style={{ color: '#d9d9d9', fontSize: 11 }}>未评</span>,
    },
    {
      title: 'PH热度', key: 'phBonus', width: 90, sorter: true, sortDirections: ['ascend' as const, 'descend' as const],
      render: (_: unknown, r: AdminGame) => r.phBonus > 0
        ? <span><span style={{ fontSize: 13, fontWeight: 600, color: '#1677ff' }}>{r.phBonus}</span><span style={{ fontSize: 10, color: '#999' }}> /30</span></span>
        : <span style={{ color: '#d9d9d9', fontSize: 11 }}>—</span>,
    },
    {
      title: '特性', key: 'features', width: 120,
      render: (_: unknown, r: AdminGame) => (r.hasFreespins || r.hasLobby || r.hasTables) ? (
        <Space wrap size={2}>
          {r.hasFreespins && <Tag color="purple" style={{ fontSize: 10, padding: '0 4px' }}>免费旋</Tag>}
          {r.hasLobby && <Tag color="cyan" style={{ fontSize: 10, padding: '0 4px' }}>大厅</Tag>}
          {r.hasTables && <Tag color="geekblue" style={{ fontSize: 10, padding: '0 4px' }}>桌台</Tag>}
        </Space>
      ) : <div style={{ color: '#ccc', fontSize: 11 }}>—</div>,
    },
    {
      title: '操作', key: 'actions', width: 65, fixed: 'right' as const,
      render: (_: unknown, r: AdminGame) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <Switch checked={r.isActive} size="small" loading={togglingUuid === r.uuid} onChange={(val) => onToggle(r, val)} />
          <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 11 }} onClick={() => { setDetailGame(r); setDetailVisible(true) }}>详情</Button>
        </div>
      ),
    },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize: 20, total,
    showTotal: (t) => `共 ${t} 款`,
    showSizeChanger: false,
  }

  const filterSelect = (placeholder: string, value: string | undefined, onChange: (v: string | undefined) => void, options: { value: string; label: string }[]) => (
    <Select value={value} placeholder={placeholder} allowClear style={{ width: '100%' }} onChange={onChange} options={options} />
  )

  const providerColumns = [
    {
      title: '游戏商', dataIndex: 'provider', key: 'provider',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '游戏总数', dataIndex: 'total', key: 'total', width: 100,
      render: (v: number) => <Tag>{v} 款</Tag>,
    },
    {
      title: '已启用', key: 'active', width: 100,
      render: (_: unknown, r: ProviderStat) => {
        const allOn = r.active === r.total
        const allOff = r.active === 0
        return <Tag color={allOn ? 'green' : allOff ? 'red' : 'orange'}>{r.active} 款</Tag>
      },
    },
    {
      title: '状态', key: 'status', width: 100,
      render: (_: unknown, r: ProviderStat) => {
        const allOn = r.active === r.total
        const allOff = r.active === 0
        return allOn ? <Tag color="green">全部启用</Tag> : allOff ? <Tag color="red">全部关闭</Tag> : <Tag color="orange">部分启用</Tag>
      },
    },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: ProviderStat) => {
        const allOn = r.active === r.total
        const loading = togglingProvider === r.provider
        return (
          <Space>
            <Switch
              checked={r.active > 0}
              loading={loading}
              onChange={(val) => void onToggleProvider(r.provider, val)}
            />
            {!allOn && r.active > 0 && (
              <Button size="small" danger loading={loading} onClick={() => void onToggleProvider(r.provider, false)}>全部关闭</Button>
            )}
            {r.active < r.total && (
              <Button size="small" type="primary" loading={loading} onClick={() => void onToggleProvider(r.provider, true)}>全部启用</Button>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} align="center">
        <h2 style={{ margin: 0 }}>游戏管理</h2>
        <Space>
          <Button loading={translating} disabled={syncing} onClick={() => runBatchJob('translate', startTranslateGames)}>AI 翻译游戏名</Button>
          <Button type="primary" loading={syncing} disabled={translating} onClick={() => runBatchJob('sync', startSyncGames)}>同步游戏库</Button>
        </Space>
      </Space>
      <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ marginBottom: 0 }} items={[{ key: 'games', label: '游戏列表' }, { key: 'providers', label: '按厂商管理' }]} />

      {activeTab === 'providers' && (
        <Table
          columns={providerColumns}
          dataSource={providerStats}
          rowKey="provider"
          loading={providerStatsLoading}
          pagination={false}
          size="middle"
          style={{ marginTop: 12 }}
        />
      )}

      {activeTab === 'games' && (
        <>
          <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '12px 16px', marginBottom: 14 }}>
            <Row gutter={[8, 8]}>
              <Col span={5}><Input.Search value={search} placeholder="搜索游戏名/关键词" onSearch={() => load(1)} allowClear onChange={(e) => setSearch(e.target.value)} /></Col>
              <Col span={4}>{filterSelect('游戏商', providerFilter, setProviderFilter, providers.map((p) => ({ value: p, label: p })))}</Col>
              <Col span={3}>{filterSelect('前端分类', sortCategoryFilter, setSortCategoryFilter, [{ value: 'slots', label: 'Slots' }, { value: 'fishing', label: 'Fishing' }, { value: 'live', label: 'Live' }, { value: 'bingo', label: 'Bingo' }, { value: 'crash', label: 'Crash' }, { value: 'table', label: 'Table' }])}</Col>
              <Col span={3}>{filterSelect('游戏主题', themeFilter, setThemeFilter, ['fishing', 'asian', 'mythology', 'fantasy', 'adventure', 'fruit', 'classic', 'animal'].map((v) => ({ value: v, label: v })))}</Col>
              <Col span={3}>{filterSelect('游戏风格', gameStyleFilter, setGameStyleFilter, ['asian', 'western', 'classic', 'modern'].map((v) => ({ value: v, label: v })))}</Col>
              <Col span={3}>{filterSelect('适合玩家', playerTypeFilter, setPlayerTypeFilter, [{ value: 'casual', label: 'casual 休闲' }, { value: 'regular', label: 'regular 普通' }, { value: 'high-roller', label: 'high-roller 高额' }])}</Col>
              <Col span={3}>{filterSelect('权重分段', weightRangeFilter, setWeightRangeFilter, [{ value: '80-100', label: '高热度 80-100' }, { value: '50-79', label: '中热度 50-79' }, { value: '1-49', label: '低热度 1-49' }, { value: '0-0', label: '未评分 0' }])}</Col>
              <Col span={3}>{filterSelect('波动性', volatilityFilter, setVolatilityFilter, [{ value: 'low', label: '低 Low' }, { value: 'medium', label: '中 Medium' }, { value: 'high', label: '高 High' }, { value: 'very-high', label: '极高 Very High' }])}</Col>
              <Col span={3}>{filterSelect('支持试玩', demoFilter, setDemoFilter, [{ value: 'true', label: '支持试玩' }, { value: 'false', label: '不支持' }])}</Col>
              <Col span={3}>{filterSelect('推荐首页', featuredFilter, setFeaturedFilter, [{ value: 'true', label: '已推荐' }, { value: 'false', label: '未推荐' }])}</Col>
              <Col span={3}>{filterSelect('技术', techFilter, setTechFilter, [{ value: 'HTML5', label: 'HTML5' }, { value: 'Flash', label: 'Flash' }])}</Col>
              <Col span={3}>{filterSelect('状态', activeFilter, setActiveFilter, [{ value: 'true', label: '已启用' }, { value: 'false', label: '已禁用' }])}</Col>
              <Col span={3} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button type="primary" size="small" onClick={() => load(1)}>查询</Button>
                <Button size="small" onClick={resetFilters}>重置</Button>
              </Col>
              <Col span={3} style={{ display: 'flex', alignItems: 'center' }}>
                <Tag color="blue">共 {total} 款</Tag>
              </Col>
            </Row>
          </div>
          <Table
            columns={columns}
            dataSource={games}
            loading={loading}
            pagination={pagination}
            rowKey="uuid"
            size="small"
            scroll={{ x: 1400 }}
            onChange={handleTableChange}
          />
        </>
      )}

      {/* 详情弹窗 */}
      <Modal
        open={detailVisible}
        title={detailGame?.name}
        footer={null}
        onCancel={() => setDetailVisible(false)}
        width={680}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '16px 20px' } }}
        destroyOnHidden
      >
        {detailGame && (
          <div>
            {(detailGame.imageHqUrl || detailGame.imageUrl) && (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <img src={detailGame.imageHqUrl || detailGame.imageUrl || ''} style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 6 }} />
              </div>
            )}
            <Descriptions title="基本信息" column={2} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="UUID" span={2}><span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{detailGame.uuid}</span></Descriptions.Item>
              <Descriptions.Item label="游戏商">{detailGame.provider}{detailGame.providerId && <span style={{ color: '#999', fontSize: 11 }}> (ID: {detailGame.providerId})</span>}</Descriptions.Item>
              <Descriptions.Item label="子标签">{detailGame.label || '—'}</Descriptions.Item>
              <Descriptions.Item label="技术">{detailGame.technology ? <Tag color={detailGame.technology === 'HTML5' ? 'blue' : 'orange'}>{detailGame.technology}</Tag> : '—'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={detailGame.isActive ? 'green' : 'red'}>{detailGame.isActive ? '已启用' : '已禁用'}</Tag></Descriptions.Item>
              <Descriptions.Item label="更新时间" span={2}>{detailGame.updatedAt ? new Date(detailGame.updatedAt).toLocaleString('zh-CN') : '—'}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="分类信息" column={2} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="前端分类">{detailGame.sortCategory ? <Tag color={sortCategoryColor(detailGame.sortCategory)}>{detailGame.sortCategory}</Tag> : '—'}</Descriptions.Item>
              <Descriptions.Item label="游戏类型">{detailGame.type || '—'}</Descriptions.Item>
              <Descriptions.Item label="分类">{detailGame.category || '—'}</Descriptions.Item>
              <Descriptions.Item label="子分类">{detailGame.subCategory || '—'}</Descriptions.Item>
              <Descriptions.Item label="游戏主题">{detailGame.theme || '—'}</Descriptions.Item>
              <Descriptions.Item label="游戏风格">{detailGame.gameStyle || '—'}</Descriptions.Item>
              <Descriptions.Item label="适合玩家" span={2}>{detailGame.playerType ? <Tag color={playerTypeColor(detailGame.playerType)}>{detailGame.playerType}</Tag> : '—'}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="游戏参数" column={2} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="RTP">{detailGame.rtp != null ? detailGame.rtp + '%' : '—'}</Descriptions.Item>
              <Descriptions.Item label="波动性">{detailGame.volatility ? <Tag color={volatilityColor(detailGame.volatility)}>{detailGame.volatility}</Tag> : '—'}</Descriptions.Item>
              <Descriptions.Item label="转轮数">{detailGame.reelsCount || '—'}</Descriptions.Item>
              <Descriptions.Item label="赔付线">{detailGame.linesCount ?? '—'}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="多语言名称" column={1} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="英语 (en)">{detailGame.name}</Descriptions.Item>
              <Descriptions.Item label="印尼语 (id)">{detailGame.nameId || <span style={{ color: '#bbb' }}>未翻译</span>}</Descriptions.Item>
              <Descriptions.Item label="越南语 (vi)">{detailGame.nameVi || <span style={{ color: '#bbb' }}>未翻译</span>}</Descriptions.Item>
              <Descriptions.Item label="中文 (zh-CN)">{detailGame.nameZh || <span style={{ color: '#bbb' }}>未翻译</span>}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="AI 富化数据" column={1} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="热度权重">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Progress type="line" percent={detailGame.weight} strokeWidth={8} strokeColor={weightColor(detailGame.weight)} showInfo={false} style={{ flex: 1, margin: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 500, width: 30 }}>{detailGame.weight}</span>
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="PH热度(ph_bonus)"><span style={{ fontSize: 13, fontWeight: 500, color: '#1677ff' }}>{detailGame.phBonus}</span><span style={{ fontSize: 11, color: '#999' }}> / 30</span></Descriptions.Item>
              <Descriptions.Item label="推荐首页"><Tag color={detailGame.isFeatured ? 'gold' : 'default'}>{detailGame.isFeatured ? '已推荐' : '未推荐'}</Tag></Descriptions.Item>
              <Descriptions.Item label="中文简介"><span style={{ whiteSpace: 'pre-wrap' }}>{detailGame.descriptionZh || '—'}</span></Descriptions.Item>
              <Descriptions.Item label="英文简介"><span style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{detailGame.descriptionEn || '—'}</span></Descriptions.Item>
              <Descriptions.Item label="搜索关键词"><span style={{ fontSize: 11, wordBreak: 'break-all' }}>{detailGame.searchKeywords || '—'}</span></Descriptions.Item>
              <Descriptions.Item label="权重更新时间">{detailGame.weightUpdatedAt ? new Date(detailGame.weightUpdatedAt).toLocaleString('zh-CN') : '—'}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="功能特性" column={2} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="支持试玩"><Tag color={detailGame.hasDemo ? 'blue' : 'default'}>{detailGame.hasDemo ? '支持' : '不支持'}</Tag></Descriptions.Item>
              <Descriptions.Item label="手机端"><Tag color={detailGame.isMobile ? 'green' : 'default'}>{detailGame.isMobile ? '支持' : '不支持'}</Tag></Descriptions.Item>
              <Descriptions.Item label="免费旋转"><Tag color={detailGame.hasFreespins ? 'purple' : 'default'}>{detailGame.hasFreespins ? '支持' : '不支持'}</Tag></Descriptions.Item>
              <Descriptions.Item label="大厅模式"><Tag color={detailGame.hasLobby ? 'cyan' : 'default'}>{detailGame.hasLobby ? '支持' : '不支持'}</Tag></Descriptions.Item>
              <Descriptions.Item label="桌台" span={2}><Tag color={detailGame.hasTables ? 'geekblue' : 'default'}>{detailGame.hasTables ? '有' : '无'}</Tag></Descriptions.Item>
              {detailGame.tags?.length > 0 && <Descriptions.Item label="标签" span={2}>{detailGame.tags.map((t) => <Tag key={t} style={{ margin: 2 }}>{t}</Tag>)}</Descriptions.Item>}
            </Descriptions>
            <Descriptions title="图片" column={1} bordered size="small">
              <Descriptions.Item label="标准图">{detailGame.imageUrl ? <a href={detailGame.imageUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, wordBreak: 'break-all' }}>{detailGame.imageUrl}</a> : <span style={{ color: '#ccc' }}>—</span>}</Descriptions.Item>
              <Descriptions.Item label="高清图">{detailGame.imageHqUrl ? <a href={detailGame.imageHqUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, wordBreak: 'break-all' }}>{detailGame.imageHqUrl}</a> : <span style={{ color: '#ccc' }}>—</span>}</Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Modal>

      {/* 任务进度弹窗 */}
      <Modal
        open={jobModal.visible}
        title={jobModal.title}
        footer={null}
        closable={jobModal.closable}
        maskClosable={false}
        width={420}
        onCancel={() => setJobModal((m) => ({ ...m, visible: false }))}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>{jobModal.msg}</p>
        {jobModal.total > 0
          ? <Progress percent={jobModal.percent} status={jobModal.status} />
          : <Spin />
        }
      </Modal>
    </div>
  )
}
