import { useEffect, useState } from 'react'
import { Card, Table, Input, Button, Tag, Space, Switch, Popconfirm, message } from 'antd'
import {
  getAgentDomains, createAgentDomain, updateAgentDomain, deleteAgentDomain, type AgentDomain,
} from '../api'

export default function AgentDomains() {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AgentDomain[]>([])
  const [domain, setDomain] = useState('')
  const [label, setLabel] = useState('')

  async function load() {
    setLoading(true)
    try { setItems((await getAgentDomains()).items) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function handleAdd() {
    if (!domain.trim()) { message.warning('请输入域名'); return }
    try {
      await createAgentDomain({ domain: domain.trim(), label: label.trim() })
      message.success('已添加域名')
      setDomain(''); setLabel('')
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '添加失败') }
  }

  async function assign(id: number, agentId: string | null) {
    try { await updateAgentDomain(id, { agentId }); message.success(agentId ? '已分配' : '已解绑'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  return (
    <Card title="域名管理">
      <Space style={{ marginBottom: 16 }} wrap>
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="域名，如 play.agent1.com" style={{ width: 240 }} />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="备注名（可选）" style={{ width: 180 }} />
        <Button type="primary" onClick={handleAdd}>添加域名</Button>
      </Space>
      <Table<AgentDomain>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          { title: '域名', dataIndex: 'domain' },
          { title: '备注', dataIndex: 'label', render: (v) => v || '-' },
          {
            title: '归属代理', render: (_, r) => r.agent_id
              ? <Tag color="blue">{r.agent_name || r.agent_id}（{r.agent_id}）</Tag>
              : <Tag>未分配</Tag>,
          },
          {
            title: '启用', dataIndex: 'enabled',
            render: (v, r) => <Switch checked={!!v} size="small" onChange={async (c) => { await updateAgentDomain(r.id, { enabled: c }); await load() }} />,
          },
          {
            title: '操作',
            render: (_, r) => (
              <Space>
                {r.agent_id ? (
                  <Popconfirm title="确认解绑该域名？" onConfirm={() => assign(r.id, null)}>
                    <a>解绑</a>
                  </Popconfirm>
                ) : (
                  <AssignInline onAssign={(aid) => assign(r.id, aid)} />
                )}
                <Popconfirm title="确认删除该域名？" onConfirm={async () => { await deleteAgentDomain(r.id); message.success('已删除'); await load() }}>
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  )
}

function AssignInline({ onAssign }: { onAssign: (agentId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState('')
  if (!open) return <a onClick={() => setOpen(true)}>分配代理</a>
  return (
    <Space.Compact>
      <Input size="small" value={val} onChange={(e) => setVal(e.target.value)} placeholder="代理用户ID" style={{ width: 140 }} />
      <Button size="small" type="primary" onClick={() => { if (val.trim()) { onAssign(val.trim()); setOpen(false); setVal('') } }}>确定</Button>
    </Space.Compact>
  )
}
