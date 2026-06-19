import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Input, Button, Tag, Space, Modal, Form, InputNumber, Select, message } from 'antd'
import { getAgentList, createAgent, getAgentDomains, getAgentBots, type AgentListItem, type AgentDomain, type AgentBot } from '../api'

const peso = (c: number) => `₱${(c / 100).toFixed(2)}`

export default function Agents() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AgentListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [freeDomains, setFreeDomains] = useState<AgentDomain[]>([])
  const [freeBots, setFreeBots] = useState<AgentBot[]>([])
  const [form] = Form.useForm<{ userId: string; name?: string; ggrRatePct: number; remark?: string; domainIds?: number[]; botIds?: number[] }>()

  async function openCreate() {
    setShowCreate(true)
    try {
      setFreeDomains((await getAgentDomains(true)).items)
      setFreeBots((await getAgentBots(true)).items)
    } catch { /* ignore */ }
  }

  async function load() {
    setLoading(true)
    try {
      const data = await getAgentList({ search, page, pageSize: 20 })
      setItems(data.items)
      setTotal(data.total)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [page])

  async function handleCreate() {
    try {
      const v = await form.validateFields()
      await createAgent({ userId: v.userId.trim(), name: v.name, ggrRatePct: v.ggrRatePct, remark: v.remark, domainIds: v.domainIds, botIds: v.botIds })
      message.success('已设为代理')
      setShowCreate(false)
      form.resetFields()
      await load()
    } catch (e) {
      if (e instanceof Error) message.error(e.message)
    }
  }

  return (
    <Card
      title="代理管理"
      extra={<Button type="primary" onClick={() => void openCreate()}>设为代理</Button>}
    >
      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索 代理ID / 名称"
          allowClear
          style={{ width: 260 }}
          onSearch={(v) => { setSearch(v); setPage(1); void load() }}
        />
      </Space>
      <Table<AgentListItem>
        rowKey="agent_id"
        loading={loading}
        dataSource={items}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
        columns={[
          { title: '代理ID', dataIndex: 'agent_id' },
          { title: '名称', render: (_, r) => r.name || r.display_name },
          { title: 'GGR分成', dataIndex: 'ggr_rate_pct', render: (v) => `${v}%` },
          {
            title: '状态', dataIndex: 'status',
            render: (s) => <Tag color={s === 'active' ? 'green' : 'default'}>{s === 'active' ? '启用' : '停用'}</Tag>,
          },
          { title: '名下用户', dataIndex: 'user_count' },
          { title: '渠道数', dataIndex: 'channel_count' },
          { title: '本月分成', dataIndex: 'this_month_commission_cents', render: peso },
          {
            title: '操作',
            render: (_, r) => <a onClick={() => navigate(`/agents/${r.agent_id}`)}>详情</a>,
          },
        ]}
      />

      <Modal
        open={showCreate}
        title="设为代理"
        onCancel={() => { setShowCreate(false); form.resetFields() }}
        onOk={handleCreate}
        okText="确认"
      >
        <Form form={form} layout="vertical" initialValues={{ ggrRatePct: 0 }}>
          <Form.Item label="用户ID" name="userId" rules={[{ required: true, message: '请输入用户ID' }]}>
            <Input placeholder="如 BG-10001" />
          </Form.Item>
          <Form.Item label="代理名称" name="name">
            <Input placeholder="留空则用用户昵称" />
          </Form.Item>
          <Form.Item label="GGR分成比例(%)" name="ggrRatePct" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="分配域名（未分配）" name="domainIds">
            <Select
              mode="multiple" allowClear placeholder="可选，从已配置的未分配域名中选"
              options={freeDomains.map((d) => ({ value: d.id, label: d.label ? `${d.domain}（${d.label}）` : d.domain }))}
            />
          </Form.Item>
          <Form.Item label="分配机器人（未分配）" name="botIds">
            <Select
              mode="multiple" allowClear placeholder="可选，从已配置的未分配机器人中选"
              options={freeBots.map((b) => ({ value: b.id, label: b.label ? `@${b.bot_username}（${b.label}）` : `@${b.bot_username}` }))}
            />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
