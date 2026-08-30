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
    const normalized = rows.map((item) => ({ domain: cleanDomain(item.domain), market: item.market, enabled: item.enabled }))
    if (normalized.some((item) => !item.domain)) { message.error('请填写有效域名'); return }
    if (new Set(normalized.map((item) => item.domain)).size !== normalized.length) { message.error('域名不能重复'); return }
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
    <Card
      extra={editable && <Space>
        <Button icon={<PlusOutlined />} onClick={() => setRows((items) => [...items, { key: `new-${Date.now()}`, domain: '', market: 'ID', enabled: true }])}>新增域名</Button>
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
              ? <Select value={value} style={{ width: 150 }} onChange={(market) => updateRow(row.key, { market })} options={[{ value: 'PH', label: '菲律宾站（PH）' }, { value: 'ID', label: '印尼站（ID）' }, { value: 'PUBLIC', label: '公共入口' }]} />
              : <Tag color={value === 'ID' ? 'red' : value === 'PH' ? 'blue' : 'gold'}>{value === 'ID' ? '印尼站' : value === 'PH' ? '菲律宾站' : '公共入口'}</Tag>,
          },
          {
            title: '启用', dataIndex: 'enabled', width: 100,
            render: (value: boolean, row) => <Switch checked={value} disabled={!editable} onChange={(enabled) => updateRow(row.key, { enabled })} />,
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
