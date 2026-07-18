import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, message,
} from 'antd'
import {
  cmApprovePost, cmDeleteChannel, cmDeleteRule, cmDeleteTemplate, cmListChannels, cmListPosts, cmListRules,
  cmListTemplates, cmMarkManualPost, cmPreviewTemplate, cmRejectPost, cmSaveChannel, cmSaveRule, cmSaveTemplate, cmSendNow,
  type CmButton, type CmCategory, type CmChannel, type CmPlatform, type CmPostLog, type CmRule, type CmTemplate,
} from '../api'

const PLATFORMS: Array<{ value: CmPlatform; label: string; color: string }> = [
  { value: 'telegram', label: 'Telegram', color: 'blue' },
  { value: 'viber', label: 'Viber', color: 'purple' },
  { value: 'facebook', label: 'Facebook', color: 'geekblue' },
]
const CATEGORIES: Array<{ value: CmCategory; label: string; color: string }> = [
  { value: 'promo', label: '活动推广', color: 'gold' },
  { value: 'winner', label: '中奖喜报', color: 'red' },
  { value: 'hotgame', label: '热游推荐', color: 'volcano' },
  { value: 'sports', label: '赛事预告', color: 'green' },
  { value: 'checkin', label: '签到提醒', color: 'cyan' },
  { value: 'festival', label: '节日时事', color: 'magenta' },
]
const STATUS_META: Record<CmPostLog['status'], { label: string; color: string }> = {
  pending: { label: 'FB待确认', color: 'orange' },
  sent: { label: '已发送', color: 'green' },
  failed: { label: '失败', color: 'red' },
  skipped: { label: '已跳过', color: 'default' },
}

const platformMeta = (v: string) => PLATFORMS.find((p) => p.value === v)
const categoryMeta = (v: string) => CATEGORIES.find((c) => c.value === v)

const VAR_HINT = '可用变量:{player} 脱敏玩家名、{amount} 中奖金额、{game} 热门游戏名、{game1}~{game3} 热游Top3、{date} 当日日期(PHT)'

// ── 渠道 tab ─────────────────────────────────────────────────────────────────

