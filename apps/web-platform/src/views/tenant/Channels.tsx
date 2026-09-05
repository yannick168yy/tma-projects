import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm,
  Select, Space, Switch, Table, Tag, Typography, message,
} from 'antd'
import {
  deleteTenantChannel, listTenantChannels, saveTenantChannel, type TenantChannelRow,
} from '../../api'
import { useAuthStore } from '../../stores/auth'
import { useTenant } from './context'

interface ChannelForm {
  channelCode: string
  owner: 'platform' | 'tenant'
  feeRatePct: number
  feeFixed: number
  merchantNo?: string
  credential?: string
  enabled: boolean
}

/**
 * 通道归属决定资金模式（P2-7 / P2-8），也决定账单怎么算：
 * platform = 平台代收代付（钱进平台账户，扣通道手续费），tenant = 客户自带通道（平台不碰钱）。
 *
 * 🔴 通道代号必须与订单表里的 channel 值完全一致（如 unispay_dana）。
 * 对不上这条登记就等于没写：归属、费率、凭据全部落空，而账单照样出得来。
 */
export default function Channels() {
  const { d } = useTenant()
  const role = useAuthStore((s) => s.role)
  const canWrite = role === 'platform_super' || role === 'platform_finance'
  const [rows, setRows] = useState<TenantChannelRow[]>([])
  const [keyReady, setKeyReady] = useState(true)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<TenantChannelRow | null | undefined>(undefined)
  const [form] = Form.useForm<ChannelForm>()

  async function load() {
    setLoading(true)
    try {
      const res = await listTenantChannels(d.id)
      setRows(res.channels)
      setKeyReady(res.credentialKeyReady)
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [d.id])

  function open(row: TenantChannelRow | null) {
    setEditing(row)
    form.setFieldsValue({
      channelCode: row?.channelCode ?? '',
      owner: row?.owner ?? 'platform',
      feeRatePct: row?.feeRatePct ?? 0,
      feeFixed: row?.feeFixed ?? 0,
      merchantNo: row?.merchantNo ?? '',
      credential: '',
      enabled: row?.enabled ?? true,
    })
  }

  async function submit() {
    const v = await form.validateFields()
    try {
      await saveTenantChannel(d.id, v.channelCode, {
        owner: v.owner, feeRatePct: v.feeRatePct, feeFixed: v.feeFixed,
        merchantNo: v.merchantNo || null,
        credential: v.credential || undefined,
        enabled: v.enabled,
      })
      setEditing(undefined)
      await load()
      message.success('已保存，通道归属缓存已刷新')
    } catch (e) { message.error((e as Error).message) }
  }

  async function remove(code: string) {
    try {
      await deleteTenantChannel(d.id, code)
      await load()
      message.success('已删除，该通道回落「按平台代收」处理')
    } catch (e) { message.error((e as Error).message) }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="支付通道归属与费率" size="small"
        extra={canWrite && <Button size="small" type="primary" onClick={() => open(null)}>登记通道</Button>}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="未登记的通道按「平台代收」计费：支付凭据来自平台部署，钱进的是平台商户号"
          description="要走客户自带通道（钱直接进客户账户、平台只按回调流水计费），必须在这里显式登记为「租户自带」并配好凭据。" />
        {!keyReady && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }}
            message="服务端未配置 TENANT_CREDENTIAL_KEY，暂时无法保存通道凭据"
            description="凭据一律加密存储，没有密钥时直接拒绝而不是明文落库。" />
        )}
        <Table rowKey="id" size="small" pagination={false} dataSource={rows} loading={loading}
          locale={{ emptyText: '未登记任何通道 —— 全部按平台代收处理' }}
          columns={[
            { title: '通道代号', dataIndex: 'channelCode',
              render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
            { title: '资金模式', dataIndex: 'owner', width: 120,
              render: (v: string) => v === 'platform'
                ? <Tag color="gold">平台代收代付</Tag>
                : <Tag color="blue">租户自带</Tag> },
            { title: '费率', width: 140,
              render: (_, r) => r.owner === 'platform'
                ? `${r.feeRatePct}% + ${r.feeFixed}/笔`
                : <Typography.Text type="secondary">不适用</Typography.Text> },
            { title: '商户号', dataIndex: 'merchantNo', render: (v: string | null) => v ?? '-' },
            { title: '凭据', dataIndex: 'credentialMasked', width: 180,
              render: (v: string | null, r) => v
                ? <Typography.Text code>{v}</Typography.Text>
                : r.owner === 'tenant'
                  ? <Tag color="red">缺凭据，建单会被拒</Tag>
                  : <Typography.Text type="secondary">用平台凭据</Typography.Text> },
            { title: '启用', dataIndex: 'enabled', width: 70,
              render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
            ...(canWrite ? [{
              title: '操作', width: 110,
              render: (_: unknown, r: TenantChannelRow) => (
                <Space size={4}>
                  <Button size="small" type="link" onClick={() => open(r)}>改</Button>
                  <Popconfirm title="删除该登记？" description="删除后该通道按平台代收计费"
                    onConfirm={() => void remove(r.channelCode)}>
                    <Button size="small" type="link" danger>删</Button>
                  </Popconfirm>
                </Space>
              ),
            }] : []),
          ]} />
      </Card>

      <Card title="聚合商子代理" size="small">
        <Table rowKey="provider" size="small" pagination={false} dataSource={d.providers}
          locale={{ emptyText: '未配置（一键开站时自动创建）' }}
          columns={[
            { title: '聚合商', dataIndex: 'provider' },
            { title: '子代理账号', dataIndex: 'agentAccount' },
            { title: '状态', dataIndex: 'status' },
          ]} />
      </Card>

      <Modal title={editing ? `修改通道 ${editing.channelCode}` : '登记通道'} open={editing !== undefined}
        onCancel={() => setEditing(undefined)} onOk={submit} destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          <Form.Item name="channelCode" label="通道代号"
            rules={[{ required: true, pattern: /^[a-z0-9_]{2,32}$/, message: '小写字母、数字、下划线' }]}
            help="必须与订单表里的 channel 值一致，如 unispay_dana / yfpay_gcash">
            <Input disabled={Boolean(editing)} placeholder="unispay_dana" />
          </Form.Item>
          <Form.Item name="owner" label="资金模式" rules={[{ required: true }]}>
            <Select options={[
              { value: 'platform', label: '平台代收代付（钱进平台账户，平台收手续费）' },
              { value: 'tenant', label: '租户自带通道（钱直接进客户账户）' },
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.owner !== b.owner}>
            {({ getFieldValue }) => getFieldValue('owner') === 'platform' ? (
              <Space size="large" align="start">
                <Form.Item name="feeRatePct" label="通道费率（%）"
                  tooltip="进 GGR 扣减项：模式 A 的手续费由平台垫付，算净收益时要扣掉">
                  <InputNumber min={0} max={100} step={0.1} style={{ width: 130 }} />
                </Form.Item>
                <Form.Item name="feeFixed" label="每笔固定手续费">
                  <InputNumber min={0} step={1} style={{ width: 130 }} />
                </Form.Item>
              </Space>
            ) : (
              <Form.Item name="credential" label="通道凭据"
                help={editing?.credentialMasked ? '留空表示不改动已存的凭据' : '形如 mchNo=xxx&apiKey=yyy，加密存储，后台只显掩码'}>
                <Input.TextArea rows={3} placeholder="mchNo=...&apiKey=..." />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="merchantNo" label="商户号" help="回调反查租户的兜底依据">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
