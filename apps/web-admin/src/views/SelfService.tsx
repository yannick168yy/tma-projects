import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space,
  Table, Tabs, Tag, Typography, message,
} from 'antd'
import {
  getSelfApps, getSelfChannels, requestAppBuild, saveSelfApp, saveSelfChannel,
  type SelfAppBuild, type SelfBuildRequest, type SelfChannel,
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

  async function load() {
    setLoading(true)
    try {
      const [ch, ap] = await Promise.all([getSelfChannels(), getSelfApps()])
      setChannels(ch.items)
      setKeyReady(ch.credentialKeyReady)
      setApps(ap.items)
      setRequests(ap.requests)
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
