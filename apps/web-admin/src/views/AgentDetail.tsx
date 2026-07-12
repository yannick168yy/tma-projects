import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'
import {
  Card, Descriptions, Button, Table, Tag, Space, Select, message, Popconfirm,
} from 'antd'
import {
  getAgentDetail, getAgentUsers, getAgentCommissions,
  getAgentDomains, getAgentBots, assignDomainToAgent, assignBotToAgent,
  updateAgentDomain, updateAgentBot,
  type AgentDetail as TAgentDetail, type AgentDomain, type AgentBot, type AgentUser, type AgentCommission,
} from '../api'

const peso = (c: number) => `₱${(c / 100).toFixed(2)}`
const SOURCE_LABEL: Record<string, string> = { domain: '域名', bot: '机器人', manual: '手动' }
const STATUS_LABEL: Record<string, string> = { pending: '待打款', paid: '已打款', voided: '作废' }

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<TAgentDetail | null>(null)
  const [domains, setDomains] = useState<AgentDomain[]>([])
  const [bots, setBots] = useState<AgentBot[]>([])
  const [users, setUsers] = useState<AgentUser[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPage, setUsersPage] = useState(1)
  const [usersPageSize, setUsersPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [commissions, setCommissions] = useState<AgentCommission[]>([])
  const [freeDomains, setFreeDomains] = useState<AgentDomain[]>([])
  const [freeBots, setFreeBots] = useState<AgentBot[]>([])
  const [pickDomain, setPickDomain] = useState<number | undefined>()
  const [pickBot, setPickBot] = useState<number | undefined>()

  async function loadDetail() {
    if (!agentId) return
    const data = await getAgentDetail(agentId)
    setAgent(data.agent)
    setDomains(data.domains)
    setBots(data.bots)
  }
  async function loadFree() {
    setFreeDomains((await getAgentDomains(true)).items)
    setFreeBots((await getAgentBots(true)).items)
  }
  async function loadUsers() {
    if (!agentId) return
    const data = await getAgentUsers(agentId, { page: usersPage, pageSize: usersPageSize })
    setUsers(data.items)
    setUsersTotal(data.total)
  }
  async function loadCommissions() {
    if (!agentId) return
    setCommissions((await getAgentCommissions(agentId)).items)
  }

  useEffect(() => { void loadDetail(); void loadFree(); void loadCommissions() }, [agentId])
  useEffect(() => { void loadUsers() }, [agentId, usersPage, usersPageSize])

  async function handleAssignDomain() {
    if (!agentId || !pickDomain) return
    try { await assignDomainToAgent(agentId, pickDomain); message.success('已分配域名'); setPickDomain(undefined); await loadDetail(); await loadFree() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }
  async function handleAssignBot() {
    if (!agentId || !pickBot) return
    try { await assignBotToAgent(agentId, pickBot); message.success('已分配机器人'); setPickBot(undefined); await loadDetail(); await loadFree() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }
  async function unassignDomain(id: number) {
    try { await updateAgentDomain(id, { agentId: null }); message.success('已解绑'); await loadDetail(); await loadFree() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }
  async function unassignBot(id: number) {
    try { await updateAgentBot(id, { agentId: null }); message.success('已解绑'); await loadDetail(); await loadFree() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
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

      <Card title="导流域名" size="small" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Select
            style={{ width: 280 }} placeholder="选择未分配域名" allowClear
            value={pickDomain} onChange={setPickDomain}
            options={freeDomains.map((d) => ({ value: d.id, label: d.label ? `${d.domain}（${d.label}）` : d.domain }))}
          />
          <Button type="primary" disabled={!pickDomain} onClick={handleAssignDomain}>分配</Button>
        </Space>
        <Table<AgentDomain>
          rowKey="id" size="small" dataSource={domains} pagination={false}
          columns={[
            { title: '域名', dataIndex: 'domain' },
            { title: '备注', dataIndex: 'label', render: (v) => v || '-' },
            { title: '启用', dataIndex: 'enabled', render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
            { title: '操作', render: (_, r) => <Popconfirm title="确认解绑？" onConfirm={() => unassignDomain(r.id)}><a style={{ color: '#ff4d4f' }}>解绑</a></Popconfirm> },
          ]}
        />
      </Card>

      <Card title="导流机器人" size="small" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Select
            style={{ width: 280 }} placeholder="选择未分配机器人" allowClear
            value={pickBot} onChange={setPickBot}
            options={freeBots.map((b) => ({ value: b.id, label: b.label ? `@${b.bot_username}（${b.label}）` : `@${b.bot_username}` }))}
          />
          <Button type="primary" disabled={!pickBot} onClick={handleAssignBot}>分配</Button>
        </Space>
        <Table<AgentBot>
          rowKey="id" size="small" dataSource={bots} pagination={false}
          columns={[
            { title: '机器人', dataIndex: 'bot_username', render: (v) => `@${v}` },
            { title: 'Bot ID', dataIndex: 'bot_id', render: (v) => v ?? '-' },
            { title: '备注', dataIndex: 'label', render: (v) => v || '-' },
            { title: '启用', dataIndex: 'enabled', render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
            { title: '操作', render: (_, r) => <Popconfirm title="确认解绑？" onConfirm={() => unassignBot(r.id)}><a style={{ color: '#ff4d4f' }}>解绑</a></Popconfirm> },
          ]}
        />
      </Card>

      <Card title="名下用户" size="small" style={{ marginBottom: 16 }} extra={<span style={{ color: '#999', fontSize: 12 }}>GGR 为本月（投注-派彩-赠金）</span>}>
        <Table<AgentUser>
          rowKey="user_id" size="small" dataSource={users}
          pagination={{ current: usersPage, total: usersTotal, pageSize: usersPageSize, pageSizeOptions: PAGE_SIZE_OPTIONS, onChange: (p, ps) => { setUsersPage(p); setUsersPageSize(ps) } }}
          columns={[
            { title: '用户ID', dataIndex: 'user_id', render: (id) => <a onClick={() => navigate(`/users/${id}`)}>{id}</a> },
            { title: '昵称', dataIndex: 'display_name' },
            {
              title: '本月GGR', dataIndex: 'ggr_cents', align: 'right',
              render: (v: number) => <span style={{ color: v < 0 ? '#ff4d4f' : '#52c41a' }}>{peso(v)}</span>,
            },
            { title: '来源', dataIndex: 'source', render: (s) => SOURCE_LABEL[s] ?? s },
            { title: '归属时间', dataIndex: 'bound_at', render: (t) => new Date(t).toLocaleString() },
          ]}
        />
      </Card>

      <Card title="月度分成" size="small">
        <Table<AgentCommission>
          rowKey="period" size="small" dataSource={commissions} pagination={false}
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
