import { useState } from 'react'
import {
  Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm,
  Select, Space, Switch, Table, Tag, Typography, message,
} from 'antd'
import {
  deleteTenantChannel, saveTenantChannel, saveTenantProvider, syncTenantChannels, syncTenantProvider,
  type TenantChannel, type TenantProvider,
} from '../../api'
import { useTenant } from './context'

// ── 外部对接：聚合商子代理 + 支付通道（P1-5）──────────────────────────────
// 在 568win 开子代理、在支付商开商户号都是线下签约动作，没有开户 API。
// 这里做的是登记之后的一切：录一次 → 下发到租户库 → 该租户的调用自动用自己的凭据。
export default function Channels() {
  const { d: detail, reload: onChanged } = useTenant()
  const tenantId = detail.id
  const [providerEdit, setProviderEdit] = useState<(TenantProvider & { companyKey: string }) | null>(null)
  const [channelEdit, setChannelEdit] = useState<(TenantChannel & { credential: string }) | null>(null)
  const [busy, setBusy] = useState(false)

  const keyReady = detail.credentialKeyReady

  const saveProvider = async () => {
    if (!providerEdit) return
    setBusy(true)
    try {
      await saveTenantProvider(tenantId, {
        provider: providerEdit.provider,
        agentAccount: providerEdit.agentAccount,
        companyKey: providerEdit.companyKey,
        serverId: providerEdit.serverId ?? '',
        status: providerEdit.status,
        remark: providerEdit.remark ?? '',
      })
      setProviderEdit(null)
      message.success('已保存。要让该租户真正用上，还要点「下发」')
      await onChanged()
    } catch (e) { message.error((e as Error).message) } finally { setBusy(false) }
  }

  const doSyncProvider = async (provider: string) => {
    setBusy(true)
    try {
      const r = await syncTenantProvider(tenantId, provider)
      message.success(`已下发到租户库（密钥${r.companyKey ? '✓' : '✗'} ServerId${r.serverId ? '✓' : ' 用平台默认'}）`)
      await onChanged()
    } catch (e) { message.error((e as Error).message) } finally { setBusy(false) }
  }

  const saveChannel = async () => {
    if (!channelEdit) return
    setBusy(true)
    try {
      await saveTenantChannel(tenantId, channelEdit.channelCode, {
        owner: channelEdit.owner,
        merchantNo: channelEdit.merchantNo ?? '',
        credential: channelEdit.credential,
        enabled: channelEdit.enabled,
        sortOrder: channelEdit.sortOrder,
        feeRatePct: channelEdit.feeRatePct,
        feeFixed: channelEdit.feeFixed,
      })
      setChannelEdit(null)
      message.success('已保存。要让新站真正能收款，还要点「下发通道」')
      await onChanged()
    } catch (e) { message.error((e as Error).message) } finally { setBusy(false) }
  }

  const doSyncChannels = async () => {
    setBusy(true)
    try {
      const r = await syncTenantChannels(tenantId)
      message.success(`已下发：启用 ${r.enabled.join('、') || '无'}，新建 ${r.copied} 条，关闭其余 ${r.disabled} 条`)
      await onChanged()
    } catch (e) { message.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      {!keyReady && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }}
          message="未配置 PLATFORM_CREDENTIAL_KEY，凭据无法保存"
          description="平台库里的第三方密钥一律加密存放，缺主密钥时保存会直接报错而不是以明文落库。生成一把 32 字节密钥（base64）配到 bff-node 的环境变量里。" />
      )}

      <Card title="聚合商子代理" size="small"
        extra={
          <Button size="small" disabled={!keyReady}
            onClick={() => setProviderEdit({
              provider: 'win568', agentAccount: '', status: 'pending',
              companyKeyMask: null, serverId: '', remark: '', companyKey: '',
            })}>配置 win568 子代理</Button>
        }>
        <Alert style={{ marginBottom: 12 }} type="info" showIcon
          message="子代理要先在 568win 那边线下开好，这里登记账号与密钥"
          description="下发后写进租户库，该租户的所有 win568 调用（开号、拉单、密钥轮换）自动改用自己的子代理；不下发就继续共用平台子代理，与改造前一致。" />
        <Table<TenantProvider> rowKey="provider" size="small" pagination={false} dataSource={detail.providers}
          locale={{ emptyText: '未配置，当前共用平台子代理' }}
          columns={[
            { title: '聚合商', dataIndex: 'provider', width: 90 },
            { title: '子代理账号', dataIndex: 'agentAccount' },
            { title: 'ServerId', dataIndex: 'serverId', render: (v: string | null) => v || <span style={{ color: '#999' }}>平台默认</span> },
            { title: '密钥', dataIndex: 'companyKeyMask', render: (v: string | null) => v ? <Typography.Text code>{v}</Typography.Text> : <Tag color="red">未填</Tag> },
            { title: '状态', dataIndex: 'status', width: 90,
              render: (v: string) => v === 'active' ? <Tag color="green">已下发</Tag> : v === 'disabled' ? <Tag>停用</Tag> : <Tag color="orange">待下发</Tag> },
            { title: '操作', width: 150,
              render: (_: unknown, r: TenantProvider) => (
                <Space size={4}>
                  <Button size="small" type="link" disabled={!keyReady}
                    onClick={() => setProviderEdit({ ...r, serverId: r.serverId ?? '', companyKey: '' })}>改</Button>
                  <Popconfirm title="下发到租户库？" description="该租户之后的 win568 调用都会改用这个子代理"
                    onConfirm={() => void doSyncProvider(r.provider)}>
                    <Button size="small" type="link" loading={busy}>下发</Button>
                  </Popconfirm>
                </Space>
              ) },
          ]} />
      </Card>

      <Card title="支付通道" size="small"
        extra={
          <Space>
            <Button size="small" disabled={!keyReady}
              onClick={() => setChannelEdit({
                channelCode: '', owner: 'platform', merchantNo: '', credentialMask: null,
                enabled: true, sortOrder: 100, credential: '', feeRatePct: 0, feeFixed: 0,
              })}>+ 分配通道</Button>
            <Popconfirm title="下发通道到租户库？" description="没分配到的通道会被关闭并对客户端隐藏"
              onConfirm={() => void doSyncChannels()}>
              <Button size="small" type="primary" loading={busy}>下发通道</Button>
            </Popconfirm>
          </Space>
        }>
        <Table<TenantChannel> rowKey="channelCode" size="small" pagination={false} dataSource={detail.channels}
          locale={{ emptyText: '未分配任何通道，该站开出来收不了款' }}
          columns={[
            { title: '通道', dataIndex: 'channelCode', width: 110 },
            { title: '归属', dataIndex: 'owner', width: 110,
              render: (v: string) => v === 'platform' ? <Tag color="gold">平台代收</Tag> : <Tag color="blue">租户自带</Tag> },
            { title: '商户号', dataIndex: 'merchantNo', render: (v: string | null) => v ?? '-' },
            // 手续费只有平台代收才有意义：模式 B 的钱不经平台，手续费是客户自己和支付商结
            { title: '手续费', width: 130,
              render: (_: unknown, r: TenantChannel) => r.owner === 'platform'
                ? `${r.feeRatePct}% + ${r.feeFixed}/笔`
                : <span style={{ color: '#999' }}>不适用</span> },
            { title: '密钥', dataIndex: 'credentialMask',
              render: (v: string | null) => v ? <Typography.Text code>{v}</Typography.Text> : <span style={{ color: '#999' }}>用平台默认</span> },
            { title: '启用', dataIndex: 'enabled', width: 70, render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
            { title: '操作', width: 110,
              render: (_: unknown, r: TenantChannel) => (
                <Space size={4}>
                  <Button size="small" type="link" disabled={!keyReady}
                    onClick={() => setChannelEdit({ ...r, credential: '' })}>改</Button>
                  <Popconfirm title="移除该通道分配？" onConfirm={async () => {
                    await deleteTenantChannel(tenantId, r.channelCode); await onChanged()
                  }}>
                    <Button size="small" type="link" danger>删</Button>
                  </Popconfirm>
                </Space>
              ) },
          ]} />
      </Card>

      <Modal open={providerEdit !== null} title="win568 子代理" confirmLoading={busy}
        onCancel={() => setProviderEdit(null)} onOk={() => void saveProvider()}>
        <Form layout="vertical" size="small">
          <Form.Item label="子代理账号" help="在 568win 后台开好的子代理登录名">
            <Input value={providerEdit?.agentAccount ?? ''}
              onChange={(e) => setProviderEdit((s) => s && { ...s, agentAccount: e.target.value })} />
          </Form.Item>
          <Form.Item label="CompanyKey" help={providerEdit?.companyKeyMask ? `当前 ${providerEdit.companyKeyMask}，留空表示不改` : '必填'}>
            <Input.Password placeholder={providerEdit?.companyKeyMask ? '留空不改' : ''}
              value={providerEdit?.companyKey ?? ''}
              onChange={(e) => setProviderEdit((s) => s && { ...s, companyKey: e.target.value })} />
          </Form.Item>
          <Form.Item label="ServerId" help="留空则继续用平台默认的 ServerId">
            <Input value={providerEdit?.serverId ?? ''}
              onChange={(e) => setProviderEdit((s) => s && { ...s, serverId: e.target.value })} />
          </Form.Item>
          <Form.Item label="状态">
            <Select style={{ width: 160 }} value={providerEdit?.status ?? 'pending'}
              onChange={(v) => setProviderEdit((s) => s && { ...s, status: v })}
              options={[
                { value: 'pending', label: '待下发' },
                { value: 'active', label: '已启用' },
                { value: 'disabled', label: '停用' },
              ]} />
          </Form.Item>
          <Form.Item label="备注">
            <Input value={providerEdit?.remark ?? ''}
              onChange={(e) => setProviderEdit((s) => s && { ...s, remark: e.target.value })} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={channelEdit !== null} title="支付通道" confirmLoading={busy}
        onCancel={() => setChannelEdit(null)} onOk={() => void saveChannel()}>
        <Form layout="vertical" size="small">
          <Form.Item label="通道代号" help="与租户库 payment_channels.provider 一致，如 unispay / yfpay / matrix">
            <Input disabled={Boolean(channelEdit?.credentialMask) || Boolean(channelEdit?.merchantNo)}
              value={channelEdit?.channelCode ?? ''}
              onChange={(e) => setChannelEdit((s) => s && { ...s, channelCode: e.target.value })} />
          </Form.Item>
          <Form.Item label="归属" help="平台代收=资金进平台账户、租户记应付；租户自带=资金直接进租户账户">
            <Select style={{ width: 200 }} value={channelEdit?.owner ?? 'platform'}
              onChange={(v) => setChannelEdit((s) => s && { ...s, owner: v })}
              options={[
                { value: 'platform', label: '平台统一代收代付' },
                { value: 'tenant', label: '租户自带通道' },
              ]} />
          </Form.Item>
          <Form.Item label="商户号" help="回调按商户号反查租户的兜底依据，租户自带通道必填">
            <Input value={channelEdit?.merchantNo ?? ''}
              onChange={(e) => setChannelEdit((s) => s && { ...s, merchantNo: e.target.value })} />
          </Form.Item>
          <Form.Item label="通道密钥" help={channelEdit?.credentialMask ? `当前 ${channelEdit.credentialMask}，留空表示不改` : '留空则用平台默认凭据'}>
            <Input.Password value={channelEdit?.credential ?? ''}
              onChange={(e) => setChannelEdit((s) => s && { ...s, credential: e.target.value })} />
          </Form.Item>
          {channelEdit?.owner === 'platform' && (
            <Space>
              <Form.Item label="通道费率（%）"
                help="平台代收的手续费由平台垫付，算 GGR 净收益时要扣掉（P2-7）">
                <InputNumber min={0} max={100} step={0.1} style={{ width: 140 }}
                  value={channelEdit?.feeRatePct ?? 0}
                  onChange={(v) => setChannelEdit((s) => s && { ...s, feeRatePct: Number(v ?? 0) })} />
              </Form.Item>
              <Form.Item label="每笔固定手续费">
                <InputNumber min={0} step={1} style={{ width: 140 }}
                  value={channelEdit?.feeFixed ?? 0}
                  onChange={(v) => setChannelEdit((s) => s && { ...s, feeFixed: Number(v ?? 0) })} />
              </Form.Item>
            </Space>
          )}
          <Space>
            <Form.Item label="启用">
              <Switch checked={channelEdit?.enabled ?? true}
                onChange={(v) => setChannelEdit((s) => s && { ...s, enabled: v })} />
            </Form.Item>
            <Form.Item label="排序">
              <InputNumber min={0} value={channelEdit?.sortOrder ?? 100}
                onChange={(v) => setChannelEdit((s) => s && { ...s, sortOrder: Number(v ?? 100) })} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  )
}
