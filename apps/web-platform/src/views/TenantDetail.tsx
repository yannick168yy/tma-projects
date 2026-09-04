import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import {
  addTenantDomain, deleteTenantI18n, getTenantBrand, getTenantDetail, getTenantFeatures, impersonateTenant,
  listTenantI18n, probeDomains, removeTenantDomain, saveTenantBrand, searchI18nKeys,
  setTenantFeature, setTenantI18n, updateTenantPool, updateTenantStatus, uploadBrandAsset,
  type I18nCatalogEntry, type I18nOverrideRow,
  type TenantBrandResponse, type TenantDetail as Detail, type TenantFeatures,
} from '../api'

const THEME_HINT: Record<string, string> = {
  primary: '主色，如 #ffb800',
  primaryForeground: '主色上的文字色',
  accent: '强调色',
  accentForeground: '强调色上的文字色',
  radius: '圆角，如 0.75rem',
  fontSans: '正文字体，如 Nunito, sans-serif',
  fontDisplay: '标题字体',
}

const ASSET_SLOTS = [
  { slot: 'logoLight' as const, field: 'logoLightKey' as const, label: '亮色底 logo' },
  { slot: 'logoDark' as const, field: 'logoDarkKey' as const, label: '暗色底 logo' },
  { slot: 'favicon' as const, field: 'faviconKey' as const, label: 'Favicon' },
  { slot: 'appIcon' as const, field: 'appIconKey' as const, label: 'App 图标' },
]

const FEATURE_LABEL: Record<string, string> = {
  slots: '电子', live: '真人', sports: '体育', lottery: '彩票', fishing: '捕鱼',
  task: '任务', checkin: '签到', spin: '转盘', vip: 'VIP',
  rebate: '洗码返水', loss_rebate: '负盈利返水',
  team_commission: '团队佣金', agent_center: '代理中心',
  community: '社区营销', tg_broadcast: 'TG 群发', cs_ai: '客服 AI',
  kyc: 'KYC', login_telegram: 'TG 登录', login_google: 'Google 登录',
  app_download: 'APP 下载页',
}

const STATUS: Record<string, { text: string; color: string }> = {
  trial: { text: '试用', color: 'blue' },
  active: { text: '正常', color: 'green' },
  withdraw_suspended: { text: '停提现', color: 'orange' },
  deposit_suspended: { text: '停充值', color: 'orange' },
  suspended: { text: '停站', color: 'red' },
  closed: { text: '关站', color: 'default' },
}

const CERT: Record<string, { text: string; color: string }> = {
  none: { text: '未探测', color: 'default' },
  pending_dns: { text: '待解析', color: 'orange' },
  issued: { text: '已签发', color: 'green' },
  expiring: { text: '即将到期', color: 'gold' },
  failed: { text: '异常', color: 'red' },
}

// 与服务端的状态机保持一致；服务端仍会二次校验，前端只是少让人点错
const FLOW: Record<string, string[]> = {
  trial: ['active', 'suspended', 'closed'],
  active: ['trial', 'withdraw_suspended', 'deposit_suspended', 'suspended', 'closed'],
  withdraw_suspended: ['active', 'deposit_suspended', 'suspended', 'closed'],
  deposit_suspended: ['active', 'withdraw_suspended', 'suspended', 'closed'],
  suspended: ['active', 'closed'],
  closed: [],
}

