import { useCallback, useEffect, useState } from 'react'
import { Table, Button, Modal, Input, message, Tag, Space, Popconfirm, Image, Alert, Tabs, Typography, Empty } from 'antd'
import {
  getCategorySort,
  putCategorySort,
  getAdminWin568Games,
  type CategorySortEntry,
  type AdminWin568Game,
} from '../../api'

const { Title } = Typography

// 分类顺序/标签与 Games 页一级分类一致
const CATEGORY_ORDER = ['all', 'slot', 'casino', 'perya', 'poker', 'fishing', 'sports', 'lottery', 'other']
const CATEGORY_LABELS: Record<string, string> = {
  all: '全部（All）',
  slot: '电子/老虎机',
  casino: '真人娱乐',
  perya: 'Perya',
  poker: '扑克',
  fishing: '捕鱼',
  sports: '体育',
  lottery: '彩票 & 其他',
  other: '其他',
}

interface Item { gameUuid: string; name: string; provider: string; imageUrl: string | null }

interface EditorProps {
  categoryKey: string
  entries: CategorySortEntry[]
  onSaved: () => void
}

function CategoryEditor({ categoryKey, entries, onSaved }: EditorProps) {
  const [items, setItems] = useState<Item[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [results, setResults] = useState<AdminWin568Game[]>([])

  useEffect(() => {
    setItems(entries.map((e) => ({
      gameUuid: e.gameUuid, name: e.name ?? e.gameUuid, provider: e.provider ?? '', imageUrl: e.imageUrl,
    })))
    setDirty(false)
  }, [entries, categoryKey])

  const mutate = (next: Item[]) => { setItems(next); setDirty(true) }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    mutate(next)
  }
  const remove = (i: number) => mutate(items.filter((_, k) => k !== i))

  const runSearch = async () => {
    setSearchLoading(true)
    try {
      // 全部分类不限 siteCategory；具体分类按其 siteCategory 过滤（分类 id 即 site_category 值）
      const res = await getAdminWin568Games({
        search, pageSize: 20,
        siteCategory: categoryKey === 'all' ? undefined : categoryKey,
      })
      setResults(res.items)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '搜索失败')
    } finally { setSearchLoading(false) }
  }
  const addGame = (g: AdminWin568Game) => {
    if (items.some((x) => x.gameUuid === g.uuid)) { message.info('该游戏已在置顶列表中'); return }
    mutate([...items, { gameUuid: g.uuid, name: g.name, provider: g.provider, imageUrl: g.imageUrl }])
    message.success(`已添加 ${g.name}`)
  }

  const save = async () => {
    setSaving(true)
    try {
      await putCategorySort(categoryKey, items.map((it) => it.gameUuid))
      message.success('已保存并生效')
      onSaved()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  const columns = [
    { title: '位置', width: 60, render: (_: unknown, __: Item, i: number) => <span style={{ color: '#999' }}>{i + 1}</span> },
    {
      title: '游戏', render: (_: unknown, r: Item) => (
        <Space>
          {r.imageUrl ? <Image src={r.imageUrl} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 6 }} preview={false} /> : <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 6 }} />}
          <div>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{r.provider} · {r.gameUuid}</div>
          </div>
        </Space>
      ),
    },
    {
      title: '操作', width: 220, render: (_: unknown, __: Item, i: number) => (
        <Space size={4}>
          <Button size="small" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
          <Button size="small" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</Button>
          <Popconfirm title="移出置顶列表？" onConfirm={() => remove(i)}><Button size="small" danger>移除</Button></Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="dashed" onClick={() => { setResults([]); setSearch(''); setPickerOpen(true) }}>+ 添加置顶游戏</Button>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>保存并生效</Button>
        {dirty && <Tag color="orange">未保存</Tag>}
        <span style={{ color: '#999' }}>已置顶 {items.length} 款，其余按默认权重排序</span>
      </Space>

      <Table<Item> rowKey="gameUuid" size="small" columns={columns} dataSource={items} pagination={false}
        locale={{ emptyText: '暂无置顶游戏，该分类完全按默认权重排序。点「+ 添加置顶游戏」手动置顶。' }} />

      <Modal title={`添加置顶游戏 · ${CATEGORY_LABELS[categoryKey] ?? categoryKey}`} open={pickerOpen} onCancel={() => setPickerOpen(false)} footer={null} width={640}>
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
                <Button size="small" type="primary" disabled={items.some((x) => x.gameUuid === g.uuid)} onClick={() => addGame(g)}>
                  {items.some((x) => x.gameUuid === g.uuid) ? '已加' : '添加'}
                </Button>
              ),
            },
          ]} />
      </Modal>
    </div>
  )
}

export default function CategorySort() {
  const [activeCategory, setActiveCategory] = useState('all')
  const [categories, setCategories] = useState<Record<string, CategorySortEntry[]>>({})
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getCategorySort()
      setCategories(res.categories)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div>
      <Title level={4} style={{ margin: '0 0 12px' }}>分类列表排序</Title>

      <Alert style={{ marginBottom: 12 }} type="info" showIcon
        message="配置 Games 页各分类「All（全部厂商）」列表的置顶顺序"
        description="手动排序 + 缺省：置顶列表里的游戏按此顺序钉在分类最前，未置顶的游戏保持默认权重排序垫后。↑↓ 调整置顶顺序，移除后回落默认。仅作用于用户未筛选具体厂商时的 All 视图。保存后立即生效。" />

      <Tabs
        activeKey={activeCategory}
        onChange={setActiveCategory}
        items={CATEGORY_ORDER.map((key) => ({
          key,
          label: `${CATEGORY_LABELS[key] ?? key}（${(categories[key] ?? []).length}）`,
          children: activeCategory === key ? (
            loading ? <Empty description="加载中…" /> : (
              <CategoryEditor
                key={key}
                categoryKey={key}
                entries={categories[key] ?? []}
                onSaved={load}
              />
            )
          ) : null,
        }))}
      />
    </div>
  )
}
