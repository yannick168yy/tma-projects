import { useEffect, useState } from 'react'
import { Alert, Table, Button, Space, Select, Input, Modal, Form, Tag, Popconfirm, message } from 'antd'
import {
  getBlacklist, addBlacklist, removeBlacklist, type BlacklistItem,
  getPromoWhitelist, addPromoWhitelist, removePromoWhitelist, type PromoWhitelistItem,
} from '../../api'

const TYPE_LABEL: Record<string, string> = { ip: 'IP', device: '设备', region: '地域', user: '用户' }
const WL_TYPE_LABEL: Record<string, string> = { device: '设备', ip: 'IP', user: '用户' }

// 各类型实际生效的管控点，与 bg_risk_policy 的 seed 一致
const TYPE_EFFECT: Record<string, string> = {
  ip: '登录/注册、优惠领取 → 拒绝；提现 → 转人工审核',
  device: '登录/注册、优惠领取 → 拒绝；提现 → 转人工审核',
  user: '登录/注册、优惠领取 → 拒绝；提现 → 转人工审核',
  region: '登录/注册 → 拒绝',
}

export default function Blacklist() {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<BlacklistItem[]>([])
  const [typeFilter, setTypeFilter] = useState<string | undefined>()
  const [addOpen, setAddOpen] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try { setItems((await getBlacklist(typeFilter)).items) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [typeFilter])

  async function doAdd() {
    try {
      const v = await form.validateFields()
      await addBlacklist(v)
      message.success('已添加'); setAddOpen(false); form.resetFields(); await load()
    } catch (e) {
      if (e instanceof Error) message.error(e.message)
    }
  }
  async function doRemove(id: number) {
    await removeBlacklist(id); message.success('已删除'); await load()
  }

  const columns = [
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag>{TYPE_LABEL[v] ?? v}</Tag> },
    { title: '值', dataIndex: 'value' },
    { title: '生效范围', dataIndex: 'type', key: 'effect', render: (v: string) => <span style={{ fontSize: 12, color: '#666' }}>{TYPE_EFFECT[v] ?? '—'}</span> },
    { title: '原因', dataIndex: 'reason', render: (v: string | null) => v ?? '—' },
    { title: '添加人', dataIndex: 'createdBy', width: 120, render: (v: string | null) => v ?? '—' },
    { title: '添加时间', dataIndex: 'createdAt', width: 170, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    { title: '操作', key: 'op', width: 80, render: (_: unknown, r: BlacklistItem) => (
      <Popconfirm title="确认删除？" onConfirm={() => doRemove(r.id)}><Button type="link" size="small" danger>删除</Button></Popconfirm>
    ) },
  ]

  return (
    <div>
      <h2>风控名单</h2>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="名单会立即生效并拦截真实用户"
        description="与行为规则的影子模式不同，名单是人工明确添加的，意图清晰，因此直接执行拦截。添加 IP / 地域前请确认其影响范围——NAT 与运营商出口下，一个 IP 可能对应大量正常用户。"
      />
      <Space style={{ marginBottom: 16 }}>
        <Select value={typeFilter} placeholder="类型" allowClear style={{ width: 140 }} onChange={setTypeFilter}
          options={Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
        <Button type="primary" onClick={() => setAddOpen(true)}>添加</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={items} loading={loading} size="small" pagination={false} />

      <Modal open={addOpen} title="添加风控名单" onOk={doAdd} onCancel={() => setAddOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item name="value" label="值" rules={[{ required: true }]} extra="IP / 设备ID / 地域 / 用户ID">
            <Input />
          </Form.Item>
          <Form.Item name="reason" label="原因"><Input /></Form.Item>
        </Form>
      </Modal>

      <PromoWhitelist />
    </div>
  )
}

// 领奖白名单：命中即放行拉新礼金设备防薅，供己方测试机反复领优惠
function PromoWhitelist() {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<PromoWhitelistItem[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try { setItems((await getPromoWhitelist()).items) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function doAdd() {
    try {
      const v = await form.validateFields()
      await addPromoWhitelist(v)
      message.success('已添加'); setAddOpen(false); form.resetFields(); await load()
    } catch (e) { if (e instanceof Error) message.error(e.message) }
  }
  async function doRemove(id: number) {
    await removePromoWhitelist(id); message.success('已删除'); await load()
  }

  const columns = [
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color="green">{WL_TYPE_LABEL[v] ?? v}</Tag> },
    { title: '值', dataIndex: 'value' },
    { title: '备注', dataIndex: 'note', render: (v: string | null) => v ?? '—' },
    { title: '添加人', dataIndex: 'createdBy', width: 120, render: (v: string | null) => v ?? '—' },
    { title: '添加时间', dataIndex: 'createdAt', width: 170, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    { title: '操作', key: 'op', width: 80, render: (_: unknown, r: PromoWhitelistItem) => (
      <Popconfirm title="确认删除？" onConfirm={() => doRemove(r.id)}><Button type="link" size="small" danger>删除</Button></Popconfirm>
    ) },
  ]

  return (
    <div style={{ marginTop: 32 }}>
      <h2>领奖白名单（测试机放行）</h2>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="命中白名单即完全放行「拉新礼金设备防薅」，供己方测试机反复领 trial / app下载金"
        description={
          <span>
            仅作用于优惠领取的设备去重与注册连环检测，不影响提现审核等其它风控。<br />
            · <b>IP</b>：测试机出口公网 IP（最省事，一条覆盖该网络下所有测试注册；但 CGNAT/VPN 下 IP 会变）<br />
            · <b>设备</b>：X-Device-Id 或硬件指纹（在「用户详情 / 登录记录」里可查到该测试号的设备值）<br />
            · <b>用户</b>：指定测试账号 ID（每次新注册的号不同，一般不用这个）
          </span>
        }
      />
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setAddOpen(true)}>添加白名单</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={items} loading={loading} size="small" pagination={false} />

      <Modal open={addOpen} title="添加领奖白名单" onOk={doAdd} onCancel={() => setAddOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="类型" rules={[{ required: true }]} initialValue="ip">
            <Select options={Object.entries(WL_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item name="value" label="值" rules={[{ required: true }]} extra="IP / 设备ID或指纹 / 用户ID">
            <Input placeholder="如出口IP 136.158.x.x" />
          </Form.Item>
          <Form.Item name="note" label="备注" extra="如 测试机-yannick"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
