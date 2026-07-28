import { useCallback, useEffect, useState } from 'react'
import { Table, Select, Button, Modal, Input, message, Tag, Space, Popconfirm, Image, Alert, Tabs, Typography, Empty } from 'antd'
import {
  getHomepageSections,
  getPublicHomepage,
  putHomepageSection,
  getAdminWin568Games,
  freezeHomepageSection,
  unfreezeHomepageSection,
  type HomepageSectionEntry,
  type PublicHomepageGame,
  type AdminWin568Game,
  type FrozenBoardStatus,
} from '../../api'

const { Title } = Typography

// 冻结控制条：仅 popular/recommended/highRebate 显示。把当前(算法+钉)内容冻结成固定名单。
function FreezeControl({ sectionKey, currency, frozenCount, onChanged }: {
  sectionKey: string; currency: string; frozenCount: number | null; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const isFrozen = frozenCount != null && frozenCount > 0
  const freeze = async () => {
    setBusy(true)
    try {
      const r = await freezeHomepageSection(sectionKey, currency)
      message.success(`已冻结 ${r.count} 款为固定名单`)
      onChanged()
    } catch (e) { message.error(e instanceof Error ? e.message : '冻结失败') } finally { setBusy(false) }
  }
  const unfreeze = async () => {
    setBusy(true)
    try {
      await unfreezeHomepageSection(sectionKey, currency)
      message.success('已恢复为算法推荐')
      onChanged()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  return (
    <Alert
      style={{ marginBottom: 12 }}
      type={isFrozen ? 'success' : 'warning'}
      showIcon
      message={isFrozen
        ? `已冻结（固定名单 ${frozenCount} 款）—— 前台固定展示下方内容，不再跑算法`
        : '未冻结 —— 前台仍按算法实时推荐'}
      description={isFrozen
        ? '维护中的游戏仍留在名单里（前端置灰，恢复后自动变亮）。改动下方钉/权重后点「重新生成并冻结」才生效，或「恢复算法」取消固定。'
        : '内容满意后点「生成并冻结」，把当前（算法+钉）的实际内容固定下来；之后前台就固定读它、不再变动。建议在上游游戏正常时冻结。'}
      action={
        <Space direction="vertical">
          {isFrozen ? (
            <>
              <Popconfirm title="按当前钉/权重重算并覆盖固定名单？" onConfirm={freeze}>
                <Button size="small" type="primary" loading={busy}>重新生成并冻结</Button>
              </Popconfirm>
              <Popconfirm title="恢复为算法实时推荐？" onConfirm={unfreeze}>
                <Button size="small" danger loading={busy}>恢复算法</Button>
              </Popconfirm>
            </>
          ) : (
            <Popconfirm title="把当前实际内容冻结为固定名单？" onConfirm={freeze}>
              <Button size="small" type="primary" loading={busy}>生成并冻结</Button>
            </Popconfirm>
          )}
        </Space>
      }
    />
  )
}

// 板块顺序与前端首页渲染顺序一致
const SECTION_ORDER = ['recommended', 'popular', 'highRebate', 'highRtp', 'slots', 'casino', 'newGames', 'perya', 'fishing', 'lottery', 'baccarat', 'sports']
const SECTION_LABELS: Record<string, string> = {
  popular: '热门推荐',
  recommended: '推荐精选',
  newGames: '最新上线',
  slots: '电子/老虎机',
  casino: '真人娱乐',
  perya: 'Perya（含宾果）',
  fishing: '捕鱼',
  lottery: '彩票 & 其他',
  baccarat: '百家乐',
  highRtp: '高RTP 97%+',
  highRebate: '高洗码游戏',
  sports: '体育游戏',
}
const CURRENCIES = [{ value: 'PHP', label: 'PHP 首页' }, { value: 'USDT', label: 'USDT 首页' }]

// 编辑态：一行游戏。pinned=已固定(手动锁位)，否则为策略实时推荐
interface Item { gameUuid: string; name: string; provider: string; imageUrl: string | null; pinned: boolean }

interface EditorProps {
  sectionKey: string
  currency: string
  baseline: PublicHomepageGame[]
  overrides: HomepageSectionEntry[]
  onSaved: () => void
}

function SectionEditor({ sectionKey, currency, baseline, overrides, onSaved }: EditorProps) {
  const [items, setItems] = useState<Item[]>([])
  const [excluded, setExcluded] = useState<Item[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [results, setResults] = useState<AdminWin568Game[]>([])

  // 从基线 + 覆盖项重建本地编辑态（切板块/币种/保存后触发）
  useEffect(() => {
    const applic = overrides.filter((o) => o.currency === currency || o.currency === '')
    const pinnedUuids = new Set(applic.filter((o) => o.action === 'pin').map((o) => o.gameUuid))
    setItems(baseline.map((g) => ({
      gameUuid: g.uuid, name: g.name, provider: g.provider, imageUrl: g.imageUrl, pinned: pinnedUuids.has(g.uuid),
    })))
    setExcluded(applic.filter((o) => o.action === 'exclude').map((o) => ({
      gameUuid: o.gameUuid, name: o.name ?? o.gameUuid, provider: o.provider ?? '', imageUrl: o.imageUrl, pinned: false,
    })))
    setDirty(false)
  }, [baseline, overrides, currency, sectionKey])

  const mutate = (next: Item[]) => { setItems(next); setDirty(true) }
  const setPinned = (i: number, pinned: boolean) => mutate(items.map((it, k) => k === i ? { ...it, pinned } : it))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    mutate(next)
  }
  const exclude = (i: number) => {
    const it = items[i]
    setExcluded((e) => e.some((x) => x.gameUuid === it.gameUuid) ? e : [...e, { ...it, pinned: false }])
    mutate(items.filter((_, k) => k !== i))
  }
  const undoExclude = (uuid: string) => {
    const it = excluded.find((x) => x.gameUuid === uuid)
    setExcluded((e) => e.filter((x) => x.gameUuid !== uuid))
    if (it) mutate([...items, { ...it, pinned: false }])
  }

  const runSearch = async () => {
    setSearchLoading(true)
    try {
      const res = await getAdminWin568Games({ search, pageSize: 20, currency })
      setResults(res.items)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '搜索失败')
    } finally { setSearchLoading(false) }
  }
  const addGame = (g: AdminWin568Game) => {
    if (items.some((x) => x.gameUuid === g.uuid)) { message.info('该游戏已在列表中'); return }
    setExcluded((e) => e.filter((x) => x.gameUuid !== g.uuid))
    mutate([...items, { gameUuid: g.uuid, name: g.name, provider: g.provider, imageUrl: g.imageUrl, pinned: true }])
    message.success(`已添加并固定 ${g.name}`)
  }

  const save = async () => {
    setSaving(true)
    try {
      const pins = items
        .map((it, idx) => ({ it, idx }))
        .filter((x) => x.it.pinned)
        .map((x) => ({ gameUuid: x.it.gameUuid, action: 'pin' as const, pinPosition: x.idx + 1 }))
      const exs = excluded.map((x) => ({ gameUuid: x.gameUuid, action: 'exclude' as const, pinPosition: null }))
      await putHomepageSection(sectionKey, currency, [...pins, ...exs])
      message.success('已保存并重建首页选品')
      onSaved()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  const columns = [
    {
      title: '位置', width: 70, render: (_: unknown, __: Item, i: number) => <span style={{ color: '#999' }}>{i + 1}</span>,
    },
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
      title: '来源', width: 110, render: (_: unknown, r: Item) => (
        r.pinned ? <Tag color="gold">📌 已固定</Tag> : <Tag>策略推荐</Tag>
      ),
    },
    {
      title: '操作', width: 260, render: (_: unknown, r: Item, i: number) => (
        <Space size={4}>
          {r.pinned ? (
            <>
              <Button size="small" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
              <Button size="small" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</Button>
              <Button size="small" onClick={() => setPinned(i, false)}>取消固定</Button>
            </>
          ) : (
            <Button size="small" type="primary" ghost onClick={() => setPinned(i, true)}>📌 固定</Button>
          )}
          <Popconfirm title="从该板块移除？" onConfirm={() => exclude(i)}><Button size="small" danger>移除</Button></Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="dashed" onClick={() => { setResults([]); setSearch(''); setPickerOpen(true) }}>+ 添加游戏</Button>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>保存并生效</Button>
        {dirty && <Tag color="orange">未保存</Tag>}
        <span style={{ color: '#999' }}>共 {items.length} 款{excluded.length ? ` · 已移除 ${excluded.length}` : ''}</span>
      </Space>

      <Table<Item> rowKey="gameUuid" size="small" columns={columns} dataSource={items} pagination={false}
        locale={{ emptyText: '该板块暂无推荐（可能所选币种下无可用游戏）' }} />

      {excluded.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, color: '#999' }}>已移除（不会出现在该板块）：</div>
          <Space wrap>
            {excluded.map((x) => (
              <Tag key={x.gameUuid} closable onClose={(e) => { e.preventDefault(); undoExclude(x.gameUuid) }}>
                {x.name}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      <Modal title="添加游戏" open={pickerOpen} onCancel={() => setPickerOpen(false)} footer={null} width={640}>
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

export default function HomepageSections() {
  const [currency, setCurrency] = useState('PHP')
  const [activeSection, setActiveSection] = useState('popular')
  const [baseline, setBaseline] = useState<Record<string, PublicHomepageGame[]>>({})
  const [overrides, setOverrides] = useState<Record<string, HomepageSectionEntry[]>>({})
  const [frozen, setFrozen] = useState<FrozenBoardStatus[]>([])
  const [freezableKeys, setFreezableKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [home, ov] = await Promise.all([getPublicHomepage(currency), getHomepageSections()])
      setBaseline(home)
      setOverrides(ov.sections)
      setFrozen(ov.frozen ?? [])
      setFreezableKeys(ov.freezableKeys ?? [])
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }, [currency])
  useEffect(() => { void load() }, [load])

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} align="center">
        <Title level={4} style={{ margin: 0 }}>首页板块配置</Title>
        <Select value={currency} style={{ width: 160 }} onChange={setCurrency} options={CURRENCIES} />
      </Space>

      <Alert style={{ marginBottom: 12 }} type="info" showIcon
        message="下方为该币种首页各板块「当前实际推荐」的游戏，可在此基础上直接调整"
        description="📌 固定：把某款锁定在当前位置（其余空位仍由策略实时轮换填充）；↑↓ 调整已固定游戏的顺序；移除：把某款从该板块剔除。不动的游戏保持策略自动推荐。保存后立即生效。" />

      <Tabs
        activeKey={activeSection}
        onChange={setActiveSection}
        items={SECTION_ORDER.map((key) => ({
          key,
          label: `${SECTION_LABELS[key] ?? key}（${(baseline[key] ?? []).length}）`,
          children: activeSection === key ? (
            loading ? <Empty description="加载中…" /> : (
              <>
                {freezableKeys.includes(key) && (
                  <FreezeControl
                    sectionKey={key}
                    currency={currency}
                    frozenCount={frozen.find((f) => f.sectionKey === key && f.currency === currency)?.count ?? null}
                    onChanged={load}
                  />
                )}
                <SectionEditor
                  key={`${key}:${currency}`}
                  sectionKey={key}
                  currency={currency}
                  baseline={baseline[key] ?? []}
                  overrides={overrides[key] ?? []}
                  onSaved={load}
                />
              </>
            )
          ) : null,
        }))}
      />
    </div>
  )
}
