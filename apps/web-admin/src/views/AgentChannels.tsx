import { useEffect, useState } from 'react'
import { Card, Table, Input, Button, Tag, Space, Switch, Popconfirm, Select, message } from 'antd'
import {
  getAgentDomains, createAgentDomain, updateAgentDomain, deleteAgentDomain,
  getAgentBots, createAgentBot, updateAgentBot, deleteAgentBot,
  getAgentList,
  type AgentDomain, type AgentBot, type AgentListItem,
} from '../api'

export default function AgentChannels() {
  const [agents, setAgents] = useState<AgentListItem[]>([])

  async function loadAgents() {
    setAgents((await getAgentList({ pageSize: 100 })).items)
  }
  useEffect(() => { void loadAgents() }, [])

  const agentOptions = agents.map((a) => ({ value: a.agent_id, label: `${a.name || a.display_name}（${a.agent_id}）` }))

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <DomainsCard agentOptions={agentOptions} />
      <BotsCard agentOptions={agentOptions} />
    </Space>
  )
}

type AgentOption = { value: string; label: string }

function AssignSelect({ options, onAssign }: { options: AgentOption[]; onAssign: (agentId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState<string | undefined>()
  if (!open) return <a onClick={() => setOpen(true)}>分配代理</a>
  return (
    <Space.Compact>
      <Select
        size="small" showSearch placeholder="选择代理" style={{ width: 200 }}
        value={val} onChange={setVal} options={options}
        optionFilterProp="label"
      />
      <Button size="small" type="primary" onClick={() => { if (val) { onAssign(val); setOpen(false); setVal(undefined) } }}>确定</Button>
    </Space.Compact>
  )
}

function DomainsCard({ agentOptions }: { agentOptions: AgentOption[] }) {
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
                  <AssignSelect options={agentOptions} onAssign={(aid) => assign(r.id, aid)} />
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

function BotsCard({ agentOptions }: { agentOptions: AgentOption[] }) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AgentBot[]>([])
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    try { setItems((await getAgentBots()).items) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function handleAdd() {
    if (!token.trim()) { message.warning('请输入 bot token'); return }
    setAdding(true)
    try {
      const r = await createAgentBot({ botToken: token.trim(), label: label.trim() })
      message.success(`已添加 @${r.botUsername}`)
      setToken(''); setLabel('')
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '添加失败') }
    finally { setAdding(false) }
  }

  async function assign(id: number, agentId: string | null) {
    try { await updateAgentBot(id, { agentId }); message.success(agentId ? '已分配' : '已解绑'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  return (
    <Card title="机器人管理">
      <Space style={{ marginBottom: 8 }} wrap>
        <Input.Password value={token} onChange={(e) => setToken(e.target.value)} placeholder="bot token（123456:ABC...）" style={{ width: 320 }} />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="备注名（可选）" style={{ width: 160 }} />
        <Button type="primary" loading={adding} onClick={handleAdd}>添加机器人</Button>
      </Space>
      <p style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>添加时会调用 Telegram getMe 校验 token 并自动获取 bot 用户名/ID；token 仅用于识别用户入口，不会回显。</p>
      <Table<AgentBot>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          { title: '机器人', dataIndex: 'bot_username', render: (v) => `@${v}` },
          { title: 'Bot ID', dataIndex: 'bot_id', render: (v) => v ?? '-' },
          { title: '备注', dataIndex: 'label', render: (v) => v || '-' },
          {
            title: '归属代理', render: (_, r) => r.agent_id
              ? <Tag color="blue">{r.agent_name || r.agent_id}（{r.agent_id}）</Tag>
              : <Tag>未分配</Tag>,
          },
          {
            title: '启用', dataIndex: 'enabled',
            render: (v, r) => <Switch checked={!!v} size="small" onChange={async (c) => { await updateAgentBot(r.id, { enabled: c }); await load() }} />,
          },
          {
            title: '操作',
            render: (_, r) => (
              <Space>
                {r.agent_id ? (
                  <Popconfirm title="确认解绑该机器人？" onConfirm={() => assign(r.id, null)}>
                    <a>解绑</a>
                  </Popconfirm>
                ) : (
                  <AssignSelect options={agentOptions} onAssign={(aid) => assign(r.id, aid)} />
                )}
                <Popconfirm title="确认删除该机器人？" onConfirm={async () => { await deleteAgentBot(r.id); message.success('已删除'); await load() }}>
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
