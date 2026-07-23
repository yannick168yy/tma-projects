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
  type FeeType, type PaymentChannel, type PaymentChannelRule, type PaymentTxType,
} from '../api'
import { useAuthStore } from '../stores/auth'

function RuleTable({
  channel, onReload,
}: { channel: PaymentChannel; onReload: () => void }) {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [ruleForm] = Form.useForm<{ currency: string; txType: PaymentTxType; amountMin: number | null; amountMax: number | null; weight: number; enabled: boolean }>()
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
        txType: vals.txType ?? 'both',
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
    ruleForm.setFieldsValue({ currency: 'PHP', txType: 'both', weight: 100, enabled: true })
    setRuleModal({ open: true })
  }

  function openEdit(rule: PaymentChannelRule) {
    ruleForm.setFieldsValue({
      currency: rule.currency,
      txType: rule.txType ?? 'both',
      amountMin: rule.amountMin ?? undefined,
      amountMax: rule.amountMax ?? undefined,
      weight: rule.weight,
      enabled: rule.enabled,
    })
    setRuleModal({ open: true, rule })
  }

  const TX_TYPE_LABEL: Record<PaymentTxType, { text: string; color: string }> = {
    deposit: { text: '充值', color: 'blue' },
    withdraw: { text: '提现', color: 'orange' },
    both: { text: '充值+提现', color: 'purple' },
  }

  const columns: ColumnsType<PaymentChannelRule> = [
    { title: '币种', dataIndex: 'currency', width: 70 },
    {
      title: '交易类型', dataIndex: 'txType', width: 110,
      render: (v: PaymentTxType) => {
        const { text, color } = TX_TYPE_LABEL[v] ?? { text: v, color: 'default' }
        return <Tag color={color}>{text}</Tag>
      },
    },
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
          <Form.Item label="交易类型" name="txType">
            <Select options={[
              { value: 'both', label: '充值 + 提现' },
              { value: 'deposit', label: '仅充值' },
              { value: 'withdraw', label: '仅提现' },
            ]} />
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

// 虚拟币 / TG 渠道的已知服务商与对应渠道标识（与 064 迁移播种值一致，provider→name 联动）
const CRYPTO_PROVIDER_OPTIONS = [
  { value: 'matrix', label: 'Matrix' },
  { value: 'tg_wallet', label: 'Telegram 钱包' },
  { value: 'manual', label: '手动 / 链上' },
]
const CRYPTO_NAME_OPTIONS: Record<string, { value: string; label: string }[]> = {
  matrix: [
    { value: 'matrix_usdt_w', label: 'USDT 提现' },
    { value: 'matrix_usdc_w', label: 'USDC 提现' },
    { value: 'matrix_trx_testnet', label: 'Matrix TRX 充值 (测试)' },
    { value: 'matrix_trx_testnet_w', label: 'Matrix TRX 提现 (测试)' },
  ],
  tg_wallet: [
    { value: 'tg_wallet_php', label: 'Telegram 钱包 (PHP)' },
    { value: 'tg_wallet_usdt', label: 'Telegram 钱包 (USDT)' },
  ],
  manual: [
    { value: 'usdt-trc', label: 'USDT TRC20 充值' },
    { value: 'usdc-trc', label: 'USDC TRC20 充值' },
    { value: 'usdt-trc-w', label: 'USDT TRC20 提现' },
    { value: 'usdt-erc-w', label: 'USDT ERC20 提现' },
    { value: 'usdc-trc-w', label: 'USDC TRC20 提现' },
    { value: 'usdc-erc-w', label: 'USDC ERC20 提现' },
  ],
}

type ChannelFormValues = {
  name: string
  provider: string
  label: string
  category: string
  depositFeeType: FeeType
  depositFeeValue: number
  withdrawFeeType: FeeType
  withdrawFeeValue: number
  withdrawMin: number | null
  withdrawMax: number | null
  withdrawGasFee: number
  enabled: boolean
  sortOrder: number
}

const FEE_TYPE_OPTIONS = [
  { value: 'none', label: '无' },
  { value: 'percent', label: '按比例' },
  { value: 'fixed', label: '固定金额' },
]

function formatFee(type: FeeType, value: number) {
  if (type === 'percent') return `${(value * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`
  if (type === 'fixed') return `${value.toFixed(2)}`
  return '无'
}

export default function PaymentChannels() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [channelModal, setChannelModal] = useState<{ open: boolean; channel?: PaymentChannel }>({ open: false })
  const [channelForm] = Form.useForm<ChannelFormValues>()
  const formCategory = Form.useWatch('category', channelForm)
  const formProvider = Form.useWatch('provider', channelForm)
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
          category: vals.category ?? 'fiat', enabled: vals.enabled, sortOrder: vals.sortOrder ?? 0,
          depositFeeType: vals.depositFeeType ?? 'none',
          depositFeeValue: vals.depositFeeValue ?? 0,
          withdrawFeeType: vals.withdrawFeeType ?? 'none',
          withdrawFeeValue: vals.withdrawFeeValue ?? 0,
          withdrawMin: vals.withdrawMin ?? null,
          withdrawMax: vals.withdrawMax ?? null,
          withdrawGasFee: vals.withdrawGasFee ?? 0,
        })
      } else {
        await createPaymentChannel({
          name: vals.name, provider: vals.provider, label: vals.label,
          category: vals.category ?? 'fiat', enabled: vals.enabled !== false, sortOrder: vals.sortOrder ?? 0,
          depositFeeType: vals.depositFeeType ?? 'none',
          depositFeeValue: vals.depositFeeValue ?? 0,
          withdrawFeeType: vals.withdrawFeeType ?? 'none',
          withdrawFeeValue: vals.withdrawFeeValue ?? 0,
          withdrawMin: vals.withdrawMin ?? null,
          withdrawMax: vals.withdrawMax ?? null,
          withdrawGasFee: vals.withdrawGasFee ?? 0,
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
    channelForm.setFieldsValue({
      enabled: true, sortOrder: 0, category: 'fiat',
      depositFeeType: 'none', depositFeeValue: 0,
      withdrawFeeType: 'none', withdrawFeeValue: 0,
    })
    setChannelModal({ open: true })
  }

  function openEdit(channel: PaymentChannel) {
    channelForm.setFieldsValue({
      name: channel.name, provider: channel.provider, label: channel.label,
      category: channel.category ?? 'fiat', enabled: channel.enabled, sortOrder: channel.sortOrder,
      depositFeeType: channel.depositFeeType ?? 'none',
      depositFeeValue: channel.depositFeeValue ?? 0,
      withdrawFeeType: channel.withdrawFeeType ?? 'none',
      withdrawFeeValue: channel.withdrawFeeValue ?? 0,
      withdrawMin: channel.withdrawMin ?? null,
      withdrawMax: channel.withdrawMax ?? null,
      withdrawGasFee: channel.withdrawGasFee ?? 0,
    })
    setChannelModal({ open: true, channel })
  }

  const columns: ColumnsType<PaymentChannel> = [
    { title: '显示名称', dataIndex: 'label', width: 150 },
    { title: '渠道标识', dataIndex: 'name', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '类别', dataIndex: 'category', width: 80,
      render: (v: string) => v === 'crypto'
        ? <Tag color="gold">虚拟币</Tag>
        : <Tag color="green">法币</Tag>,
    },
    { title: '服务商', dataIndex: 'provider', width: 100, render: (v: string) => <Tag color="blue">{v}</Tag> },
    {
      title: '手续费',
      width: 180,
      render: (_: unknown, r: PaymentChannel) => (
        <Space direction="vertical" size={0}>
          <span>代收 {formatFee(r.depositFeeType, r.depositFeeValue)}</span>
          <span>代付 {formatFee(r.withdrawFeeType, r.withdrawFeeValue)}</span>
        </Space>
      ),
    },
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
      render: (_: unknown, r: PaymentChannel) => r.category === 'crypto'
        ? <Tag>—</Tag>
        : <Tag color={r.rules.length > 0 ? 'green' : 'default'}>{r.rules.length} 条</Tag>,
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
              {record.category === 'crypto' ? (
                <Space direction="vertical" size={4}>
                  <Typography.Text type="secondary">虚拟币 / TG 渠道：开关 + 单笔提现限额 + gas 费（币种单位），无权重路由规则。</Typography.Text>
                  <Typography.Text>
                    单笔提现额度：
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      最低 {record.withdrawMin !== null ? record.withdrawMin : '不限'}
                    </Tag>
                    <Tag color="blue">
                      最高 {record.withdrawMax !== null ? record.withdrawMax : '不限'}
                    </Tag>
                    <Tag color="volcano">gas {record.withdrawGasFee ?? 0}</Tag>
                    <Typography.Text type="secondary" style={{ marginLeft: 8 }}>（编辑渠道修改）</Typography.Text>
                  </Typography.Text>
                </Space>
              ) : (
                <>
                  <Typography.Text strong style={{ marginBottom: 8, display: 'block' }}>
                    路由规则（按权重加权随机选择匹配的规则对应渠道）
                  </Typography.Text>
                  <RuleTable channel={record} onReload={load} />
                </>
              )}
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
          <Form.Item label="类别" name="category" rules={[{ required: true }]}>
            <Select options={[
              { value: 'fiat', label: '法币' },
              { value: 'crypto', label: '虚拟币 / TG' },
            ]} />
          </Form.Item>
          {formCategory === 'crypto' ? (
            <>
              <Form.Item label="服务商" name="provider" rules={[{ required: true }]}>
                <Select
                  options={CRYPTO_PROVIDER_OPTIONS}
                  placeholder="选择服务商"
                  onChange={() => channelForm.setFieldsValue({ name: undefined })}
                />
              </Form.Item>
              <Form.Item label="渠道标识" name="name" rules={[{ required: true }]}>
                <Select
                  options={CRYPTO_NAME_OPTIONS[formProvider] ?? []}
                  placeholder={formProvider ? '选择渠道标识' : '请先选择服务商'}
                  disabled={!formProvider}
                />
              </Form.Item>
              <Form.Item label="单笔提现最低额（币种单位，留空=不限）" name="withdrawMin">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="不限制" />
              </Form.Item>
              <Form.Item label="单笔提现最高额（币种单位，留空=不限）" name="withdrawMax">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="不限制" />
              </Form.Item>
              <Form.Item label="提现 gas 费（币种单位，用户在取款额外额外承担，0=不收）" name="withdrawGasFee">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="0" />
              </Form.Item>
            </>
          ) : (
            <>
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
            </>
          )}
          <Form.Item label="排序（数字越小越靠前）" name="sortOrder">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="代收手续费类型" name="depositFeeType">
            <Select options={FEE_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item label="代收手续费值" name="depositFeeValue">
            <InputNumber min={0} step={0.0001} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="代付手续费类型" name="withdrawFeeType">
            <Select options={FEE_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item label="代付手续费值" name="withdrawFeeValue">
            <InputNumber min={0} step={0.01} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
