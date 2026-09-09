import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd'
import { useAuthStore } from '../../stores/auth'
import { applyChange, getCandidates, getRouting, getSources, previewChange, syncWxgame, type Aggregator, type Change, type Config, type Game, type Preview, type Provider, type RouteCurrency, type Rule, type SourceGame } from './game-routing-api'

const aggregatorOptions = [{ value: '568win', label: '568Win' }, { value: 'wxgame', label: 'WXGame' }]
const routeCurrencyOptions = [{ value: 'PHP', label: 'PHP' }, { value: 'IDR', label: 'IDR' }, { value: 'USDT', label: 'USDT' }, { value: '', label: '全部币种（兜底规则）' }]
const levels: Record<string, string> = { global: '全局', provider: '厂商', game: '单游戏', original: '展示来源' }
const errorMessage = (e: unknown) => message.error(e instanceof Error ? e.message : '操作失败')

function SourceSelect({ aggregator, value, onChange }: { aggregator: Aggregator; value?: string; onChange?: (uuid: string) => void }) {
  const [items, setItems] = useState<SourceGame[]>([])
  const [search, setSearch] = useState('')
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      void getSources({ aggregator, search, pageSize: 50 }).then((r) => { if (current) setItems(r.items) }).catch(errorMessage)
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [aggregator, search])
  return <Select allowClear showSearch filterOption={false} placeholder="搜索名称或完整游戏 ID，再人工核对厂商和版本" value={value} onChange={onChange} onSearch={setSearch}
    options={[...(value && !items.some((g) => g.uuid === value) ? [{ value, label: value }] : []), ...items.map((g) => ({ value: g.uuid, label: `${g.name} · ${g.provider} · ${g.uuid}${g.available ? '' : '（维护/下线）'}` }))]} />
}