function ChannelsTab({ channels, reload }: { channels: CmChannel[]; reload: () => void }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<CmChannel | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const platform: CmPlatform = Form.useWatch('platform', form) ?? 'telegram'

  function openModal(record?: CmChannel) {
    setEditing(record ?? null)
    form.setFieldsValue(record
      ? { platform: record.platform, name: record.name, dailyLimit: record.dailyLimit, enabled: record.enabled, ...record.config }
      : { platform: 'telegram', name: '', dailyLimit: 10, enabled: true, chatId: '', botToken: '', authToken: '', from: '', pageId: '', pageToken: '' })
    setModalOpen(true)
  }

  async function save() {
    const v = await form.validateFields()
    const config: Record<string, string> = {}
    if (v.platform === 'telegram') {
      config.chatId = v.chatId
      if (v.botToken) config.botToken = v.botToken
    } else if (v.platform === 'viber') {
      config.authToken = v.authToken; config.from = v.from
    } else {
      config.pageId = v.pageId
      if (v.pageToken) config.pageToken = v.pageToken
    }
    setSaving(true)
    try {
      await cmSaveChannel({ id: editing?.id, platform: v.platform, name: v.name, config, dailyLimit: v.dailyLimit, enabled: v.enabled })
      message.success('渠道已保存'); setModalOpen(false); reload()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  async function testSend(record: CmChannel) {
    setTestingId(record.id)
    try {
      const { results } = await cmSendNow({
        channelIds: [record.id],
        content: `✅ BetoGo channel test — ${new Date().toLocaleString()}\nThis is a connectivity test post.`,
      })
      const r = results[0]
      if (r?.status === 'sent') message.success('测试发送成功')
      else if (r?.status === 'pending') message.info('FB 渠道:已生成待确认帖,请到"发帖记录"批准')
      else message.error(`发送失败:${r?.error ?? '未知错误'}`)
    } catch (e) { message.error(e instanceof Error ? e.message : '发送失败') }
    finally { setTestingId(null) }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => openModal()}>新增渠道</Button>
      </Space>
      <Table<CmChannel> rowKey="id" dataSource={channels} pagination={false} size="middle" scroll={{ x: 720 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '平台', dataIndex: 'platform', width: 110, render: (v: string) => <Tag color={platformMeta(v)?.color}>{platformMeta(v)?.label ?? v}</Tag> },
          { title: '名称', dataIndex: 'name' },
          { title: '配置', dataIndex: 'config', render: (c: Record<string, string>) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{Object.entries(c).map(([k, v]) => `${k}=${k.toLowerCase().includes('token') ? '***' : v}`).join('  ')}</Typography.Text> },
          { title: '日限', dataIndex: 'dailyLimit', width: 70 },
          { title: '启用', dataIndex: 'enabled', width: 70, render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
          {
            title: '操作', width: 220, render: (_, record) => (
              <Space>
                <Button size="small" loading={testingId === record.id} onClick={() => void testSend(record)}>测试发送</Button>
                <Button size="small" onClick={() => openModal(record)}>编辑</Button>
                <Popconfirm title="删除该渠道?" onConfirm={() => void cmDeleteChannel(record.id).then(reload)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title={editing ? '编辑渠道' : '新增渠道'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void save()} confirmLoading={saving} destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="platform" label="平台" rules={[{ required: true }]}>
            <Select options={PLATFORMS} disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="如:BetoGo TG 主频道" />
          </Form.Item>
          {platform === 'telegram' && (
            <>
              <Form.Item name="chatId" label="频道 Chat ID" rules={[{ required: true, message: '必填' }]} extra="@频道用户名 或 -100 开头的数字 ID;需先把 bot 加为频道管理员">
                <Input placeholder="@betogo_official 或 -1001234567890" />
              </Form.Item>
              <Form.Item name="botToken" label="Bot Token(可选)" extra="留空使用系统默认 bot">
                <Input.Password placeholder="留空使用默认 bot" />
              </Form.Item>
            </>
          )}
          {platform === 'viber' && (
            <>
              <Form.Item name="authToken" label="Auth Token" rules={[{ required: true, message: '必填' }]} extra="Viber Public Account 的 auth token">
                <Input.Password />
              </Form.Item>
              <Form.Item name="from" label="发送者 ID(from)" rules={[{ required: true, message: '必填' }]} extra="频道 superadmin 的 user id">
                <Input />
              </Form.Item>
            </>
          )}
          {platform === 'facebook' && (
            <>
              <Form.Item name="pageId" label="Page ID" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="pageToken" label="Page Access Token(可选)" extra="未申请到 Graph API 权限前可留空;届时待确认帖用「复制文案手动发布」">
                <Input.Password />
              </Form.Item>
            </>
          )}
          <Space size="large">
            <Form.Item name="dailyLimit" label="每日发帖上限" rules={[{ required: true }]}>
              <InputNumber min={1} max={100} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  )
}

// ── 模板 tab ─────────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [items, setItems] = useState<CmTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>()
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<CmTemplate | null>(null)
  const [preview, setPreview] = useState<{ rendered: string; content: string; aiApplied: boolean } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try { setItems((await cmListTemplates(categoryFilter)).items) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [categoryFilter])

  function openModal(record?: CmTemplate) {
    setEditing(record ?? null)
    setPreview(null)
    form.setFieldsValue(record
      ? { category: record.category, title: record.title, body: record.body, imageUrl: record.imageUrl ?? '', buttons: record.buttons ?? [], enabled: record.enabled, sort: record.sort }
      : { category: 'promo', title: '', body: '', imageUrl: '', buttons: [], enabled: true, sort: 0 })
    setModalOpen(true)
  }

  async function save() {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await cmSaveTemplate({
        id: editing?.id, category: v.category, title: v.title, body: v.body,
        imageUrl: v.imageUrl || null, buttons: (v.buttons as CmButton[])?.filter((b) => b?.text && b?.url) ?? [],
        enabled: v.enabled, sort: v.sort ?? 0,
      })
      message.success('模板已保存'); setModalOpen(false); void load()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  async function doPreview(ai: boolean) {
    const body = form.getFieldValue('body')
    if (!body) { message.warning('请先填写文案'); return }
    setPreviewing(true)
    try { setPreview(await cmPreviewTemplate(body, 'telegram', ai)) }
    catch (e) { message.error(e instanceof Error ? e.message : '预览失败') }
    finally { setPreviewing(false) }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="按栏目筛选" style={{ width: 160 }} options={CATEGORIES} value={categoryFilter} onChange={setCategoryFilter} />
        <Button type="primary" onClick={() => openModal()}>新增模板</Button>
      </Space>
      <Table<CmTemplate> rowKey="id" dataSource={items} loading={loading} pagination={false} size="middle" scroll={{ x: 760 }}
        columns={[
          { title: '栏目', dataIndex: 'category', width: 100, render: (v: string) => <Tag color={categoryMeta(v)?.color}>{categoryMeta(v)?.label ?? v}</Tag> },
          { title: '名称', dataIndex: 'title', width: 180 },
          { title: '文案', dataIndex: 'body', ellipsis: true, render: (v: string) => <Typography.Text style={{ fontSize: 12, whiteSpace: 'pre-wrap' }} ellipsis={{ tooltip: v }}>{v.slice(0, 120)}</Typography.Text> },
          { title: '按钮', dataIndex: 'buttons', width: 70, render: (v: CmButton[] | null) => v?.length ?? 0 },
          { title: '启用', dataIndex: 'enabled', width: 70, render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
          {
            title: '操作', width: 140, render: (_, record) => (
              <Space>
                <Button size="small" onClick={() => openModal(record)}>编辑</Button>
                <Popconfirm title="删除该模板?" onConfirm={() => void cmDeleteTemplate(record.id).then(() => void load())}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title={editing ? '编辑模板' : '新增模板'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void save()} confirmLoading={saving} width={680} destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item name="category" label="栏目" rules={[{ required: true }]} style={{ width: 160 }}>
              <Select options={CATEGORIES} />
            </Form.Item>
            <Form.Item name="title" label="模板名称(仅后台可见)" rules={[{ required: true, message: '必填' }]} style={{ width: 300 }}>
              <Input />
            </Form.Item>
            <Form.Item name="sort" label="排序">
              <InputNumber />
            </Form.Item>
          </Space>
          <Form.Item name="body" label="文案(英语+Taglish)" rules={[{ required: true, message: '必填' }]} extra={VAR_HINT}>
            <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="imageUrl" label="配图 URL(可选)">
            <Input placeholder="https://…(公网可访问的图片地址)" />
          </Form.Item>
          <Form.List name="buttons">
            {(fields, { add, remove }) => (
              <Form.Item label="按钮(TG 显示为内联按钮,Viber/FB 追加为文末链接)">
                {fields.map((field) => (
                  <Space key={field.key} style={{ display: 'flex', marginBottom: 4 }}>
                    <Form.Item name={[field.name, 'text']} noStyle rules={[{ required: true, message: '按钮文字必填' }]}>
                      <Input placeholder="按钮文字" style={{ width: 180 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'url']} noStyle rules={[{ required: true, message: '链接必填' }]}>
                      <Input placeholder="https://…" style={{ width: 320 }} />
                    </Form.Item>
                    <Button size="small" danger onClick={() => remove(field.name)}>删</Button>
                  </Space>
                ))}
                <Button size="small" onClick={() => add({ text: '', url: '' })}>+ 加按钮</Button>
              </Form.Item>
            )}
          </Form.List>
          <Space>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="效果预览">
              <Space>
                <Button size="small" loading={previewing} onClick={() => void doPreview(false)}>填充变量</Button>
                <Button size="small" loading={previewing} onClick={() => void doPreview(true)}>填充+AI 改写</Button>
              </Space>
            </Form.Item>
          </Space>
          {preview && (
            <Alert type="info" message={preview.aiApplied ? 'AI 改写后效果' : '变量填充效果(AI 未启用或未生效)'}
              description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{preview.content}</pre>} />
          )}
        </Form>
      </Modal>
    </>
  )
}

// ── 规则 tab ─────────────────────────────────────────────────────────────────

function RulesTab({ channels }: { channels: CmChannel[] }) {
  const [items, setItems] = useState<CmRule[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<CmRule | null>(null)
  const [form] = Form.useForm()

  const channelName = (id: number) => channels.find((c) => c.id === id)?.name ?? `#${id}`

  async function load() {
    setLoading(true)
    try { setItems((await cmListRules()).items) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function openModal(record?: CmRule) {
    setEditing(record ?? null)
    form.setFieldsValue(record
      ? { name: record.name, category: record.category, channelIds: record.channelIds, slots: record.slots, strategy: record.strategy, aiRewrite: record.aiRewrite, enabled: record.enabled }
      : { name: '', category: 'promo', channelIds: [], slots: [], strategy: 'sequential', aiRewrite: true, enabled: true })
    setModalOpen(true)
  }

  async function save() {
    const v = await form.validateFields()
    const bad = (v.slots as string[]).filter((s) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(s))
    if (bad.length) { message.error(`时刻格式须为 HH:mm:${bad.join(', ')}`); return }
    setSaving(true)
    try {
      await cmSaveRule({ id: editing?.id, ...v })
      message.success('规则已保存'); setModalOpen(false); void load()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => openModal()}>新增轮播规则</Button>
        <Typography.Text type="secondary">到点自动从栏目模板池轮换取一条 → 填充变量 → (可选)AI 改写 → 发到所选渠道;FB 渠道落待确认队列</Typography.Text>
      </Space>
      <Table<CmRule> rowKey="id" dataSource={items} loading={loading} pagination={false} size="middle" scroll={{ x: 820 }}
        columns={[
          { title: '名称', dataIndex: 'name', width: 160 },
          { title: '栏目', dataIndex: 'category', width: 100, render: (v: string) => <Tag color={categoryMeta(v)?.color}>{categoryMeta(v)?.label ?? v}</Tag> },
          { title: '渠道', dataIndex: 'channelIds', render: (ids: number[]) => ids.map((id) => <Tag key={id}>{channelName(id)}</Tag>) },
          { title: '每日时刻(PHT)', dataIndex: 'slots', render: (slots: string[]) => slots.map((s) => <Tag key={s} color="blue">{s}</Tag>) },
          { title: '轮换', dataIndex: 'strategy', width: 80, render: (v: string) => (v === 'random' ? '随机' : '顺序') },
          { title: 'AI改写', dataIndex: 'aiRewrite', width: 80, render: (v: boolean) => (v ? <Tag color="green">开</Tag> : <Tag>关</Tag>) },
          { title: '启用', dataIndex: 'enabled', width: 70, render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
          {
            title: '操作', width: 140, render: (_, record) => (
              <Space>
                <Button size="small" onClick={() => openModal(record)}>编辑</Button>
                <Popconfirm title="删除该规则?" onConfirm={() => void cmDeleteRule(record.id).then(() => void load())}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title={editing ? '编辑规则' : '新增规则'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void save()} confirmLoading={saving} destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="如:每日活动推广-TG+Viber" />
          </Form.Item>
          <Form.Item name="category" label="内容栏目" rules={[{ required: true }]}>
            <Select options={CATEGORIES} />
          </Form.Item>
          <Form.Item name="channelIds" label="目标渠道" rules={[{ required: true, message: '至少选一个' }]}>
            <Select mode="multiple" options={channels.map((c) => ({ value: c.id, label: `${platformMeta(c.platform)?.label} · ${c.name}` }))} />
          </Form.Item>
          <Form.Item name="slots" label="每日发送时刻(菲律宾时间,24h 制)" rules={[{ required: true, message: '至少一个' }]} extra="输入 HH:mm 后回车,可多个,如 10:00、19:30">
            <Select mode="tags" tokenSeparators={[',', ' ']} placeholder="10:00" open={false} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="strategy" label="轮换策略">
              <Select style={{ width: 120 }} options={[{ value: 'sequential', label: '顺序' }, { value: 'random', label: '随机' }]} />
            </Form.Item>
            <Form.Item name="aiRewrite" label="AI 变体改写" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  )
}

// ── 发帖记录 tab ─────────────────────────────────────────────────────────────

function PostsTab({ channels }: { channels: CmChannel[] }) {
  const [items, setItems] = useState<CmPostLog[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [actingId, setActingId] = useState<number | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [form] = Form.useForm()

  const channelLabel = (id: number) => {
    const c = channels.find((x) => x.id === id)
    return c ? `${platformMeta(c.platform)?.label} · ${c.name}` : `#${id}`
  }

  async function load() {
    setLoading(true)
    try { setItems((await cmListPosts({ status: statusFilter, limit: 200 })).items) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [statusFilter])

  async function act(id: number, fn: (id: number) => Promise<unknown>, okMsg: string) {
    setActingId(id)
    try { await fn(id); message.success(okMsg); void load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setActingId(null) }
  }

  async function manualSend() {
    const v = await form.validateFields()
    setSending(true)
    try {
      const { results } = await cmSendNow({ channelIds: v.channelIds, content: v.content, imageUrl: v.imageUrl || undefined, aiRewrite: v.aiRewrite === true })
      const failed = results.filter((r) => r.status === 'failed')
      if (failed.length) message.warning(`部分失败:${failed.map((f) => channelLabel(f.channelId)).join('、')}`)
      else message.success('已发送(FB 渠道进入待确认)')
      setSendOpen(false); void load()
    } catch (e) { message.error(e instanceof Error ? e.message : '发送失败') }
    finally { setSending(false) }
  }

  const pendingCount = useMemo(() => items.filter((i) => i.status === 'pending').length, [items])

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select allowClear placeholder="按状态筛选" style={{ width: 140 }} value={statusFilter} onChange={setStatusFilter}
          options={Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))} />
        <Button onClick={() => void load()}>刷新</Button>
        <Button type="primary" onClick={() => { form.resetFields(); setSendOpen(true) }}>手动发帖</Button>
        {pendingCount > 0 && <Tag color="orange">{pendingCount} 条 FB 帖待确认</Tag>}
      </Space>
      <Table<CmPostLog> rowKey="id" dataSource={items} loading={loading} size="middle" scroll={{ x: 900 }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 150, render: (v: string) => new Date(v).toLocaleString() },
          { title: '渠道', dataIndex: 'channelId', width: 170, render: (v: number) => channelLabel(v) },
          { title: '来源', dataIndex: 'ruleId', width: 90, render: (v: number | null) => (v ? `规则#${v}` : '手动') },
          {
            title: '内容', dataIndex: 'content', render: (v: string) => (
              <Typography.Paragraph style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 2, expandable: true, symbol: '展开' }} copyable={{ text: v }}>{v}</Typography.Paragraph>
            ),
          },
          {
            title: '状态', dataIndex: 'status', width: 100, render: (v: CmPostLog['status'], r) => (
              <>
                <Tag color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag>
                {r.error && r.error !== 'manual' && <Typography.Text type="danger" style={{ fontSize: 11, display: 'block' }} ellipsis={{ tooltip: r.error }}>{r.error.slice(0, 40)}</Typography.Text>}
              </>
            ),
          },
          {
            title: '操作', width: 200, render: (_, r) => r.status === 'pending' ? (
              <Space direction="vertical" size={2}>
                <Space size={4}>
                  <Button size="small" type="primary" loading={actingId === r.id} onClick={() => void act(r.id, cmApprovePost, '已通过 API 发布')}>批准发送</Button>
                  <Popconfirm title="确认已在 FB 手动发布?" onConfirm={() => void act(r.id, cmMarkManualPost, '已标记')}>
                    <Button size="small">已手动发布</Button>
                  </Popconfirm>
                </Space>
                <Button size="small" danger loading={actingId === r.id} onClick={() => void act(r.id, cmRejectPost, '已拒绝')}>拒绝</Button>
              </Space>
            ) : null,
          },
        ]} />
      <Modal title="手动发帖" open={sendOpen} onCancel={() => setSendOpen(false)} onOk={() => void manualSend()} confirmLoading={sending} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ aiRewrite: false }} style={{ marginTop: 8 }}>
          <Form.Item name="channelIds" label="目标渠道" rules={[{ required: true, message: '至少选一个' }]}>
            <Select mode="multiple" options={channels.filter((c) => c.enabled).map((c) => ({ value: c.id, label: `${platformMeta(c.platform)?.label} · ${c.name}` }))} />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '必填' }]} extra={VAR_HINT}>
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="imageUrl" label="配图 URL(可选)">
            <Input placeholder="https://…" />
          </Form.Item>
          <Form.Item name="aiRewrite" label="发送前 AI 改写" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ── 页面 ─────────────────────────────────────────────────────────────────────

export default function CommunityMarketing() {
  const [channels, setChannels] = useState<CmChannel[]>([])

  async function loadChannels() {
    try { setChannels((await cmListChannels()).items) } catch { /* 列表内各 tab 有自己的报错 */ }
  }
  useEffect(() => { void loadChannels() }, [])

  return (
    <Card title="社区营销" bodyStyle={{ paddingTop: 8 }}>
      <Tabs
        items={[
          { key: 'channels', label: '渠道管理', children: <ChannelsTab channels={channels} reload={() => void loadChannels()} /> },
          { key: 'templates', label: '内容模板', children: <TemplatesTab /> },
          { key: 'rules', label: '轮播规则', children: <RulesTab channels={channels} /> },
          { key: 'posts', label: '发帖记录', children: <PostsTab channels={channels} /> },
        ]}
      />
    </Card>
  )
}
