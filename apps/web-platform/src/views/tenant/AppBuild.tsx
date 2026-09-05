import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm,
  Select, Space, Table, Tag, Typography, message,
} from 'antd'
import { deleteTenantApp, getTenantApps, saveTenantApp, type TenantAppBuild } from '../../api'
import { useTenant } from './context'

// ── App 出包参数（P1-15）────────────────────────────────────────────────────
// 只维护参数，不在这里点按钮出包：签名密钥不进平台库（丢了就再也更不了已发布的 App），
// 服务器上也没有 Android SDK。出包在出包机上跑 scripts/build-tenant-apk.sh。
export default function AppBuild() {
  const { d } = useTenant()
  const tenantId = d.id
  const [data, setData] = useState<{
    items: TenantAppBuild[]; markets: string[]; domainCandidates: string[]; buildCommand: string
  } | null>(null)
  const [editing, setEditing] = useState<TenantAppBuild | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    try { setData(await getTenantApps(tenantId)) } catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [tenantId])

  const blank = (market: string): TenantAppBuild => ({
    appMarket: market,
    packageName: '',
    appLabel: '',
    routeDomains: [],
    tgRecoveryChannel: '',
    splashBackground: '#080b14',
    keystoreRef: '',
    versionCode: 1,
    versionName: '1.0.0',
    updatedAt: null,
  })

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const r = await saveTenantApp(tenantId, editing)
      setData((s) => s && { ...s, items: r.items })
      setEditing(null)
      message.success('已保存。改动要重新出包才会进到用户手机上')
    } catch (e) { message.error((e as Error).message) } finally { setSaving(false) }
  }

  const remove = async (market: string) => {
    try {
      const r = await deleteTenantApp(tenantId, market)
      setData((s) => s && { ...s, items: r.items })
    } catch (e) { message.error((e as Error).message) }
  }

  if (!data) return <Card title="App 出包" size="small" loading />

  const unused = data.markets.filter((m) => !data.items.some((i) => i.appMarket === m))

  return (
    <Card title="App 出包" size="small"
      extra={
        <Space>
          {unused.map((m) => (
            <Button key={m} size="small" onClick={() => setEditing(blank(m))}>+ {m} 包</Button>
          ))}
        </Space>
      }>
      <Alert style={{ marginBottom: 12 }} type="info" showIcon
        message="这里只存出包参数，出包在出包机上执行"
        description={
          <div>
            <div>签名密钥与密码不进平台库 —— 只填一个引用名，密钥文件放在出包机的
              <Typography.Text code>android/keystore-&lt;引用名&gt;.properties</Typography.Text>。
              密钥丢了就再也无法更新已发布的 App。</div>
            <div style={{ marginTop: 6 }}>出包命令：<Typography.Text code copyable>{data.buildCommand}</Typography.Text></div>
          </div>
        } />

      <Table<TenantAppBuild> rowKey="appMarket" size="small" pagination={false} dataSource={data.items}
        locale={{ emptyText: '尚未配置 App 出包参数' }}
        columns={[
          { title: '市场', dataIndex: 'appMarket', width: 70 },
          { title: '包名', dataIndex: 'packageName' },
          { title: '桌面名', dataIndex: 'appLabel', width: 110 },
          {
            title: '线路组', dataIndex: 'routeDomains',
            render: (v: string[]) => <span style={{ fontSize: 12 }}>{v.join('、') || '—'}</span>,
          },
          { title: '版本', width: 110, render: (_: unknown, r: TenantAppBuild) => `${r.versionName} (${r.versionCode})` },
          {
            title: '签名', dataIndex: 'keystoreRef', width: 110,
            render: (v: string) => v ? <Tag color="green">{v}</Tag> : <Tag color="red">未配置</Tag>,
          },
          {
            title: '操作', width: 110,
            render: (_: unknown, r: TenantAppBuild) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => setEditing({ ...r })}>改</Button>
                <Popconfirm title="删除后该市场的出包参数就没了（已发出去的包不受影响）"
                  onConfirm={() => void remove(r.appMarket)}>
                  <Button size="small" type="link" danger>删</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />

      <Modal open={editing !== null} title={`App 出包参数 · ${editing?.appMarket ?? ''}`} confirmLoading={saving}
        onCancel={() => setEditing(null)} onOk={() => void save()} width={620}>
        <Form layout="vertical" size="small">
          <Form.Item label="包名（applicationId）" help="发布后不可更改。形如 games.example.app">
            <Input value={editing?.packageName ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, packageName: e.target.value })} />
          </Form.Item>
          <Form.Item label="桌面显示名">
            <Input maxLength={32} value={editing?.appLabel ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, appLabel: e.target.value })} />
          </Form.Item>
          <Form.Item label="线路组（打进 APK 的兜底域名，按优先级从高到低）"
            help="只能选已登记且启用的站点域名。写错的域名要重新发包才能救，所以这里不让手输">
            <Select mode="multiple" style={{ width: '100%' }}
              value={editing?.routeDomains ?? []}
              onChange={(v) => setEditing((s) => s && { ...s, routeDomains: v })}
              options={data.domainCandidates.map((d) => ({ value: d, label: d }))} />
          </Form.Item>
          <Form.Item label="TG 旁路频道" help="线路全被封时 App 去这个公开频道找新线路。留空=不启用">
            <Input placeholder="@example_channel" value={editing?.tgRecoveryChannel ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, tgRecoveryChannel: e.target.value })} />
          </Form.Item>
          <Form.Item label="启动屏底色" help="品牌启动图仍在 web 层，换图免发包；这里只是原生那一瞬的底色">
            <Input placeholder="#080b14" value={editing?.splashBackground ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, splashBackground: e.target.value })} />
          </Form.Item>
          <Form.Item label="签名引用名" help="出包机上 android/keystore-<引用名>.properties；这里不存密钥也不存密码">
            <Input placeholder="acme" value={editing?.keystoreRef ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, keystoreRef: e.target.value })} />
          </Form.Item>
          <Space>
            <Form.Item label="versionName">
              <Input style={{ width: 120 }} value={editing?.versionName ?? ''}
                onChange={(e) => setEditing((s) => s && { ...s, versionName: e.target.value })} />
            </Form.Item>
            <Form.Item label="versionCode" help="每次发包必须比上一次大，否则装不上">
              <InputNumber min={1} value={editing?.versionCode ?? 1}
                onChange={(v) => setEditing((s) => s && { ...s, versionCode: Number(v ?? 1) })} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  )
}
