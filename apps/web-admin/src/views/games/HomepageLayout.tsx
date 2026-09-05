import { useCallback, useEffect, useRef, useState } from 'react'
import { HolderOutlined } from '@ant-design/icons'
import { Table, Select, Button, message, Tag, Space, Alert, Typography, Switch, InputNumber } from 'antd'
import { getHomeLayout, putHomeLayout, type HomeLayoutRow } from '../../api'

const { Title } = Typography

const CURRENCIES = [{ value: 'PHP', label: 'PHP 首页' }, { value: 'USDT', label: 'USDT 首页' }]

// 可配「展示数量」的块：游戏块 + 厂商专区（其余运营块是横条/轮播，没有"几个"的概念；
// 最近在玩本就按用户记录自截断，给它一个数量框只会让人以为能调）
const LIMIT_KEYS = new Set(['providerZone'])
// 可配「卡型」的块：只有游戏块（运营块的形态是固定的横条/轮播）
const canSetLimit = (r: HomeLayoutRow) => r.kind === 'game' || LIMIT_KEYS.has(r.sectionKey)
const canSetLayout = (r: HomeLayoutRow) => r.kind === 'game'

export default function HomepageLayout() {
  const [currency, setCurrency] = useState('PHP')
  const [rows, setRows] = useState<HomeLayoutRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getHomeLayout(currency)
      setRows(r.items)
      setDirty(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }, [currency])
  useEffect(() => { void load() }, [load])

  const mutate = (next: HomeLayoutRow[]) => { setRows(next); setDirty(true) }

  // 拖拽排序用原生 HTML5 drag —— 19 行的表格不值得为它引一个 dnd 库。
  // ↑↓ 按钮保留：拖拽在触控板上容易拖过头，精调还是点按钮快
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const drop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from === null || from === to) return
    const next = [...rows]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    mutate(next)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    mutate(next)
  }
  const patchParams = (i: number, patch: { limit?: number | null; layout?: 'big' | 'small' | null }) => {
    mutate(rows.map((r, k) => {
      if (k !== i) return r
      const p = { ...(r.params ?? {}) } as { limit?: number; layout?: 'big' | 'small' }
      if ('limit' in patch) { if (patch.limit == null) delete p.limit; else p.limit = patch.limit }
      if ('layout' in patch) { if (patch.layout == null) delete p.layout; else p.layout = patch.layout }
      return { ...r, params: Object.keys(p).length ? p : null }
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      await putHomeLayout(currency, rows.map((r) => ({ sectionKey: r.sectionKey, hidden: r.hidden, params: r.params })))
      message.success('已保存，前台首页立即生效')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  const columns = [
    {
      title: '', width: 40,
      render: () => <HolderOutlined style={{ cursor: 'grab', color: '#999' }} />,
    },
    { title: '顺序', width: 60, render: (_: unknown, __: HomeLayoutRow, i: number) => <span style={{ color: '#999' }}>{i + 1}</span> },
    {
      title: '区块', render: (_: unknown, r: HomeLayoutRow) => (
        <Space>
          <span style={{ fontWeight: 600 }}>{r.label}</span>
          <Tag color={r.kind === 'game' ? 'blue' : 'default'}>{r.kind === 'game' ? '游戏板块' : '运营块'}</Tag>
          <span style={{ fontSize: 12, color: '#bbb' }}>{r.sectionKey}</span>
        </Space>
      ),
    },
    {
      title: '前台显示', width: 100, render: (_: unknown, r: HomeLayoutRow, i: number) => (
        <Switch checked={!r.hidden} checkedChildren="显示" unCheckedChildren="隐藏"
          onChange={(v) => mutate(rows.map((x, k) => k === i ? { ...x, hidden: !v } : x))} />
      ),
    },
    {
      title: '展示数量', width: 120, render: (_: unknown, r: HomeLayoutRow, i: number) => (
        canSetLimit(r)
          ? <InputNumber min={1} max={60} placeholder="默认" style={{ width: 90 }} value={r.params?.limit ?? null}
              onChange={(v) => patchParams(i, { limit: v ?? null })} />
          : <span style={{ color: '#ccc' }}>—</span>
      ),
    },
    {
      title: '卡型', width: 130, render: (_: unknown, r: HomeLayoutRow, i: number) => (
        canSetLayout(r)
          ? <Select style={{ width: 110 }} allowClear placeholder="默认" value={r.params?.layout ?? null}
              onChange={(v) => patchParams(i, { layout: v ?? null })}
              options={[{ value: 'big', label: '大卡 3 列' }, { value: 'small', label: '小卡横滑' }]} />
          : <span style={{ color: '#ccc' }}>—</span>
      ),
    },
    {
      title: '调序', width: 110, render: (_: unknown, __: HomeLayoutRow, i: number) => (
        <Space size={4}>
          <Button size="small" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
          <Button size="small" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} align="center">
        <Title level={4} style={{ margin: 0 }}>首页布局</Title>
        <Space>
          <Select value={currency} style={{ width: 160 }} onChange={setCurrency} options={CURRENCIES} />
          {dirty && <Tag color="orange">未保存</Tag>}
          <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>保存并生效</Button>
        </Space>
      </Space>

      <Alert style={{ marginBottom: 12 }} type="info" showIcon
        message="拖动行调整顺序（也可用 ↑↓ 精调），保存后立即重建首页并生效"
        description="运营块（Banner、公告、活动横条、厂商专区、投注榜）此前只能改代码，现在可直接排序与开关。Banner/卡片的图片与跳转仍在「首页装修」页配置。展示数量留空=用前端默认；卡型留空=用该板块默认形态。游戏板块内部的钉位/移除/冻结仍在「首页板块配置」页。顺序与显示按币种分别配置。" />

      <Table<HomeLayoutRow> rowKey="sectionKey" size="small" loading={loading} columns={columns}
        dataSource={rows} pagination={false}
        onRow={(_, index) => ({
          draggable: true,
          onDragStart: () => { dragFrom.current = index ?? null },
          onDragOver: (e) => { e.preventDefault(); setDragOver(index ?? null) },
          onDragLeave: () => setDragOver((cur) => (cur === index ? null : cur)),
          onDrop: () => drop(index ?? 0),
          onDragEnd: () => { dragFrom.current = null; setDragOver(null) },
          style: {
            cursor: 'grab',
            // 拖到哪一行要看得见，否则松手全靠猜
            borderTop: dragOver === index && dragFrom.current !== null && dragFrom.current > (index ?? 0)
              ? '2px solid #1677ff' : undefined,
            borderBottom: dragOver === index && dragFrom.current !== null && dragFrom.current < (index ?? 0)
              ? '2px solid #1677ff' : undefined,
          },
        })} />
    </div>
  )
}
