import { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { getSiteDomainMappings, updateSiteDomainMappings, type SiteDomainMapping } from '../api'
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
