import { useEffect, useState } from 'react'
import { Table, Button, Space, Select, Input, Modal, Form, Tag, Popconfirm, message } from 'antd'
import { getBlacklist, addBlacklist, removeBlacklist, type BlacklistItem } from '../../api'

const TYPE_LABEL: Record<string, string> = { ip: 'IP', device: '设备', region: '地域', user: '用户' }

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
    </div>
  )
}