export default function TenantDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [impersonating, setImpersonating] = useState(false)
  const [next, setNext] = useState<string>()
  const [pool, setPool] = useState({ min: 0, max: 1, queueLimit: 0 })
  const [savingPool, setSavingPool] = useState(false)
  const [probing, setProbing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm] = Form.useForm<{ type: 'platform_subdomain' | 'custom'; domain?: string; market: string; purpose: string }>()

  async function load() {
    setLoading(true)
    try {
      const detail = await getTenantDetail(Number(id))
      setD(detail)
      setPool(detail.pool)
    }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [id])

  async function changeStatus() {
    if (!next || !d) return
    try {
      await updateTenantStatus(d.id, next)
      message.success('状态已变更')
      setNext(undefined)
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '变更失败') }
  }

  async function savePool() {
    if (!d) return
    if (pool.min > pool.max) { message.error('初始连接数不能大于最大连接数'); return }
    setSavingPool(true)
    try {
      const res = await updateTenantPool(d.id, pool.min, pool.max, pool.queueLimit)
      message.success(res.poolRecreated ? '已保存，连接池已按新配置重建' : '已保存，下次建池时生效')
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSavingPool(false) }
  }

  async function runProbe() {
    if (!d) return
    setProbing(true)
    try {
      const res = await probeDomains(d.domains.map((x) => x.id))
      const bad = res.filter((r) => r.certStatus !== 'issued')
      message.success(bad.length === 0 ? `巡检完成，${res.length} 个域名全部正常` : `巡检完成，${bad.length}/${res.length} 个域名需要处理`)
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '巡检失败') }
    finally { setProbing(false) }
  }

  async function submitDomain() {
    if (!d) return
    const v = await addForm.validateFields()
    try {
      const res = await addTenantDomain(d.id, v)
      message.success(`已添加 ${res.domain}`)
      setAddOpen(false)
      addForm.resetFields()
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '添加失败') }
  }

  async function delDomain(domainId: number) {
    if (!d) return
    try {
      await removeTenantDomain(d.id, domainId)
      message.success('已删除')
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '删除失败') }
  }

  if (!d) return <Card loading={loading} title="租户详情" />

  const options = (FLOW[d.status] ?? []).map((s) => ({ value: s, label: STATUS[s]?.text ?? s }))

  async function doImpersonate() {
    setImpersonating(true)
    try {
      const { url } = await impersonateTenant(d!.id)
      // 新标签打开：平台控制台的会话要留着，否则跳过去就回不来了
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setImpersonating(false)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card
        title={`租户详情 · ${d.code}`}
        extra={<Space>
          <Popconfirm
            title="以该租户身份登录"
            description="将在新标签打开客户的业务后台。全程留痕，客户在自己的操作日志里能看到。"
            onConfirm={() => void doImpersonate()}
          >
            <Button loading={impersonating} disabled={d.status === 'closed'}>以租户身份登录</Button>
          </Popconfirm>
          <Button onClick={() => nav('/tenants')}>返回列表</Button>
        </Space>}
        loading={loading}
      >
        <Descriptions column={3} size="small" bordered>
          <Descriptions.Item label="名称">{d.name}</Descriptions.Item>
          <Descriptions.Item label="库">{d.database}</Descriptions.Item>
          <Descriptions.Item label="套餐">{d.planName ?? <Tag>未分配</Tag>}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS[d.status]?.color}>{STATUS[d.status]?.text ?? d.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="连接池">
            <Space>
              <InputNumber size="small" min={0} max={pool.max} value={pool.min} style={{ width: 72 }}
                onChange={(v) => setPool({ ...pool, min: Number(v ?? 0) })} />
              <span>/</span>
              <InputNumber size="small" min={1} max={100} value={pool.max} style={{ width: 72 }}
                onChange={(v) => setPool({ ...pool, max: Number(v ?? 1) })} />
              <span>/</span>
              <InputNumber size="small" min={0} max={10000} value={pool.queueLimit} style={{ width: 88 }}
                onChange={(v) => setPool({ ...pool, queueLimit: Number(v ?? 0) })} />
              <Button size="small" type="primary" loading={savingPool} onClick={savePool}
                disabled={pool.min === d.pool.min && pool.max === d.pool.max && pool.queueLimit === d.pool.queueLimit}>
                保存
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>初始 / 最大 / 排队上限</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{d.createdAt}</Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>{d.remark ?? '-'}</Descriptions.Item>
        </Descriptions>

        <div style={{ marginTop: 16 }}>
          {d.selfOperated ? (
            <Alert type="info" showIcon message="自营站不允许改状态：停掉它等于把整个平台自己关了" />
          ) : options.length === 0 ? (
            <Alert type="warning" showIcon message="已关站，无可用状态变更" />
          ) : (
            <Space>
              <Select placeholder="变更为" style={{ width: 160 }} value={next} onChange={setNext} options={options} />
              <Popconfirm
                title="确认变更状态？"
                description="停提现/停充值/停站会立即影响该租户的线上用户"
                onConfirm={changeStatus}
                disabled={!next}
              >
                <Button type="primary" danger disabled={!next}>执行变更</Button>
              </Popconfirm>
            </Space>
          )}
        </div>
      </Card>

      <BrandCard tenantId={d.id} />

      <I18nCard tenantId={d.id} />

      <FeatureCard tenantId={d.id} />

      <Card title="市场" size="small">
        <Table rowKey="market" size="small" pagination={false} dataSource={d.markets}
          columns={[
            { title: '市场', dataIndex: 'market' },
            { title: '币种', dataIndex: 'currency' },
            { title: '时区', dataIndex: 'timezone' },
            { title: '启用', dataIndex: 'enabled', render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          ]} />
      </Card>

      <Card
        title={`域名（${d.domains.length}）`}
        size="small"
        extra={
          <Space>
            <Button size="small" loading={probing} onClick={runProbe}>巡检 DNS/证书</Button>
            <Button size="small" type="primary" onClick={() => setAddOpen(true)}>添加域名</Button>
          </Space>
        }
      >
        <Table rowKey="id" size="small" pagination={false} dataSource={d.domains}
          columns={[
            { title: '域名', dataIndex: 'domain',
              render: (v: string, r) => (
                <Space size={4}>
                  <span>{v}</span>
                  {r.domainType === 'platform_subdomain' && <Tag color="cyan">平台子域名</Tag>}
                </Space>
              ) },
            { title: '市场', dataIndex: 'market', width: 70 },
            { title: '用途', dataIndex: 'purpose', width: 90 },
            { title: '证书', dataIndex: 'certStatus', width: 110,
              render: (v: string, r) => {
                const m = CERT[v] ?? { text: v, color: 'default' }
                const tag = <Tag color={m.color}>{m.text}</Tag>
                // 失败/待解析的原因是排查依据，必须能看到，不能只显示一个状态色块
                return r.certDetail ? <Tooltip title={r.certDetail}>{tag}</Tooltip> : tag
              } },
            { title: '到期', dataIndex: 'certExpiresAt', width: 110,
              render: (v: string | null) => v ? v.slice(0, 10) : '-' },
            { title: '解析到', dataIndex: 'dnsResolvedIp', width: 120, render: (v: string | null) => v ?? '-' },
            { title: '启用', dataIndex: 'enabled', width: 60, render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
            { title: '操作', width: 70,
              render: (_, r) => (
                <Popconfirm title="确认删除该域名？" description="删除后该域名立即无法访问" onConfirm={() => delDomain(r.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              ) },
          ]} />
      </Card>

      <Modal
        title="添加域名"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={submitDomain}
        okText="添加"
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" initialValues={{ type: 'platform_subdomain', purpose: 'site', market: d.markets[0]?.market }}>
          <Form.Item name="type" label="接入方式">
            <Select options={[
              { value: 'platform_subdomain', label: `平台子域名（自动生成，泛域名证书即刻可用）` },
              { value: 'custom', label: '客户自带域名（需客户先配 A 记录）' },
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.type !== b.type}>
            {({ getFieldValue }) => getFieldValue('type') === 'custom' ? (
              <Form.Item name="domain" label="域名" rules={[{ required: true, message: '请输入域名' }]}>
                <Input placeholder="abcgame.com" />
              </Form.Item>
            ) : (
              <Alert type="info" showIcon style={{ marginBottom: 16 }}
                message={`将按租户代号自动生成，形如 ${d.code}.<平台根域名>`}
                description="子域名由平台生成而非手工填写，避免抢注他人子域名或写出泛解析覆盖不到的地址。" />
            )}
          </Form.Item>
          <Form.Item name="market" label="归属市场" rules={[{ required: true }]}>
            <Select options={d.markets.map((m) => ({ value: m.market, label: `${m.market}（${m.currency}）` }))} />
          </Form.Item>
          <Form.Item name="purpose" label="用途" rules={[{ required: true }]}>
            <Select options={[
              { value: 'site', label: '前台站点' },
              { value: 'admin', label: '业务后台' },
              { value: 'app_route', label: 'App 线路' },
              { value: 'landing', label: '落地页' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Card title="聚合商子代理" size="small">
        <Table rowKey="provider" size="small" pagination={false} dataSource={d.providers}
          locale={{ emptyText: '未配置（P1-5 一键开站时自动创建）' }}
          columns={[
            { title: '聚合商', dataIndex: 'provider' },
            { title: '子代理账号', dataIndex: 'agentAccount' },
            { title: '状态', dataIndex: 'status' },
          ]} />
      </Card>

      <Card title="支付通道" size="small">
        <Table rowKey="channelCode" size="small" pagination={false} dataSource={d.channels}
          locale={{ emptyText: '未配置' }}
          columns={[
            { title: '通道', dataIndex: 'channelCode' },
            { title: '归属', dataIndex: 'owner', render: (v: string) => v === 'platform' ? <Tag color="gold">平台代收</Tag> : <Tag color="blue">租户自带</Tag> },
            { title: '商户号', dataIndex: 'merchantNo', render: (v: string | null) => v ?? '-' },
            { title: '启用', dataIndex: 'enabled', render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          ]} />
      </Card>
    </Space>
  )
}

/**
 * 功能开关矩阵。三态：跟随套餐 / 单独开 / 单独关。
 *
 * 必须能看出「这个关是套餐带的还是这家单独关的」—— 只显示生效值的话，
 * 没法判断清掉覆盖会回到什么，换套餐后更是一笔糊涂账。
 */
function FeatureCard({ tenantId }: { tenantId: number }) {
  const [data, setData] = useState<TenantFeatures | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    try { setData(await getTenantFeatures(tenantId)) } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [tenantId])

  async function change(key: string, value: 'inherit' | 'on' | 'off') {
    setSaving(key)
    try {
      await setTenantFeature(tenantId, key, value === 'inherit' ? null : value === 'on')
      await load()
      message.success('已保存，前台缓存已刷新')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  if (!data) return <Card title="功能开关" size="small" loading />

  return (
    <Card title="功能开关" size="small"
      extra={<Typography.Text type="secondary">租户覆盖优先于套餐默认值</Typography.Text>}>
      <Table rowKey="key" size="small" pagination={false}
        dataSource={data.keys.map((key) => ({ key }))}
        columns={[
          { title: '功能', dataIndex: 'key', render: (k: string) => FEATURE_LABEL[k] ?? k },
          { title: '标识', dataIndex: 'key', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
          {
            title: '套餐默认',
            dataIndex: 'key',
            render: (k: string) => data.planDefaults[k] === false ? <Tag>关</Tag> : <Tag color="green">开</Tag>,
          },
          {
            title: '本租户',
            dataIndex: 'key',
            render: (k: string) => (
              <Select<'inherit' | 'on' | 'off'> size="small" style={{ width: 120 }}
                loading={saving === k} disabled={saving !== null}
                value={data.overrides[k] === undefined ? 'inherit' : data.overrides[k] ? 'on' : 'off'}
                onChange={(v) => void change(k, v)}
                options={[
                  { value: 'inherit', label: '跟随套餐' },
                  { value: 'on', label: '单独开' },
                  { value: 'off', label: '单独关' },
                ]} />
            ),
          },
          {
            title: '生效',
            dataIndex: 'key',
            render: (k: string) => data.effective[k] === false
              ? <Tag color="red">关</Tag>
              : <Tag color="green">开</Tag>,
          },
        ]} />
    </Card>
  )
}

/**
 * 品牌包。文字先于图片：包网客户开站当天往往还没有 logo 图，
 * 填个站名与文字 logo 就能先把站挂上自己的名字。
 */
function BrandCard({ tenantId }: { tenantId: number }) {
  const [data, setData] = useState<TenantBrandResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    try {
      const res = await getTenantBrand(tenantId)
      setData(res)
      form.setFieldsValue({ ...res.brand, ...res.brand.theme })
    } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [tenantId])

  async function save() {
    if (!data) return
    setSaving(true)
    try {
      const v = form.getFieldsValue()
      const theme: Record<string, string> = {}
      for (const k of data.themeKeys) if (v[k]) theme[k] = String(v[k]).trim()
      await saveTenantBrand(tenantId, {
        siteName: v.siteName, shortName: v.shortName,
        logoTextPrimary: v.logoTextPrimary, logoTextAccent: v.logoTextAccent,
        tagline: v.tagline, theme,
      })
      await load()
      message.success('已保存，前台缓存已刷新')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function upload(slot: typeof ASSET_SLOTS[number]['slot'], field: typeof ASSET_SLOTS[number]['field'], file: File) {
    if (file.size > 2 * 1024 * 1024) { message.error('图片不能超过 2MB'); return }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
    try {
      const { key } = await uploadBrandAsset(tenantId, slot, dataUrl)
      // 上传与落库分两步：上传只产出 key，写进哪个位置由这次保存决定，
      // 传错了不改配置就不会影响线上
      await saveTenantBrand(tenantId, { [field]: key })
      await load()
      message.success('已上传并保存')
    } catch (e) { message.error((e as Error).message) }
  }

  async function clearAsset(field: typeof ASSET_SLOTS[number]['field']) {
    try {
      await saveTenantBrand(tenantId, { [field]: null })
      await load()
      message.success('已清除')
    } catch (e) { message.error((e as Error).message) }
  }

  if (!data) return <Card title="品牌包" size="small" loading />

  return (
    <Card title="品牌包" size="small"
      extra={<Space>
        <Typography.Text type="secondary">
          {data.brand.updatedAt ? `更新于 ${new Date(data.brand.updatedAt).toLocaleString()}` : '未配置，前台用默认品牌'}
        </Typography.Text>
        <Button type="primary" size="small" loading={saving} onClick={() => void save()}>保存</Button>
      </Space>}>
      <Form form={form} layout="vertical" size="small">
        <Space wrap size="large" align="start">
          <Form.Item name="siteName" label="站名" tooltip="用于标题栏、版权行，并作为所有文案里的 {{brandName}}">
            <Input style={{ width: 180 }} maxLength={64} />
          </Form.Item>
          <Form.Item name="shortName" label="短名" tooltip="角标与安装引导">
            <Input style={{ width: 90 }} maxLength={32} />
          </Form.Item>
          <Form.Item name="logoTextPrimary" label="文字 logo 前段">
            <Input style={{ width: 120 }} maxLength={16} />
          </Form.Item>
          <Form.Item name="logoTextAccent" label="后段（主色）">
            <Input style={{ width: 120 }} maxLength={16} />
          </Form.Item>
          <Form.Item name="tagline" label="标语">
            <Input style={{ width: 180 }} maxLength={64} />
          </Form.Item>
        </Space>

        <Typography.Text strong>主题变量</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Space wrap size="large" align="start">
            {data.themeKeys.map((k) => (
              <Form.Item key={k} name={k} label={k} tooltip={THEME_HINT[k]}>
                <Input style={{ width: 170 }} placeholder="留空=用默认值" allowClear />
              </Form.Item>
            ))}
          </Space>
        </div>
      </Form>

      <Typography.Text strong>图片资产</Typography.Text>
      <div style={{ marginTop: 8 }}>
        <Space wrap size="large" align="start">
          {ASSET_SLOTS.map(({ slot, field, label }) => {
            const key = data.brand[field]
            return (
              <Space key={slot} direction="vertical" size={4}>
                <Typography.Text type="secondary">{label}</Typography.Text>
                {key
                  ? <img src={`${data.assetPreviewBase}${key}`} alt={label}
                      style={{ height: 40, maxWidth: 140, objectFit: 'contain', background: '#f5f5f5', padding: 4 }} />
                  : <Tag>未配置</Tag>}
                <Space size={4}>
                  <Button size="small" onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/png,image/jpeg,image/webp'
                    input.onchange = () => { const f = input.files?.[0]; if (f) void upload(slot, field, f) }
                    input.click()
                  }}>上传</Button>
                  {key && <Button size="small" danger onClick={() => void clearAsset(field)}>清除</Button>}
                </Space>
              </Space>
            )
          })}
        </Space>
      </div>
    </Card>
  )
}

/**
 * 文案覆盖编辑器。
 *
 * 左边按 key 或默认文案搜平台词表（1300+ 条），点一条就带着默认值进编辑框；
 * 右边是这个租户已覆盖的条目。不给「浏览全部 key」的入口 —— 1300 条翻不动，
 * 搜索才是实际用法。
 */
function I18nCard({ tenantId }: { tenantId: number }) {
  const [data, setData] = useState<{ locales: string[]; rows: I18nOverrideRow[]; total: number; max: number } | null>(null)
  const [locale, setLocale] = useState('en')
  const [filter, setFilter] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalog, setCatalog] = useState<I18nCatalogEntry[]>([])
  const [catalogErr, setCatalogErr] = useState('')
  const [editing, setEditing] = useState<{ keyPath: string; value: string; hint: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    try { setData(await listTenantI18n(tenantId, locale, filter || undefined)) }
    catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [tenantId, locale, filter])

  async function search(q: string) {
    setCatalogQuery(q)
    if (!q.trim()) { setCatalog([]); setCatalogErr(''); return }
    try {
      setCatalogErr('')
      setCatalog((await searchI18nKeys(q)).entries)
    } catch (e) {
      // 目录没生成时给出可执行的提示，而不是让搜索框静默无结果
      setCatalogErr((e as Error).message)
      setCatalog([])
    }
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await setTenantI18n(tenantId, locale, editing.keyPath, editing.value)
      setEditing(null)
      await load()
      message.success('已保存，前台缓存已刷新')
    } catch (e) { message.error((e as Error).message) } finally { setSaving(false) }
  }

  async function remove(row: I18nOverrideRow) {
    try {
      await deleteTenantI18n(tenantId, row.locale, row.keyPath)
      await load()
      message.success('已删除，该条回落平台默认文案')
    } catch (e) { message.error((e as Error).message) }
  }

  if (!data) return <Card title="文案覆盖" size="small" loading />

  return (
    <Card title="文案覆盖" size="small"
      extra={<Typography.Text type={data.total >= data.max ? 'danger' : 'secondary'}>
        已覆盖 {data.total} / {data.max} 条
      </Typography.Text>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select<string> size="small" style={{ width: 110 }} value={locale} onChange={setLocale}
          options={data.locales.map((l) => ({ value: l, label: l }))} />
        <Input.Search size="small" style={{ width: 260 }} allowClear
          placeholder="搜平台词表（key 或文案）"
          value={catalogQuery} onChange={(e) => void search(e.target.value)} />
        <Input.Search size="small" style={{ width: 220 }} allowClear
          placeholder="筛选已覆盖条目" onSearch={setFilter} />
      </Space>

      {catalogErr && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={catalogErr} />}

      {catalog.length > 0 && (
        <Table rowKey="key" size="small" style={{ marginBottom: 12 }}
          pagination={{ pageSize: 5, size: 'small' }}
          dataSource={catalog}
          columns={[
            { title: 'key', dataIndex: 'key', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
            { title: '平台默认文案', dataIndex: 'defaultValue', ellipsis: true },
            {
              title: '', width: 80,
              render: (_: unknown, r: I18nCatalogEntry) => (
                <Button size="small" type="link"
                  onClick={() => setEditing({ keyPath: r.key, value: r.defaultValue, hint: r.defaultValue })}>
                  覆盖
                </Button>
              ),
            },
          ]} />
      )}

      <Table rowKey={(r) => `${r.locale}:${r.keyPath}`} size="small" pagination={false}
        locale={{ emptyText: `${locale} 尚无覆盖，前台用平台默认文案` }}
        dataSource={data.rows}
        columns={[
          { title: 'key', dataIndex: 'keyPath', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
          { title: '租户文案', dataIndex: 'value', ellipsis: true },
          {
            title: '操作', width: 130,
            render: (_: unknown, r: I18nOverrideRow) => (
              <Space size={4}>
                <Button size="small" type="link"
                  onClick={() => setEditing({ keyPath: r.keyPath, value: r.value, hint: '' })}>改</Button>
                <Popconfirm title="删除后该条回落平台默认文案" onConfirm={() => void remove(r)}>
                  <Button size="small" type="link" danger>删</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />

      <Modal open={editing !== null} title={`覆盖文案 · ${locale}`} confirmLoading={saving}
        onCancel={() => setEditing(null)} onOk={() => void save()}>
        <Form layout="vertical" size="small">
          <Form.Item label="key">
            <Input value={editing?.keyPath ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, keyPath: e.target.value })} />
          </Form.Item>
          {editing?.hint && (
            <Form.Item label="平台默认文案">
              <Typography.Text type="secondary">{editing.hint}</Typography.Text>
            </Form.Item>
          )}
          <Form.Item label="租户文案" help="{{变量}} 要原样保留，删掉会让该处显示空白">
            <Input.TextArea rows={3} maxLength={2000} value={editing?.value ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, value: e.target.value })} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
