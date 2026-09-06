import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space,
  Table, Tabs, Tag, Typography, message,
} from 'antd'
import {
  createApiKey, getApiKeys, getSelfApps, getSelfChannels, requestAppBuild, revokeApiKey,
  saveSelfApp, saveSelfChannel,
  type ApiKeyRow, type SelfAppBuild, type SelfBuildRequest, type SelfChannel,
} from '../api'

const { Title, Text } = Typography

const BUILD_STATUS: Record<string, { text: string; color: string }> = {
  pending: { text: '待平台处理', color: 'orange' },
  building: { text: '出包中', color: 'blue' },
  done: { text: '已完成', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
}

/**
 * 自助配置（P3-5）。
 *
 * 能改的是「自己的钱和自己的包」：自带通道的商户号与密钥、App 出包参数。
 * 平台代收通道只读 —— 那用的是平台的商户号，改了等于把收款账号换到别处；
 * 费率也只读，那是商务合同定的。出包不能自己点：签名密钥只在平台的出包机上，
 * 放到服务器上就等于别人能给你已发布的 App 推更新。
 */
export default function SelfService() {
  const [channels, setChannels] = useState<SelfChannel[]>([])
  const [keyReady, setKeyReady] = useState(true)
  const [apps, setApps] = useState<SelfAppBuild[]>([])
  const [requests, setRequests] = useState<SelfBuildRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [chEdit, setChEdit] = useState<SelfChannel | null>(null)
  const [chForm] = Form.useForm<{ merchantNo: string; credential: string }>()
  const [appEdit, setAppEdit] = useState<SelfAppBuild | null>(null)
  const [appForm] = Form.useForm<SelfAppBuild & { routeDomainsText: string }>()
  const [buildTarget, setBuildTarget] = useState<SelfAppBuild | null>(null)
  const [buildNote, setBuildNote] = useState('')
  // 开放 API 密钥（P3-7）：完整 key 只在创建那一次返回，所以要显式弹出来让人抄走
  const [apiScopes, setApiScopes] = useState<Array<{ scope: string; label: string }>>([])
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([])
  const [keyOpen, setKeyOpen] = useState(false)
  const [keyForm] = Form.useForm<{ name: string; scopes: string[]; ratePerMin: number; ipAllowlist: string }>()
  const [newKey, setNewKey] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [ch, ap, ak] = await Promise.all([getSelfChannels(), getSelfApps(), getApiKeys()])
      setChannels(ch.items)
      setKeyReady(ch.credentialKeyReady)
      setApps(ap.items)
      setRequests(ap.requests)
      setApiScopes(ak.scopes)
      setApiKeys(ak.items)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function submitChannel() {
    if (!chEdit) return
    const v = await chForm.validateFields()
    try {
      const res = await saveSelfChannel(chEdit.channelCode, v)
      setChannels(res.items)
      setChEdit(null)
      chForm.resetFields()
      message.success('已保存。新凭据立即用于新建的充提单')
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
  }

  async function submitApp() {
    if (!appEdit) return
    const v = await appForm.validateFields()
    try {
      const res = await saveSelfApp(appEdit.appMarket, {
        appLabel: v.appLabel,
        routeDomains: v.routeDomainsText.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
        tgRecoveryChannel: v.tgRecoveryChannel ?? '',
        splashBackground: v.splashBackground,
        versionName: v.versionName,
        versionCode: v.versionCode,
      })
      setApps(res.items)
      setAppEdit(null)
      message.success('已保存。改动要重新出包才会到用户手机上')
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
  }

  async function submitBuild() {
    if (!buildTarget) return
    try {
      const res = await requestAppBuild(buildTarget.appMarket, buildNote)
      setRequests(res.requests)
      setBuildTarget(null)
      setBuildNote('')
      message.success('已提交，平台处理后会回填下载地址')
    } catch (e) { message.error(e instanceof Error ? e.message : '提交失败') }
  }

  async function submitKey() {
    const v = await keyForm.validateFields()
    try {
      const res = await createApiKey(v)
      setApiKeys(res.items)
      setKeyOpen(false)
      keyForm.resetFields()
      setNewKey(res.key)
    } catch (e) { message.error(e instanceof Error ? e.message : '创建失败') }
  }

  const apiKeyTab = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="开放 API 是只读的：拿自己的数据去做报表、对账、推到你自己的系统"
        description={<span>
          用法见 <Text code>/api/open/v1</Text>，请求头 <Text code>X-Api-Key</Text>。
          完整密钥只在创建那一刻显示一次，库里只存摘要 —— 丢了只能吊销重建。
          写接口（调余额、改配置）不通过密钥开放。
        </span>} />
      <div>
        <Button type="primary" size="small" onClick={() => setKeyOpen(true)}>创建密钥</Button>
      </div>
      <Table<ApiKeyRow> rowKey="id" size="small" pagination={false} dataSource={apiKeys} loading={loading}
        locale={{ emptyText: '还没有密钥' }}
        columns={[
          { title: '用途', dataIndex: 'name' },
          { title: '前缀', dataIndex: 'keyPrefix', width: 130, render: (v: string) => <Text code>{v}</Text> },
          { title: '权限', dataIndex: 'scopes',
            render: (v: string[]) => <Space size={4} wrap>{v.map((s) => <Tag key={s}>{s}</Tag>)}</Space> },
          { title: '限流', dataIndex: 'ratePerMin', width: 90, render: (v: number) => `${v}/分钟` },
          { title: 'IP 白名单', dataIndex: 'ipAllowlist', width: 160,
            render: (v: string[]) => v.length ? v.join('、') : <Text type="secondary">不限</Text> },
          { title: '最近使用', dataIndex: 'lastUsedAt', width: 170,
            render: (v: string | null, r) => v
              ? <span>{v.slice(0, 16).replace('T', ' ')}<br /><Text type="secondary" style={{ fontSize: 11 }}>{r.lastUsedIp}</Text></span>
              : <Text type="secondary">未使用</Text> },
          { title: '状态', dataIndex: 'enabled', width: 90,
            render: (v: boolean) => v ? <Tag color="green">启用</Tag> : <Tag>已吊销</Tag> },
          { title: '操作', width: 80,
            render: (_, r) => r.enabled && (
              <Popconfirm title="吊销这把密钥？" description="用它的脚本会立刻开始报 401"
                onConfirm={() => void revokeApiKey(r.id).then((res) => setApiKeys(res.items))}>
                <Button size="small" type="link" danger>吊销</Button>
              </Popconfirm>
            ) },
        ]} />
    </Space>
  )

  const channelTab = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="只有「自带通道」的商户号与密钥可以自己改"
        description="平台代收通道用的是平台的商户号，改它等于把收款账号换到别处，所以只读；通道的启用与费率由平台与商务合同决定。密钥加密存储，这里只显示掩码。" />
      {!keyReady && <Alert type="warning" showIcon message="平台未配置凭据主密钥，暂时无法保存密钥" />}
      <Table<SelfChannel> rowKey="channelCode" size="small" pagination={false} dataSource={channels} loading={loading}
        locale={{ emptyText: '平台还没给你分配支付通道' }}
        columns={[
          { title: '通道', dataIndex: 'channelCode', width: 130 },
          { title: '资金模式', dataIndex: 'owner', width: 130,
            render: (v: string) => v === 'platform'
              ? <Tag color="gold">平台代收代付</Tag>
              : <Tag color="blue">你的自带通道</Tag> },
          { title: '商户号', dataIndex: 'merchantNo', render: (v: string | null) => v ?? '—' },
          { title: '密钥', dataIndex: 'credentialMask',
            render: (v: string | null, r) => v
              ? <Text code>{v}</Text>
              : r.owner === 'tenant'
                ? <Tag color="red">未配置，充提会被拒</Tag>
                : <Text type="secondary">用平台凭据</Text> },
          { title: '手续费', width: 130,
            render: (_, r) => r.owner === 'platform' ? `${r.feeRatePct}% + ${r.feeFixed}/笔` : <Text type="secondary">—</Text> },
          { title: '启用', dataIndex: 'enabled', width: 80,
            render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          { title: '操作', width: 80,
            render: (_, r) => r.editable
              ? <Button size="small" type="link" onClick={() => {
                  setChEdit(r)
                  chForm.setFieldsValue({ merchantNo: r.merchantNo ?? '', credential: '' })
                }}>改</Button>
              : <Text type="secondary">只读</Text> },
        ]} />
    </Space>
  )

  const appTab = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="出包参数可以自己改，出包本身要平台在出包机上跑一次"
        description="签名密钥只在平台的出包机上（放到服务器上就等于别人能给你已发布的 App 推更新），所以这里是「调好参数 → 提交出包申请」。包名与签名引用名不可改：包名换了等于换一个 App，老用户收不到更新。" />
      <Table<SelfAppBuild> rowKey="appMarket" size="small" pagination={false} dataSource={apps} loading={loading}
        locale={{ emptyText: '还没有出包参数，请联系平台先建一次' }}
        columns={[
          { title: '市场', dataIndex: 'appMarket', width: 70 },
          { title: '包名', dataIndex: 'packageName' },
          { title: '桌面名', dataIndex: 'appLabel', width: 110 },
          { title: '线路组', dataIndex: 'routeDomains',
            render: (v: string[]) => <span style={{ fontSize: 12 }}>{v.join('、') || '—'}</span> },
          { title: '版本', width: 120, render: (_, r) => `${r.versionName} (${r.versionCode})` },
          { title: '签名', dataIndex: 'keystoreRef', width: 100,
            render: (v: string) => v ? <Tag color="green">已配置</Tag> : <Tag color="red">未配置</Tag> },
          { title: '操作', width: 150,
            render: (_, r) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => {
                  setAppEdit(r)
                  appForm.setFieldsValue({ ...r, routeDomainsText: r.routeDomains.join('\n') })
                }}>改参数</Button>
                <Popconfirm title="提交出包申请？" description="平台会用当前参数出包并回填下载地址"
                  onConfirm={() => setBuildTarget(r)}>
                  <Button size="small" type="link" disabled={!r.keystoreRef}>申请出包</Button>
                </Popconfirm>
              </Space>
            ) },
        ]} />

      <Card size="small" title="出包申请记录">
        <Table<SelfBuildRequest> rowKey="id" size="small" pagination={{ pageSize: 6, size: 'small' }}
          dataSource={requests}
          locale={{ emptyText: '还没提交过出包申请' }}
          columns={[
            { title: '提交时间', dataIndex: 'createdAt', width: 170,
              render: (v: string) => v.slice(0, 19).replace('T', ' ') },
            { title: '市场', dataIndex: 'appMarket', width: 70 },
            { title: '版本', width: 120, render: (_, r) => `${r.versionName} (${r.versionCode})` },
            { title: '状态', dataIndex: 'status', width: 120,
              render: (v: string) => <Tag color={BUILD_STATUS[v]?.color}>{BUILD_STATUS[v]?.text ?? v}</Tag> },
            { title: '说明 / 结果', render: (_, r) => r.status === 'done' && r.artifactUrl
              ? <a href={r.artifactUrl} target="_blank" rel="noreferrer">下载安装包</a>
              : r.status === 'rejected' ? <Text type="danger">{r.rejectReason}</Text>
              : <Text type="secondary">{r.note ?? '—'}</Text> },
          ]} />
      </Card>
    </Space>
  )

  return (
    <div style={{ maxWidth: 1100 }}>
      <Title level={4} style={{ marginBottom: 16 }}>自助配置</Title>
      <Tabs items={[
        { key: 'channels', label: '支付通道', children: channelTab },
        { key: 'app', label: 'App 出包', children: appTab },
        { key: 'api', label: '开放 API', children: apiKeyTab },
      ]} />

      <Modal title={`自带通道 · ${chEdit?.channelCode ?? ''}`} open={chEdit !== null}
        onCancel={() => setChEdit(null)} onOk={submitChannel} destroyOnClose>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="填错密钥会导致这条通道的充提全部失败"
          description="改完先用小额充值验一次。密钥留空表示不改动已存的那把。" />
        <Form form={chForm} layout="vertical" size="small">
          <Form.Item name="merchantNo" label="商户号" rules={[{ required: true, message: '自带通道必须填商户号' }]}
            help="平台按商户号反查回调属于哪家，填错会导致回调找不到你">
            <Input />
          </Form.Item>
          <Form.Item name="credential" label="通道密钥"
            help={chEdit?.credentialMask ? `当前 ${chEdit.credentialMask}，留空表示不改` : '形如 mchNo=xxx&apiKey=yyy'}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`出包参数 · ${appEdit?.appMarket ?? ''}`} open={appEdit !== null} width={600}
        onCancel={() => setAppEdit(null)} onOk={submitApp} destroyOnClose>
        <Form form={appForm} layout="vertical" size="small">
          <Form.Item name="appLabel" label="桌面显示名" rules={[{ required: true }]}>
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item name="routeDomainsText" label="线路组（每行一个域名，按优先级从高到低）"
            help="打进 APK 的兜底域名。只能填平台已给你登记并启用的站点域名，写错要重新发包才能救">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tgRecoveryChannel" label="TG 旁路频道" help="线路全被封时 App 去这个公开频道找新线路，留空=不启用">
            <Input placeholder="@example_channel" />
          </Form.Item>
          <Form.Item name="splashBackground" label="启动屏底色" help="品牌启动图在「品牌」里换，免发包；这里只是原生那一瞬的底色">
            <Input placeholder="#080b14" />
          </Form.Item>
          <Space>
            <Form.Item name="versionName" label="versionName" rules={[{ required: true }]}>
              <Input style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="versionCode" label="versionCode" rules={[{ required: true }]}
              help="每次发包必须比上次大，否则装不上">
              <InputNumber min={1} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title="创建开放 API 密钥" open={keyOpen} onCancel={() => setKeyOpen(false)}
        onOk={submitKey} destroyOnClose>
        <Form form={keyForm} layout="vertical" size="small" initialValues={{ ratePerMin: 120, scopes: [] }}>
          <Form.Item name="name" label="用途备注" rules={[{ required: true, message: '请填用途' }]}
            help="三个月后没人记得这把 key 是给谁的">
            <Input placeholder="BI 报表同步脚本" />
          </Form.Item>
          <Form.Item name="scopes" label="权限范围" rules={[{ required: true, message: '至少选一个' }]}>
            <Select mode="multiple" options={apiScopes.map((s) => ({ value: s.scope, label: `${s.label}（${s.scope}）` }))} />
          </Form.Item>
          <Form.Item name="ratePerMin" label="每分钟请求上限" help="10~600。超限返回 429">
            <InputNumber min={10} max={600} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="ipAllowlist" label="IP 白名单" help="逗号分隔，留空=不限（那就只靠密钥本身保护）">
            <Input placeholder="1.2.3.4, 5.6.7.8" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="密钥已创建 —— 现在抄走，之后看不到" open={newKey !== null}
        onCancel={() => setNewKey(null)} onOk={() => setNewKey(null)} okText="我已保存" cancelButtonProps={{ style: { display: 'none' } }}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="库里只存摘要，这是唯一一次能看到完整密钥的机会"
          description="丢了只能吊销重建。能随时查看意味着任何一个能进后台的人都能拿走全部密钥。" />
        <Input.TextArea value={newKey ?? ''} readOnly autoSize rows={2} />
      </Modal>

      <Modal title="提交出包申请" open={buildTarget !== null} onCancel={() => setBuildTarget(null)}
        onOk={submitBuild} destroyOnClose>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message={`将按当前参数出包：${buildTarget?.versionName} (${buildTarget?.versionCode})`}
          description="同一市场同时只能有一条待处理申请。" />
        <Input.TextArea rows={3} maxLength={200} placeholder="这次出包要解决什么（选填）"
          value={buildNote} onChange={(e) => setBuildNote(e.target.value)} />
      </Modal>
    </div>
  )
}