export default function GameRouting() {
  const [config, setConfig] = useState<Config | null>(null)
  const role = useAuthStore((s) => s.verifiedRole)
  const canEdit = role === 'super_admin' || role === 'ops'
  const [tab, setTab] = useState('games')
  const [editor, setEditor] = useState<{ kind: 'provider'; record?: Provider } | { kind: 'game'; record?: Game } | { kind: 'rule'; scope: Rule['scope']; targetId: number } | null>(null)
  const [form] = Form.useForm()
  const [preview, setPreview] = useState<{ change: Change; data: Preview } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [raw, setRaw] = useState<SourceGame[]>([])
  const [rawTotal, setRawTotal] = useState(0)
  const [rawProviders, setRawProviders] = useState<string[]>([])
  const [filter, setFilter] = useState<{ aggregator: Aggregator; search: string; provider?: string; page: number }>({ aggregator: 'wxgame', search: '', page: 1 })
  const [refresh, setRefresh] = useState(0)
  const [candidateProvider, setCandidateProvider] = useState<Provider | null>(null)
  const [candidates, setCandidates] = useState<{ win: SourceGame; wx: SourceGame }[]>([])
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [candidatePage, setCandidatePage] = useState(1)
  useEffect(() => { void getRouting().then(setConfig).catch(errorMessage) }, [refresh])
  useEffect(() => {
    let current = true
    void getSources({ ...filter, pageSize: 30 }).then((r) => { if (current) { setRaw(r.items); setRawTotal(r.total); setRawProviders(r.providers) } }).catch(errorMessage)
    return () => { current = false }
  }, [filter, refresh])

  function editGame(game?: Game, candidate?: { win: SourceGame; wx: SourceGame }, provider?: Provider) {
    form.resetFields()
    const sources = config?.sources.filter((s) => s.gameId === game?.id) ?? []
    const win = sources.find((s) => s.aggregator === '568win')
    const wx = sources.find((s) => s.aggregator === 'wxgame')
    form.setFieldsValue({ ...game, ...game?.presentation, enabled: game?.enabled ?? false, isActive: game?.isActive ?? true,
      isFeatured: game?.presentation.isFeatured === undefined ? undefined : game.presentation.isFeatured ? 'yes' : 'no',
      providerId: game?.providerId ?? provider?.id,
      name: game?.name ?? candidate?.win.name,
      uuid: game?.uuid ?? candidate?.win.uuid,
      winUuid: win?.uuid ?? candidate?.win.uuid, wxUuid: wx?.uuid ?? candidate?.wx.uuid,
      winCurrencies: win?.currencies ?? candidate?.win.currencies ?? [], wxCurrencies: wx?.currencies ?? candidate?.wx.currencies ?? [], confirmed: false })
    setEditor({ kind: 'game', record: game })
  }
  async function showCandidates(provider: Provider, page = 1) {
    try {
      const result = await getCandidates({ providerId: provider.id, page, pageSize: 30 })
      setCandidateProvider(provider); setCandidates(result.items); setCandidateTotal(result.total); setCandidatePage(page)
    } catch (e) { errorMessage(e) }
  }
  function editProvider(provider?: Provider) {
    form.resetFields()
    form.setFieldsValue({ ...provider, winAliases: provider?.aliases['568win'] ?? [], wxAliases: provider?.aliases.wxgame ?? [] })
    setEditor({ kind: 'provider', record: provider })
  }
  function editRule(scope: Rule['scope'], targetId: number, currency: RouteCurrency = 'PHP') {
    form.resetFields()
    form.setFieldsValue({ currency, aggregator: config?.rules.find((r) => r.scope === scope && r.targetId === targetId && r.currency === currency)?.aggregator ?? 'inherit' })
    setEditor({ kind: 'rule', scope, targetId })
  }
  async function requestPreview() {
    if (!editor) return
    try {
      const v = await form.validateFields()
      let change: Change
      if (editor.kind === 'provider') change = { kind: 'provider', id: editor.record?.id, code: v.code, name: v.name, aliases: { '568win': v.winAliases ?? [], wxgame: v.wxAliases ?? [] } }
      else if (editor.kind === 'rule') change = { kind: 'rule', scope: editor.scope, targetId: editor.targetId, currency: v.currency, aggregator: v.aggregator === 'inherit' ? null : v.aggregator }
      else {
        const sources = [
          ...(v.winUuid ? [{ aggregator: '568win' as const, uuid: v.winUuid, currencies: v.winCurrencies ?? [] }] : []),
          ...(v.wxUuid ? [{ aggregator: 'wxgame' as const, uuid: v.wxUuid, currencies: v.wxCurrencies ?? [] }] : []),
        ]
        change = { kind: 'game', id: editor.record?.id, providerId: v.providerId, uuid: editor.record?.uuid ?? v.uuid, name: v.name,
          enabled: v.enabled, isActive: v.isActive, confirmed: v.confirmed, sources,
          presentation: { imageUrl: v.imageUrl || undefined, sortCategory: v.sortCategory, siteCategory: v.siteCategory, weight: v.weight ?? undefined, isFeatured: v.isFeatured === undefined ? undefined : v.isFeatured === 'yes' } }
      }
      setBusy(true)
      const data = await previewChange(change)
      setReason('')
      setPreview({ change, data })
    } catch (e) { if (!(e && typeof e === 'object' && 'errorFields' in e)) errorMessage(e) } finally { setBusy(false) }
  }
  async function save() {
    if (!preview) return
    setBusy(true)
    try {
      await applyChange(preview.change, preview.data.revision, reason.trim())
      message.success('已保存；配置变更已记录审计')
      setPreview(null); setEditor(null); setRefresh((v) => v + 1)
    } catch (e) { errorMessage(e) } finally { setBusy(false) }
  }
  const ruleText = (scope: Rule['scope'], id: number) => {
    const rules = config?.rules.filter((r) => r.scope === scope && r.targetId === id) ?? []
    return rules.length ? rules.map((r) => `${r.currency || '全部'}→${r.aggregator}`).join('；') : '继承'
  }

  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert showIcon type="info" message="新建映射默认只保存草稿；人工启用后才接管目录和旧入口。未配置游戏保持原行为。" description="路由按币种独立生效，优先级为单游戏 > 厂商 > 全局 > 展示来源。WXGame 开放 PHP/IDR，USDT 继续使用 568Win。切换只影响新的游戏启动。" />
    {!canEdit && <Alert type="warning" message="当前角色只读；super_admin 和 ops 可编辑。" />}
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'games', label: '统一游戏与映射' }, { key: 'providers', label: '统一厂商与路由' }, { key: 'sources', label: '聚合商来源目录' }]} />
    {tab === 'games' && <>
      <Button disabled={!canEdit} type="primary" onClick={() => editGame()}>新建统一游戏</Button>
      <Table<Game> rowKey="id" dataSource={config?.games ?? []} pagination={{ pageSize: 20 }} scroll={{ x: 1100 }} columns={[
        { title: '游戏', dataIndex: 'name' }, { title: '公开 ID', dataIndex: 'uuid' },
        { title: '统一厂商', render: (_, g) => config?.providers.find((p) => p.id === g.providerId)?.name },
        { title: '状态', render: (_, g) => <Tag color={g.enabled ? 'green' : 'default'}>{!g.enabled ? '草稿/未接管' : g.isActive ? '已接管 · 上架' : '已接管 · 下架'}</Tag> },
        { title: '来源映射', render: (_, g) => config?.sources.filter((s) => s.gameId === g.id).map((s) => <div key={s.uuid}>{s.aggregator} · {s.currencies.join('/')}<Typography.Text type="secondary" style={{ display: 'block' }}>{s.uuid}</Typography.Text></div>) },
        { title: '单游戏规则', render: (_, g) => ruleText('game', g.id) },
        { title: '操作', render: (_, g) => <Space><Button size="small" disabled={!canEdit} onClick={() => editGame(g)}>编辑映射</Button><Button size="small" disabled={!canEdit} onClick={() => editRule('game', g.id)}>路由</Button></Space> },
      ]} />
    </>}
    {tab === 'providers' && <>
      <Space><Button type="primary" disabled={!canEdit} onClick={() => editProvider()}>新建统一厂商</Button><Button disabled={!canEdit} onClick={() => editRule('global', 0)}>全局默认：{ruleText('global', 0) === '继承' ? '未设置（各自展示来源）' : ruleText('global', 0)}</Button></Space>
      <Table<Provider> rowKey="id" dataSource={config?.providers ?? []} columns={[
        { title: '编码', dataIndex: 'code' }, { title: '名称', dataIndex: 'name' },
        { title: '上游厂商别名', render: (_, p) => <>{Object.entries(p.aliases).map(([a, names]) => <div key={a}>{a}：{names.join('、') || '未关联'}</div>)}</> },
        { title: '默认来源', render: (_, p) => ruleText('provider', p.id) },
        { title: '操作', render: (_, p) => <Space><Button disabled={!canEdit} onClick={() => editProvider(p)}>编辑厂商</Button><Button onClick={() => void showCandidates(p)}>匹配候选</Button><Button disabled={!canEdit} onClick={() => editRule('provider', p.id)}>切换预览</Button></Space> },
      ]} />
    </>}
    {tab === 'sources' && <>
      <Space wrap>
        <Select value={filter.aggregator} options={aggregatorOptions} onChange={(aggregator) => setFilter({ aggregator, search: '', page: 1 })} style={{ width: 140 }} />
        <Select showSearch allowClear placeholder="厂商" value={filter.provider} options={rawProviders.map((p) => ({ value: p, label: p }))} onChange={(provider) => setFilter({ ...filter, provider, page: 1 })} style={{ width: 180 }} />
        <Input.Search key={filter.aggregator} placeholder="名称或游戏 ID" onSearch={(search) => setFilter({ ...filter, search, page: 1 })} style={{ width: 280 }} />
        {filter.aggregator === 'wxgame' && <Button disabled={!canEdit} loading={busy} onClick={() => Modal.confirm({ title: '同步 WXGame 原始目录？', content: '只刷新原始目录，不建立映射或切换路由。', onOk: async () => { setBusy(true); try { const r = await syncWxgame(); message.success(`已读取 ${r.received} 款游戏`); setRefresh((v) => v + 1) } finally { setBusy(false) } } })}>同步 WXGame</Button>}
      </Space>
      <Table<SourceGame> rowKey="uuid" dataSource={raw} scroll={{ x: 1050 }} pagination={{ current: filter.page, total: rawTotal, pageSize: 30, showSizeChanger: false, onChange: (page) => setFilter({ ...filter, page }) }} columns={[
        { title: '名称', dataIndex: 'name' }, { title: '厂商', dataIndex: 'provider' }, { title: '上游游戏 ID', dataIndex: 'uuid' },
        { title: '上游状态', render: (_, g) => <Tag color={g.available ? 'green' : 'orange'}>{g.available ? '可用' : '维护/下线'}</Tag> },
        { title: '币种', render: (_, g) => g.currencies?.join('/') || '上游未声明，需人工确认' },
        { title: '点控能力', render: (_, g) => g.supportsRtp ? '支持' : '不支持/未确认' },
        { title: '映射', render: (_, g) => { const s = config?.sources.find((s) => s.uuid === g.uuid); return s ? config?.games.find((x) => x.id === s.gameId)?.name : '未映射' } },
      ]} />
    </>}
    <Modal width={800} open={!!editor} title={editor?.kind === 'provider' ? '统一厂商与别名' : editor?.kind === 'rule' ? `${levels[editor.scope]}路由设置` : '统一游戏与来源映射'} onCancel={() => setEditor(null)} onOk={requestPreview} okText="预览影响（不保存）" confirmLoading={busy} destroyOnClose>
      <Form form={form} layout="vertical">
        {editor?.kind === 'provider' && <>
          <Form.Item name="code" label="统一厂商编码" rules={[{ required: true }]}><Input placeholder="例如 pg" /></Form.Item>
          <Form.Item name="name" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="winAliases" label="568Win 厂商原始名称（精确匹配）"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
          <Form.Item name="wxAliases" label="WXGame 厂商原始名称（精确匹配）"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
        </>}
        {editor?.kind === 'rule' && <>
          <Alert type="info" message="同一币种按单游戏 > 厂商 > 全局 > 展示来源；全部币种规则只作同层级兜底。缺少目标映射不会自动换家。" style={{ marginBottom: 16 }} />
          <Form.Item name="currency" label="生效币种"><Select options={routeCurrencyOptions} onChange={(currency: RouteCurrency) => form.setFieldValue('aggregator', config?.rules.find((r) => r.scope === editor.scope && r.targetId === editor.targetId && r.currency === currency)?.aggregator ?? 'inherit')} /></Form.Item>
          <Form.Item name="aggregator" label="主来源"><Select options={[{ value: 'inherit', label: editor.scope === 'global' ? '不设置（保持展示来源）' : '继承上级规则' }, ...aggregatorOptions]} /></Form.Item>
        </>}
        {editor?.kind === 'game' && <>
          <Form.Item name="providerId" label="统一厂商" rules={[{ required: true }]}><Select disabled={editor.record?.enabled} options={config?.providers.map((p) => ({ value: p.id, label: p.name }))} /></Form.Item>
          <Form.Item name="name" label="统一显示名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="winUuid" label="568Win 来源（按名称搜索候选，再核对版本）"><SourceSelect aggregator="568win" /></Form.Item>
          <Form.Item name="winCurrencies" label="568Win 已确认币种"><Select mode="multiple" options={['PHP', 'USDT', 'IDR'].map((v) => ({ value: v }))} /></Form.Item>
          <Form.Item name="wxUuid" label="WXGame 来源（按名称搜索候选，再核对版本）"><SourceSelect aggregator="wxgame" /></Form.Item>
          <Form.Item name="wxCurrencies" label="WXGame 已确认币种"><Select mode="multiple" options={['PHP', 'IDR'].map((value) => ({ value }))} /></Form.Item>
          <Form.Item shouldUpdate={(a, b) => a.winUuid !== b.winUuid || a.wxUuid !== b.wxUuid}>{() => <Form.Item name="uuid" label="公开 ID / 展示继承来源（创建后固定）" rules={[{ required: true }]}><Select disabled={!!editor.record} options={[form.getFieldValue('winUuid'), form.getFieldValue('wxUuid')].filter(Boolean).map((v) => ({ value: v, label: v }))} /></Form.Item>}</Form.Item>
          <Form.Item name="imageUrl" label="统一封面（留空继承）"><Input /></Form.Item>
          <Space align="start" wrap>
            <Form.Item name="sortCategory" label="游戏分类"><Select allowClear style={{ width: 160 }} options={['slots', 'live', 'sports', 'fishing', 'table', 'other'].map((value) => ({ value }))} /></Form.Item>
            <Form.Item name="siteCategory" label="站点分类"><Select allowClear style={{ width: 160 }} options={['slots', 'casino', 'perya', 'fishing', 'lottery', 'baccarat', 'sports', 'other'].map((value) => ({ value }))} /></Form.Item>
            <Form.Item name="weight" label="排序权重（留空继承）"><InputNumber min={0} max={10000} /></Form.Item>
          </Space>
          <Form.Item name="isFeatured" label="精选（留空继承）"><Select allowClear options={[{ value: 'yes', label: '精选' }, { value: 'no', label: '不精选' }]} /></Form.Item>
          <Form.Item name="isActive" label="统一上架状态" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="enabled" label="启用接管（草稿保存后才可启用）" valuePropName="checked"><Switch disabled={!editor.record} /></Form.Item>
          <Form.Item name="confirmed" valuePropName="checked" rules={[{ validator: (_, v) => v ? Promise.resolve() : Promise.reject(new Error('请先确认映射与币种')) }]}><Checkbox>已人工核对厂商、游戏版本和币种；以上来源可对应同一业务游戏</Checkbox></Form.Item>
        </>}
      </Form>
    </Modal>
    <Modal width={1000} open={!!preview} title="变更影响预览" onCancel={() => setPreview(null)} onOk={save} okText="确认保存配置" confirmLoading={busy} okButtonProps={{ disabled: !reason.trim() || !!preview?.data.blocking }}>
      {preview && <>
        <Alert type={preview.data.blocking ? 'error' : 'info'} showIcon message={`路由变化 ${preview.data.changed} 条（游戏×币种）；缺少映射 ${preview.data.missing} 条；维护或映射问题 ${preview.data.unavailable} 条；未映射来源 ${preview.data.unmapped} 条`} description="草稿不会改变实际流量。已启用游戏切换到不可用来源时不能保存；未映射来源保持原行为。" />
        <Table rowKey={(r) => `${r.id}:${r.currency}`} size="small" dataSource={preview.data.rows} pagination={{ pageSize: 8 }} scroll={{ x: 800 }} columns={[
          { title: '游戏', dataIndex: 'name' }, { title: '币种', dataIndex: 'currency' }, { title: '接管', render: (_, r) => r.enabled ? '已启用' : '草稿' },
          { title: '原来源', dataIndex: 'before' }, { title: '新来源', dataIndex: 'after' }, { title: '规则层级', render: (_, r) => levels[r.level] },
          { title: '来源支持币种', render: (_, r) => r.currencies.join('/') }, { title: '问题', dataIndex: 'issue' },
        ]} />
        {!!preview.data.unmappedItems.length && <details><summary>未映射来源（不会被此次切换接管）</summary>{preview.data.unmappedItems.map((s) => <div key={s.uuid}>{s.name} · {s.uuid}</div>)}</details>}
        <Input.TextArea value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} placeholder="请输入操作原因，将与变更前后配置一起记录审计" />
      </>}
    </Modal>
    <Modal width={1100} open={!!candidateProvider} title={`${candidateProvider?.name ?? ''} 同名匹配候选`} footer={null} onCancel={() => setCandidateProvider(null)}>
      <Alert type="warning" showIcon message="这里只按规范化后的完整名称生成候选，不会自动建立映射。请人工核对厂商、版本和币种。" style={{ marginBottom: 12 }} />
      <Table rowKey={(r) => `${r.win.uuid}|${r.wx.uuid}`} dataSource={candidates} pagination={{ current: candidatePage, pageSize: 30, total: candidateTotal, showSizeChanger: false, onChange: (page) => { if (candidateProvider) void showCandidates(candidateProvider, page) } }} scroll={{ x: 900 }} columns={[
        { title: '568Win', render: (_, r) => <>{r.win.name}<Typography.Text type="secondary" style={{ display: 'block' }}>{r.win.uuid}</Typography.Text></> },
        { title: 'WXGame', render: (_, r) => <>{r.wx.name}<Typography.Text type="secondary" style={{ display: 'block' }}>{r.wx.uuid}</Typography.Text></> },
        { title: '状态', render: (_, r) => <>{r.win.available ? '568Win 可用' : '568Win 维护/下线'}；{r.wx.available ? 'WXGame 可用' : 'WXGame 维护/下线'}</> },
        { title: '操作', render: (_, r) => <Button disabled={!canEdit} onClick={() => { const provider = candidateProvider!; setCandidateProvider(null); editGame(undefined, r, provider) }}>建立草稿</Button> },
      ]} />
    </Modal>
  </Space>
}
