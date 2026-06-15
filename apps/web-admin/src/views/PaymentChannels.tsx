import { useEffect, useState } from 'react'
import {
  Table, Button, Switch, Tag, Space, Modal, Form, Input, InputNumber,
  Popconfirm, message, Typography, Select,
} from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  getPaymentChannels, createPaymentChannel, updatePaymentChannel, deletePaymentChannel,
  createPaymentRule, updatePaymentRule, deletePaymentRule,
  type PaymentChannel, type PaymentChannelRule,
} from '../api'
import { useAuthStore } from '../stores/auth'

function RuleTable({
  channel, onReload,
}: { channel: PaymentChannel; onReload: () => void }) {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [ruleForm] = Form.useForm<{ currency: string; amountMin: number | null; amountMax: number | null; weight: number; enabled: boolean }>()
  const [ruleModal, setRuleModal] = useState<{ open: boolean; rule?: PaymentChannelRule }>({ open: false })
  const [saving, setSaving] = useState(false)

  async function handleToggleRule(rule: PaymentChannelRule, enabled: boolean) {
    try {
      await updatePaymentRule(rule.id, { enabled })
      onReload()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  async function handleDeleteRule(id: number) {
    try { await deletePaymentRule(id); onReload() } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  async function handleSaveRule() {
    const vals = ruleForm.getFieldsValue()
    setSaving(true)
    try {
      const data = {
        currency: vals.currency ?? 'PHP',
        amountMin: vals.amountMin ?? null,
        amountMax: vals.amountMax ?? null,
        weight: vals.weight ?? 100,
        enabled: vals.enabled !== false,
      }
      if (ruleModal.rule) {
        await updatePaymentRule(ruleModal.rule.id, data)
      } else {
        await createPaymentRule(channel.id, data)
      }
      message.success('已保存')
      setRuleModal({ open: false })
      onReload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  function openAdd() {
    ruleForm.resetFields()
    ruleForm.setFieldsValue({ currency: 'PHP', weight: 100, enabled: true })
    setRuleModal({ open: true })
  }

  function openEdit(rule: PaymentChannelRule) {
    ruleForm.setFieldsValue({
      currency: rule.currency,
      amountMin: rule.amountMin ?? undefined,
      amountMax: rule.amountMax ?? undefined,
      weight: rule.weight,
      enabled: rule.enabled,
    })
    setRuleModal({ open: true, rule })
  }

  const columns: ColumnsType<PaymentChannelRule> = [
    { title: '币种', dataIndex: 'currency', width: 80 },
    {
      title: '金额区间',
      render: (_: unknown, r: PaymentChannelRule) => {
        const min = r.amountMin !== null ? r.amountMin : '无限'
        const max = r.amountMax !== null ? r.amountMax : '无限'
        return `${min} ~ ${max}`
      },
    },
    { title: '权重', dataIndex: 'weight', width: 80 },
    {
      title: '状态', width: 80,
      render: (_: unknown, r: PaymentChannelRule) => (
        <Switch
          checked={r.enabled}
          size="small"
          disabled={!isSuperAdmin}
          onChange={(v) => handleToggleRule(r, v)}
        />
      ),
    },
    {
      title: '操作', width: 100,
      render: (_: unknown, r: PaymentChannelRule) => isSuperAdmin ? (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="确认删除此规则？" onConfirm={() => handleDeleteRule(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ]

  return (
    <>
      {isSuperAdmin && (
        <Button size="small" icon={<PlusOutlined />} onClick={openAdd} style={{ marginBottom: 8 }}>
          添加规则
        </Button>
      )}
      <Table
        dataSource={channel.rules}
        rowKey="id"
        columns={columns}
        size="small"
        pagination={false}
      />
      <Modal
        open={ruleModal.open}
        title={ruleModal.rule ? '编辑规则' : '添加规则'}
        onCancel={() => setRuleModal({ open: false })}
        onOk={handleSaveRule}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={ruleForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="币种" name="currency">
            <Select options={[{ value: 'PHP', label: 'PHP' }, { value: 'USDT', label: 'USDT' }]} />
          </Form.Item>
          <Form.Item label="最小金额（含，留空=无限）" name="amountMin">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="无限制" />
          </Form.Item>
          <Form.Item label="最大金额（含，留空=无限）" name="amountMax">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="无限制" />
          </Form.Item>
          <Form.Item label="权重" name="weight">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default function PaymentChannels() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [channelModal, setChannelModal] = useState<{ open: boolean; channel?: PaymentChannel }>({ open: false })
  const [channelForm] = Form.useForm<{ name: string; provider: string; label: string; enabled: boolean; sortOrder: number }>()
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try { setChannels(await getPaymentChannels()) } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function handleToggle(channel: PaymentChannel, enabled: boolean) {
    try {
      await updatePaymentChannel(channel.id, { enabled })
      setChannels((prev) => prev.map((c) => c.id === channel.id ? { ...c, enabled } : c))
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  async function handleDelete(id: number) {
    try { await deletePaymentChannel(id); void load() } catch (e) { message.error(e instanceof Error ? e.message : '删除失败') }
  }

  async function handleSaveChannel() {
    const vals = channelForm.getFieldsValue()
    if (!vals.name || !vals.provider || !vals.label) { message.warning('name / provider / label 必填'); return }
    setSaving(true)
    try {
      if (channelModal.channel) {
        await updatePaymentChannel(channelModal.channel.id, {
          name: vals.name, provider: vals.provider, label: vals.label,
          enabled: vals.enabled, sortOrder: vals.sortOrder ?? 0,
        })
      } else {
        await createPaymentChannel({
          name: vals.name, provider: vals.provider, label: vals.label,
          enabled: vals.enabled !== false, sortOrder: vals.sortOrder ?? 0,
        })
      }
      message.success('已保存')
      setChannelModal({ open: false })
      void load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  function openAdd() {
    channelForm.resetFields()
    channelForm.setFieldsValue({ enabled: true, sortOrder: 0 })
    setChannelModal({ open: true })
  }

  function openEdit(channel: PaymentChannel) {
    channelForm.setFieldsValue({
      name: channel.name, provider: channel.provider, label: channel.label,
      enabled: channel.enabled, sortOrder: channel.sortOrder,
    })
    setChannelModal({ open: true, channel })
  }

  const columns: ColumnsType<PaymentChannel> = [
    { title: '显示名称', dataIndex: 'label', width: 150 },
    { title: '渠道标识', dataIndex: 'name', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: '服务商', dataIndex: 'provider', width: 100, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '启用',
      width: 80,
      render: (_: unknown, r: PaymentChannel) => (
        <Switch
          checked={r.enabled}
          disabled={!isSuperAdmin}
          onChange={(v) => handleToggle(r, v)}
        />
      ),
    },
    {
      title: '规则数',
      width: 80,
      render: (_: unknown, r: PaymentChannel) => (
        <Tag color={r.rules.length > 0 ? 'green' : 'default'}>{r.rules.length} 条</Tag>
      ),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, r: PaymentChannel) => isSuperAdmin ? (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="删除渠道及所有规则？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ]

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>支付渠道管理</h2>
        {isSuperAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增渠道</Button>
        )}
      </div>

      <Table
        dataSource={channels}
        rowKey="id"
        columns={columns}
        loading={loading}
        pagination={false}
        expandable={{
          expandedRowRender: (record) => (
            <div style={{ padding: '8px 16px' }}>
              <Typography.Text strong style={{ marginBottom: 8, display: 'block' }}>
                路由规则（按权重加权随机选择匹配的规则对应渠道）
              </Typography.Text>
              <RuleTable channel={record} onReload={load} />
            </div>
          ),
          rowExpandable: () => true,
        }}
      />

      <Modal
        open={channelModal.open}
        title={channelModal.channel ? '编辑渠道' : '新增渠道'}
        onCancel={() => setChannelModal({ open: false })}
        onOk={handleSaveChannel}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={channelForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="显示名称" name="label" rules={[{ required: true }]}>
            <Input placeholder="如：GCash-BeePay" />
          </Form.Item>
          <Form.Item label="渠道类型" name="name" rules={[{ required: true }]}>
            <Select options={[
              { value: 'gcash', label: 'GCash' },
              { value: 'maya', label: 'Maya' },
            ]} placeholder="选择渠道类型" />
          </Form.Item>
          <Form.Item label="服务商" name="provider" rules={[{ required: true }]}>
            <Select options={[
              { value: 'yfpay', label: 'YFPay' },
              { value: 'beepay', label: 'BeePay' },
            ]} placeholder="选择服务商" />
          </Form.Item>
          <Form.Item label="排序（数字越小越靠前）" name="sortOrder">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
