import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Descriptions, Button, Table, Tag, Space, Input, Select, message, Popconfirm, Switch,
} from 'antd'
import {
  getAgentDetail, getAgentUsers, getAgentCommissions,
  addAgentChannel, deleteAgentChannel, toggleAgentChannel,
  type AgentDetail as TAgentDetail, type AgentChannel, type AgentUser, type AgentCommission,
} from '../api'

const peso = (c: number) => `₱${(c / 100).toFixed(2)}`
const SOURCE_LABEL: Record<string, string> = { domain: '域名', bot: '机器人', manual: '手动' }
const STATUS_LABEL: Record<string, string> = { pending: '待打款', paid: '已打款', voided: '作废' }

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<TAgentDetail | null>(null)
  const [channels, setChannels] = useState<AgentChannel[]>([])
  const [users, setUsers] = useState<AgentUser[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPage, setUsersPage] = useState(1)
  const [commissions, setCommissions] = useState<AgentCommission[]>([])
  const [chType, setChType] = useState<'domain' | 'bot'>('domain')
  const [chValue, setChValue] = useState('')

  async function loadDetail() {
    if (!agentId) return
    const data = await getAgentDetail(agentId)
    setAgent(data.agent)
    setChannels(data.channels)
  }
  async function loadUsers() {
    if (!agentId) return
    const data = await getAgentUsers(agentId, { page: usersPage, pageSize: 20 })
    setUsers(data.items)
    setUsersTotal(data.total)
  }
  async function loadCommissions() {
    if (!agentId) return
    const data = await getAgentCommissions(agentId)
    setCommissions(data.items)
  }

  useEffect(() => { void loadDetail(); void loadCommissions() }, [agentId])
  useEffect(() => { void loadUsers() }, [agentId, usersPage])

  async function handleAddChannel() {
    if (!agentId || !chValue.trim()) { message.warning('请输入渠道值'); return }
    try {
      await addAgentChannel(agentId, { channelType: chType, channelValue: chValue.trim() })
      message.success('已添加渠道')
      setChValue('')
      await loadDetail()
    } catch (e) { message.error(e instanceof Error ? e.message : '添加失败') }
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={() => navigate(-1)}>返回</Button>
        <span style={{ fontWeight: 600, fontSize: 16 }}>代理详情</span>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="代理ID">{agent?.agent_id}</Descriptions.Item>
          <Descriptions.Item label="名称">{agent?.name || agent?.display_name}</Descriptions.Item>
          <Descriptions.Item label="GGR分成">{agent?.ggr_rate_pct}%</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={agent?.status === 'active' ? 'green' : 'default'}>{agent?.status === 'active' ? '启用' : '停用'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="名下用户">{agent?.user_count}</Descriptions.Item>
          <Descriptions.Item label="备注">{agent?.remark || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="导流渠道" size="small" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Select value={chType} onChange={setChType} style={{ width: 110 }}
            options={[{ value: 'domain', label: '域名' }, { value: 'bot', label: '机器人' }]} />
          <Input
            value={chValue}
            onChange={(e) => setChValue(e.target.value)}
            placeholder={chType === 'domain' ? '如 play.agent1.com' : 'bot 标识'}
            style={{ width: 280 }}
          />
          <Button type="primary" onClick={handleAddChannel}>添加</Button>
        </Space>
        <Table<AgentChannel>
          rowKey="id"
          size="small"
          dataSource={channels}
          pagination={false}
          columns={[
            { title: '类型', dataIndex: 'channel_type', render: (t) => SOURCE_LABEL[t] ?? t },
            { title: '渠道值', dataIndex: 'channel_value' },
            {
              title: '启用', dataIndex: 'enabled',
              render: (v, r) => (
                <Switch checked={!!v} size="small" onChange={async (c) => {
                  await toggleAgentChannel(r.id, c); await loadDetail()
                }} />
              ),
            },
            {
              title: '操作',
              render: (_, r) => (
                <Popconfirm title="确认删除该渠道？" onConfirm={async () => { await deleteAgentChannel(r.id); await loadDetail() }}>
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Card title="名下用户" size="small" style={{ marginBottom: 16 }}>
        <Table<AgentUser>
          rowKey="user_id"
          size="small"
          dataSource={users}
          pagination={{ current: usersPage, total: usersTotal, pageSize: 20, onChange: setUsersPage }}
          columns={[
            { title: '用户ID', dataIndex: 'user_id', render: (id) => <a onClick={() => navigate(`/users/${id}`)}>{id}</a> },
            { title: '昵称', dataIndex: 'display_name' },
            { title: '来源', dataIndex: 'source', render: (s) => SOURCE_LABEL[s] ?? s },
            { title: '归属时间', dataIndex: 'bound_at', render: (t) => new Date(t).toLocaleString() },
          ]}
        />
      </Card>

      <Card title="月度分成" size="small">
        <Table<AgentCommission>
          rowKey="period"
          size="small"
          dataSource={commissions}
          pagination={false}
          columns={[
            { title: '月份', dataIndex: 'period' },
            { title: '当月GGR', dataIndex: 'ggr_cents', render: peso },
            { title: '上期结转', dataIndex: 'carry_in_cents', render: peso },
            { title: '净GGR', dataIndex: 'net_ggr_cents', render: peso },
            { title: '结转下期', dataIndex: 'carry_out_cents', render: peso },
            { title: '分成%', dataIndex: 'rate_pct', render: (v) => `${v}%` },
            { title: '应分', dataIndex: 'commission_cents', render: peso },
            {
              title: '状态', dataIndex: 'status',
              render: (s) => <Tag color={s === 'paid' ? 'green' : s === 'voided' ? 'default' : 'orange'}>{STATUS_LABEL[s] ?? s}</Tag>,
            },
          ]}
        />
      </Card>
    </div>
  )
}
