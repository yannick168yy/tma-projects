import { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { getRouteHealth, getRouteTgChannel, getSiteDomainMappings, publishRoutesToTg, updateRouteTgChannel, updateSiteDomainMappings, type RouteHealthRow, type SiteDomainMapping } from '../api'
import { useAuthStore } from '../stores/auth'

type Row = SiteDomainMapping & { key: string }

function cleanDomain(value: string): string {
  const raw = value.trim().toLowerCase()
  if (!raw) return ''
  try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '') } catch { return '' }
}

export default function SiteDomains() {
  const { role } = useAuthStore()
  const editable = role === 'super_admin'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [health, setHealth] = useState<Record<string, RouteHealthRow>>({})
  const [tgChannel, setTgChannel] = useState('')
  const [tgBusy, setTgBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await getSiteDomainMappings()
      setRows(data.map((item, index) => ({ ...item, key: `${item.domain}-${index}` })))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    void (async () => {
      try { setTgChannel((await getRouteTgChannel()).channel) } catch { /* 非关键 */ }
    })()
  }, [])

  async function saveTgChannel() {
    setTgBusy(true)
    try {
      setTgChannel((await updateRouteTgChannel(tgChannel)).channel)
      message.success('频道已保存')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally { setTgBusy(false) }
  }

  async function publishTg() {
    setTgBusy(true)
    try {
      const r = await publishRoutesToTg()
      message.success(`已发布到 ${r.channel}（消息 #${r.messageId}）`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发布失败')
    } finally { setTgBusy(false) }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [ph, id] = await Promise.all([getRouteHealth('PH'), getRouteHealth('ID')])
        setHealth(Object.fromEntries([...ph, ...id].map((item) => [item.domain, item])))
      } catch { /* 健康度只是辅助信息，拉不到不影响配置 */ }
    })()
  }, [])

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((items) => items.map((item) => item.key === key ? { ...item, ...patch } : item))
  }

  async function save() {
    const normalized = rows.map((item) => ({
      domain: cleanDomain(item.domain), market: item.market, enabled: item.enabled,
      appMarket: item.appMarket, appPriority: Math.max(1, Math.min(999, Number(item.appPriority) || 100)),
    }))
    if (normalized.some((item) => !item.domain)) { message.error('请填写有效域名'); return }
    if (new Set(normalized.map((item) => item.domain)).size !== normalized.length) { message.error('域名不能重复'); return }
    const mismatched = normalized.filter((item) => item.appMarket && item.appMarket !== item.market)
    if (mismatched.length > 0) {
      message.error(`App 域名组必须与所属站点一致：${mismatched.map((item) => item.domain).join('、')}`); return
    }
    for (const market of ['PH', 'ID'] as const) {
      if (!normalized.some((item) => item.enabled && item.appMarket === market && item.market === market)) {
        message.error(`${market === 'PH' ? '菲律宾' : '印尼'} App 至少要保留一个启用的线路域名，否则该市场 App 将无法启动`); return
      }
    }
    setSaving(true)
    try {
      const saved = await updateSiteDomainMappings(normalized)
      setRows(saved.map((item, index) => ({ ...item, key: `${item.domain}-${index}` })))
      message.success('域名映射已生效，新打开或刷新的客户端将使用新配置')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally { setSaving(false) }
  }

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>站点域名映射</Typography.Title>
      <Typography.Text type="secondary">统一决定访问域名属于菲律宾站、印尼站或公共入口，并控制新用户默认市场、语言和币种。</Typography.Text>
    </div>
    <Alert showIcon type="info" message="域名统一按裸域保存，www 子域会自动匹配。公共入口不强制市场，由客户端语言或请求参数决定。已登录用户不会因为修改映射而迁移市场。" />
    <Alert showIcon type="warning" message="App 域名组只能选与「所属站点」相同的市场，公共入口不能作为 App 线路；每个市场必须至少保留一个启用的线路域名，否则该市场的 App 会全部无法启动。" />
    <Alert
      showIcon
      type="success"
      message="域名被封时可临时注册新域名直接给 App 补线路，无需重新出包"
      description={<div style={{ lineHeight: 1.9 }}>
        线路表由服务端私钥签名下发，App 验签通过即接受任意域名。临时注册一个域名后，在这里加一行、设为对应市场的 App 域名组即可生效，用户下次冷启动（或当前线路加载失败触发换线）就会用上。
        <b>前提是至少还有一条旧线路能访问</b>，否则 App 拿不到新线路表。
        <br />
        新域名上的 <b>Google 登录会自动借道已注册域名</b>（菲律宾 www.betogo.games、印尼 betogo.app）完成，再跳回新域名，登录态经 App 原生会话保险箱传递，用户无感。
        这是 Android 限制：Google 回跳要靠 App Link 交回 App，而 App Link 的域名表编译在 APK 里改不了。
        <b>手机号和 Telegram 登录不受影响</b>，在新域名上直接可用。
        <br />
        新域名仍需自行完成：DNS 解析到服务器、配置 HTTPS 证书、部署 <code>/.well-known/assetlinks.json</code>。
      </div>}
    />
    <Card
      title="线路全被封时的自救频道"
      extra={editable && <Space>
        <Input value={tgChannel} placeholder="@频道名" style={{ width: 200 }} onChange={(e) => setTgChannel(e.target.value)} />
        <Button loading={tgBusy} onClick={() => void saveTgChannel()}>保存频道</Button>
        <Button type="primary" loading={tgBusy} disabled={!tgChannel} onClick={() => void publishTg()}>发布当前线路</Button>
      </Space>}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, lineHeight: 1.9 }}>
        上面的线路表要靠<b>至少一条线路能访问</b>才能下发给 App。一旦某个市场的域名<b>同时全部被封</b>，App 就再没有任何通道拿到新域名，
        用户只会看到「Network unavailable」，只能自己找新地址重装 —— 这批人基本就流失了。
        <br />
        这里配置一个 <b>Telegram 公开频道</b>作为最后一条命：点「发布当前线路」会把当前线路表<b>连同服务端私钥的签名</b>发到该频道。
        App 在所有已知线路都探活失败时，会去读 <code>https://t.me/s/频道名</code> 的网页版，取出最新一条载荷、<b>验签通过后</b>用里面的域名重新连接。
        <br />
        几个要点：① App 读的是<b>网页版</b>，不需要 bot token，APK 里不含任何密钥；
        ② 载荷带签名，所以频道被冒名、页面被篡改都伪造不出线路表；
        ③ bot 必须是该频道的<b>管理员</b>才能发消息；
        ④ <b>每次改完域名映射都要重新点一次发布</b>，频道里的旧消息不会自动更新；
        ⑤ 频道名编译在 APK 里，换频道需要重新出包，所以建好后不要轻易换。
      </Typography.Paragraph>
    </Card>
    <Card
      extra={editable && <Space>
        <Button icon={<PlusOutlined />} onClick={() => setRows((items) => [...items, { key: `new-${Date.now()}`, domain: '', market: 'ID', enabled: true, appMarket: null, appPriority: 100 }])}>新增域名</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>保存配置</Button>
      </Space>}
    >
      <Table<Row>
        rowKey="key"
        loading={loading}
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: '域名', dataIndex: 'domain',
            render: (value: string, row) => editable
              ? <Input value={value} placeholder="例如 betogo.xyz" onChange={(e) => updateRow(row.key, { domain: e.target.value })} />
              : value,
          },
          {
            title: '所属站点', dataIndex: 'market', width: 180,
            render: (value: 'PH' | 'ID' | 'PUBLIC', row) => editable
              ? <Select value={value} style={{ width: 150 }} onChange={(market) => updateRow(row.key, { market, appMarket: row.appMarket === market ? row.appMarket : null })} options={[{ value: 'PH', label: '菲律宾站（PH）' }, { value: 'ID', label: '印尼站（ID）' }, { value: 'PUBLIC', label: '公共入口' }]} />
              : <Tag color={value === 'ID' ? 'red' : value === 'PH' ? 'blue' : 'gold'}>{value === 'ID' ? '印尼站' : value === 'PH' ? '菲律宾站' : '公共入口'}</Tag>,
          },
          {
            title: '启用', dataIndex: 'enabled', width: 100,
            render: (value: boolean, row) => <Switch checked={value} disabled={!editable} onChange={(enabled) => updateRow(row.key, { enabled })} />,
          },
          {
            title: 'App 域名组', dataIndex: 'appMarket', width: 170,
            render: (value: 'PH' | 'ID' | null, row) => editable
              ? <Select
                  value={value} allowClear style={{ width: 145 }}
                  disabled={row.market === 'PUBLIC'}
                  placeholder={row.market === 'PUBLIC' ? '公共入口不可作线路' : '不用于 App'}
                  onChange={(appMarket) => updateRow(row.key, { appMarket: appMarket ?? null })}
                  options={row.market === 'PUBLIC' ? [] : [{ value: row.market, label: row.market === 'ID' ? '印尼 App' : '菲律宾 App' }]}
                />
              : value
                ? <Tag color={value !== row.market ? 'error' : value === 'ID' ? 'red' : 'blue'}>{value === 'ID' ? '印尼 App' : '菲律宾 App'}{value !== row.market ? '（与站点不符，未生效）' : ''}</Tag>
                : '—',
          },
          {
            title: '近 24h 探活', key: 'health', width: 150,
            render: (_: unknown, row) => {
              const stat = health[row.domain]
              if (!stat || stat.ok + stat.fail === 0) return <span style={{ color: '#999' }}>无上报</span>
              return <div style={{ lineHeight: 1.5 }}>
                <Tag color={stat.successRate >= 90 ? 'success' : stat.successRate >= 50 ? 'warning' : 'error'}>
                  {stat.successRate}% 可达
                </Tag>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {stat.avgMs == null ? '—' : `${stat.avgMs}ms`} · 选中 {stat.selected} 次
                </div>
              </div>
            },
          },
          {
            title: 'App 优先级', dataIndex: 'appPriority', width: 120,
            render: (value: number, row) => editable
              ? <Input type="number" min={1} max={999} value={value} disabled={!row.appMarket} onChange={(e) => updateRow(row.key, { appPriority: Number(e.target.value) })} />
              : row.appMarket ? value : '—',
          },
          ...(editable ? [{
            title: '操作', key: 'action', width: 90,
            render: (_: unknown, row: Row) => <Popconfirm title="删除此域名映射？" onConfirm={() => setRows((items) => items.filter((item) => item.key !== row.key))}><Button danger type="text" icon={<DeleteOutlined />} /></Popconfirm>,
          }] : []),
        ]}
      />
    </Card>
  </Space>
}
