import { useEffect, useMemo, useState } from 'react'
import { Table, Select, Button, Modal, Input, message, Tag, Space, Popconfirm, InputNumber, Image, Alert } from 'antd'
import {
  getHomepageSections,
  putHomepageSection,
  getAdminWin568Games,
  type HomepageSectionEntry,
  type AdminWin568Game,
} from '../../api'

const SECTION_LABELS: Record<string, string> = {
  popular: '热门推荐',
  highRebate: '高返利专区',
  newGames: '最新上线',
  slots: '电子 / 老虎机',
  casino: '真人娱乐',
  perya: '斗鸡 Perya',
  fishing: '捕鱼',
  lottery: '彩票 / 宾果',
  mythology: '东方神话',
  megaWin: '巨额倍数 x1000+',
}

const CURRENCY_OPTIONS = [
  { value: '', label: '全币种' },
  { value: 'PHP', label: '仅 PHP' },
  { value: 'USDT', label: '仅 USDT' },
]

// 表格内可编辑的一行（本地态，保存前不落库）
interface Row {
  gameUuid: string
  action: 'pin' | 'exclude'
  pinPosition: number | null
  name: string | null
  provider: string | null
  imageUrl: string | null
}

export default function HomepageSections() {
  const [allSections, setAllSections] = useState<Record<string, HomepageSectionEntry[]>>({})
  const [sectionKeys, setSectionKeys] = useState<string[]>([])
  const [sectionKey, setSectionKey] = useState<string>('popular')
  const [currency, setCurrency] = useState<string>('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // 游戏搜索弹窗
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [results, setResults] = useState<AdminWin568Game[]>([])

  async function load() {
    setLoading(true)
    try {
      const data = await getHomepageSections()
      setAllSections(data.sections)
      setSectionKeys(data.sectionKeys)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  // 切板块/币种 或 数据刷新时，重置本地可编辑行
  useEffect(() => {
    const list = (allSections[sectionKey] ?? [])
      .filter((e) => e.currency === currency)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    setRows(list.map((e) => ({
      gameUuid: e.gameUuid, action: e.action, pinPosition: e.pinPosition,
      name: e.name, provider: e.provider, imageUrl: e.imageUrl,
    })))
    setDirty(false)
  }, [allSections, sectionKey, currency])

  const uuidSet = useMemo(() => new Set(rows.map((r) => r.gameUuid)), [rows])

  function mutate(next: Row[]) { setRows(next); setDirty(true) }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    mutate(next)
  }
  function removeRow(idx: number) { mutate(rows.filter((_, i) => i !== idx)) }
  function setAction(idx: number, action: 'pin' | 'exclude') {
    mutate(rows.map((r, i) => i === idx ? { ...r, action, pinPosition: action === 'exclude' ? null : r.pinPosition } : r))
  }
  function setPos(idx: number, pos: number | null) {
    mutate(rows.map((r, i) => i === idx ? { ...r, pinPosition: pos } : r))
  }

  async function runSearch() {
    setSearchLoading(true)
    try {
      const res = await getAdminWin568Games({ search, pageSize: 20, currency: currency || undefined })
      setResults(res.items)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setSearchLoading(false)
    }
  }
  function addGame(g: AdminWin568Game) {
    if (uuidSet.has(g.uuid)) { message.info('该游戏已在列表中'); return }
    mutate([...rows, { gameUuid: g.uuid, action: 'pin', pinPosition: null, name: g.name, provider: g.provider, imageUrl: g.imageUrl }])
    message.success(`已添加 ${g.name}`)
  }

  async function save() {
    setSaving(true)
    try {
      await putHomepageSection(sectionKey, currency, rows.map((r) => ({
        gameUuid: r.gameUuid, action: r.action, pinPosition: r.action === 'pin' ? r.pinPosition : null,
      })))
      message.success('已保存并重建首页选品')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: '排序', width: 90, render: (_: unknown, __: Row, i: number) => (
        <Space size={4}>
          <Button size="small" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
          <Button size="small" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</Button>
        </Space>
      ),
    },
    {
      title: '游戏', render: (_: unknown, r: Row) => (
        <Space>
          {r.imageUrl ? <Image src={r.imageUrl} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 6 }} preview={false} /> : <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 6 }} />}
          <div>
            <div style={{ fontWeight: 600 }}>{r.name ?? r.gameUuid}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{r.provider ?? ''} · {r.gameUuid}</div>
          </div>
        </Space>
      ),
    },
    {
      title: '类型', width: 140, render: (_: unknown, r: Row, i: number) => (
        <Select size="small" value={r.action} style={{ width: 120 }} onChange={(v) => setAction(i, v)}
          options={[{ value: 'pin', label: '📌 钉位' }, { value: 'exclude', label: '🚫 排除' }]} />
      ),
    },
    {
      title: '指定位置', width: 130, render: (_: unknown, r: Row, i: number) => (
        r.action === 'pin'
          ? <InputNumber size="small" min={1} max={30} placeholder="按上下顺序" value={r.pinPosition ?? undefined} onChange={(v) => setPos(i, v ?? null)} style={{ width: 110 }} />
          : <span style={{ color: '#ccc' }}>—</span>
      ),
    },
    {
      title: '操作', width: 80, render: (_: unknown, __: Row, i: number) => (
        <Popconfirm title="移除该项？" onConfirm={() => removeRow(i)}><Button size="small" danger>删除</Button></Popconfirm>
      ),
    },
  ]

  return (
    <div>
      <Alert style={{ marginBottom: 12 }} type="info" showIcon
        message="板块推荐 = 策略自动打底 + 手动微调"
        description="📌 钉位：把游戏强制排到板块前面（不占厂商配额）；不填“指定位置”则按本表上下顺序前插。🚫 排除：把游戏从该板块剔除。留空的位置由推荐策略自动填满。钉位游戏若不支持所选币种会被自动跳过。" />

      <Space style={{ marginBottom: 12 }} wrap>
        <span>板块：</span>
        <Select value={sectionKey} style={{ width: 180 }} onChange={setSectionKey}
          options={(sectionKeys.length ? sectionKeys : Object.keys(SECTION_LABELS)).map((k) => ({
            value: k, label: `${SECTION_LABELS[k] ?? k}（${(allSections[k] ?? []).length}）`,
          }))} />
        <span style={{ marginLeft: 12 }}>币种：</span>
        <Select value={currency} style={{ width: 140 }} onChange={setCurrency} options={CURRENCY_OPTIONS} />
        <Button type="dashed" onClick={() => { setResults([]); setSearch(''); setPickerOpen(true) }}>+ 添加游戏</Button>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>保存并生效</Button>
        {dirty && <Tag color="orange">未保存</Tag>}
      </Space>

      <Table<Row> rowKey="gameUuid" size="small" loading={loading} columns={columns} dataSource={rows} pagination={false}
        locale={{ emptyText: '该板块暂无手动干预，完全由推荐策略生成' }} />

      <Modal title="添加游戏（钉位/排除）" open={pickerOpen} onCancel={() => setPickerOpen(false)} footer={null} width={640}>
        <Input.Search placeholder="按游戏名/关键词搜索" enterButton loading={searchLoading} value={search}
          onChange={(e) => setSearch(e.target.value)} onSearch={runSearch} style={{ marginBottom: 12 }} />
        <Table<AdminWin568Game> rowKey="uuid" size="small" dataSource={results} pagination={false} scroll={{ y: 360 }}
          columns={[
            {
              title: '游戏', render: (_: unknown, g: AdminWin568Game) => (
                <Space>
                  {g.imageUrl ? <Image src={g.imageUrl} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 6 }} preview={false} /> : <div style={{ width: 36, height: 36, background: '#f0f0f0', borderRadius: 6 }} />}
                  <div>
                    <div style={{ fontWeight: 600 }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>{g.provider} · {g.siteCategory}</div>
                  </div>
                </Space>
              ),
            },
            {
              title: '', width: 80, render: (_: unknown, g: AdminWin568Game) => (
                <Button size="small" type="primary" disabled={uuidSet.has(g.uuid)} onClick={() => addGame(g)}>
                  {uuidSet.has(g.uuid) ? '已加' : '添加'}
                </Button>
              ),
            },
          ]} />
      </Modal>
    </div>
  )
}
