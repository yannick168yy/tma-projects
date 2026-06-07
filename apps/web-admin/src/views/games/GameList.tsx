import { useEffect, useState } from 'react'
import { Table, Space, Input, Select, Button, Tag, Switch, Progress, Row, Col, message } from 'antd'
import type { TablePaginationConfig, TableProps } from 'antd'
import { getAdminGames, toggleGame, type AdminGame } from '../../api'
import GameDetail from './GameDetail'

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

interface Props { refreshKey: number }

export default function GameList({ refreshKey }: Props) {
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
  const [games, setGames] = useState<AdminGame[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string | undefined>()
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>()
  const [togglingUuid, setTogglingUuid] = useState<string | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailGame, setDetailGame] = useState<AdminGame | null>(null)

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

  useEffect(() => { void load(1) }, [refreshKey])

  function resetFilters() {
    setSearch(''); setProviderFilter(undefined); setSortCategoryFilter(undefined); setThemeFilter(undefined)
    setGameStyleFilter(undefined); setPlayerTypeFilter(undefined); setWeightRangeFilter(undefined)
    setVolatilityFilter(undefined); setDemoFilter(undefined); setFeaturedFilter(undefined)
    setTechFilter(undefined); setActiveFilter(undefined)
    void load(1, true)
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

  const filterSelect = (placeholder: string, value: string | undefined, onChange: (v: string | undefined) => void, options: { value: string; label: string }[]) => (
    <Select value={value} placeholder={placeholder} allowClear style={{ width: '100%' }} onChange={onChange} options={options} />
  )

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

  const pagination: TablePaginationConfig = { current: page, pageSize: 20, total, showTotal: (t) => `共 ${t} 款`, showSizeChanger: false }

  return (
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
      <Table columns={columns} dataSource={games} loading={loading} pagination={pagination} rowKey="uuid" size="small" scroll={{ x: 1400 }} onChange={handleTableChange} />
      <GameDetail game={detailGame} open={detailVisible} onClose={() => setDetailVisible(false)} />
    </>
  )
}
