import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, Modal, Popconfirm, Segmented, Select,
  Space, Table, Tag, Tooltip, Typography, message,
} from 'antd'
import {
  addRiskBlacklist, collectRiskIdentities, getCrossTenantRisk, getRiskBlacklist, removeRiskBlacklist,
  type CrossTenantRow, type RiskBlacklistRow, type RiskIdType, type RiskSeverity,
} from '../api'
import { useAuthStore } from '../stores/auth'

const ID_TYPE_LABEL: Record<string, string> = {
  device: '设备指纹', phone: '手机号', bank_card: '收款账号', ip: 'IP', id_no: '证件号',
}
const SEVERITY_LABEL: Record<string, { text: string; color: string }> = {
  watch: { text: '只记不拦', color: 'default' },
  escalate: { text: '转人工', color: 'orange' },
  deny: { text: '直接拒绝', color: 'red' },
}

/**
 * 跨租户风控联防（P3-6）—— 包网平台独有的信号：单个客户站永远看不到
 * 「这个设备在另外三家也在刷」。
 *
 * 名单里只有摘要，没有明文：平台库躺着几十家客户的玩家手机号与卡号，一次拖库就是
 * 所有客户一起出事。所以这里加名单要填明文（只在这一次请求里出现），列表只显示掩码，
 * 也不提供反查。
 */
export default function RiskFederation() {
  const role = useAuthStore((s) => s.role)
  const canWrite = role === 'platform_super' || role === 'platform_ops'
  const [enabled, setEnabled] = useState(true)
  const [items, setItems] = useState<RiskBlacklistRow[]>([])
  const [cross, setCross] = useState<CrossTenantRow[]>([])
  const [minTenants, setMinTenants] = useState(2)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [form] = Form.useForm<{ idType: RiskIdType; rawValue: string; severity: RiskSeverity; reason: string }>()

  async function load() {
    setLoading(true)
    try {
      const [bl, cr] = await Promise.all([
        getRiskBlacklist(),
        getCrossTenantRisk(minTenants, typeFilter || undefined),
      ])
      setEnabled(bl.enabled)
      setItems(bl.items)
      setCross(cr.rows)
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [minTenants, typeFilter])

  async function submit() {
    const v = await form.validateFields()
    try {
      const res = await addRiskBlacklist(v)
      setItems(res.items)
      setAddOpen(false)
      form.resetFields()
      message.success('已加入联防名单，60 秒内全平台生效')
    } catch (e) { message.error((e as Error).message) }
  }

  async function blacklistFromCross(row: CrossTenantRow) {
    try {
      const res = await addRiskBlacklist({
        idType: row.idType as RiskIdType,
        valueHash: row.valueHash,
        valueHint: row.valueHint,
        severity: 'escalate',
        reason: `跨 ${row.tenantCount} 家租户出现（${row.tenants.join('、')}），共 ${row.userTotal} 个账号`,
      })
      setItems(res.items)
      await load()
      message.success('已加入联防名单（默认转人工，可再改为直接拒绝）')
    } catch (e) { message.error((e as Error).message) }
  }

  async function collect() {
    setCollecting(true)
    try {
      await collectRiskIdentities()
      await load()
      message.success('已重新抽数')
    } catch (e) { message.error((e as Error).message) }
    finally { setCollecting(false) }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {!enabled && (
        <Alert type="error" showIcon
          message="未配置 RISK_FEDERATION_PEPPER，跨租户联防未启用"
          description="联防只存 HMAC 摘要不存明文，需要一把盐。手机号只有 10 位数字，不加盐的 sha256 能被穷举反查，等于把客户玩家的手机号明文存进平台库 —— 所以缺盐时整个功能关闭而不是降级。生成 32 字节随机串配到 bff-node 的环境变量里。" />
      )}

      <Card title="联防名单" loading={loading} size="small"
        extra={canWrite && <Button size="small" type="primary" disabled={!enabled} onClick={() => setAddOpen(true)}>
          加入名单
        </Button>}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="名单对全部租户生效，取「租户自己的判定」与「平台联防」中更严格的那个"
          description="只记不拦=只落命中日志（观察期用）；转人工=推给该租户的提款审核；直接拒绝留给已确认的团伙。命中会同时写进客户自己的命中日志，客户能看到原因。" />
        <Table<RiskBlacklistRow> rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small' }}
          dataSource={items}
          locale={{ emptyText: '名单为空' }}
          columns={[
            { title: '类型', dataIndex: 'idType', width: 110, render: (v: string) => ID_TYPE_LABEL[v] ?? v },
            { title: '值（掩码）', dataIndex: 'valueHint', width: 130,
              render: (v: string | null) => <Typography.Text code>{v ?? '—'}</Typography.Text> },
            { title: '处置', dataIndex: 'severity', width: 110,
              render: (v: string) => <Tag color={SEVERITY_LABEL[v]?.color}>{SEVERITY_LABEL[v]?.text ?? v}</Tag> },
            { title: '原因', dataIndex: 'reason', ellipsis: true },
            { title: '来源', dataIndex: 'sourceTenantCode', width: 110,
              render: (v: string | null) => v ?? <Tag>平台</Tag> },
            { title: '命中', dataIndex: 'hitCount', width: 80, align: 'right',
              render: (v: number, r) => v === 0
                ? <Typography.Text type="secondary">0</Typography.Text>
                : <Tooltip title={`最近 ${r.lastHitAt?.slice(0, 16).replace('T', ' ')}`}>
                    <Tag color="blue">{v}</Tag></Tooltip> },
            { title: '到期', dataIndex: 'expiresAt', width: 110,
              render: (v: string | null) => v ? v.slice(0, 10) : <Typography.Text type="secondary">长期</Typography.Text> },
            ...(canWrite ? [{
              title: '操作', width: 70,
              render: (_: unknown, r: RiskBlacklistRow) => (
                <Popconfirm title="移出名单？" description="移出后该值立即不再触发联防"
                  onConfirm={() => void removeRiskBlacklist(r.id).then((res) => setItems(res.items))}>
                  <Button size="small" type="link" danger>移出</Button>
                </Popconfirm>
              ),
            }] : []),
          ]} />
      </Card>

      <Card title="跨租户撞库识别" loading={loading} size="small"
        extra={<Space>
          <Segmented size="small" value={minTenants} onChange={(v) => setMinTenants(Number(v))}
            options={[{ label: '≥2 家', value: 2 }, { label: '≥3 家', value: 3 }, { label: '≥5 家', value: 5 }]} />
          <Select size="small" style={{ width: 130 }} allowClear placeholder="全部类型"
            value={typeFilter || undefined} onChange={(v) => setTypeFilter(v ?? '')}
            options={Object.entries(ID_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          {canWrite && <Button size="small" loading={collecting} disabled={!enabled} onClick={collect}>立即抽数</Button>}
        </Space>}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="同一设备/手机号/收款账号出现在多家客户站 —— 单个客户站自己永远看不到这个信号"
          description="IP 不参与抽数：家用宽带的动态 IP 会把同城玩家全串成一伙，噪声大到没法用；但仍可手工把机房出口 IP 加进名单。身份摘要每天抽一次。" />
        <Table<CrossTenantRow> rowKey={(r) => `${r.idType}:${r.valueHash}`} size="small"
          pagination={{ pageSize: 10, size: 'small' }} dataSource={cross}
          locale={{ emptyText: enabled ? '没有出现在多家的身份（或还没抽数）' : '联防未启用' }}
          columns={[
            { title: '类型', dataIndex: 'idType', width: 110, render: (v: string) => ID_TYPE_LABEL[v] ?? v },
            { title: '值（掩码）', dataIndex: 'valueHint', width: 130,
              render: (v: string | null) => <Typography.Text code>{v ?? '—'}</Typography.Text> },
            { title: '涉及租户', dataIndex: 'tenantCount', width: 100, align: 'right',
              render: (v: number) => <Tag color={v >= 3 ? 'red' : 'orange'}>{v} 家</Tag> },
            { title: '租户', dataIndex: 'tenants', render: (v: string[]) => v.join('、') },
            { title: '账号数', dataIndex: 'userTotal', width: 90, align: 'right' },
            { title: '最近出现', dataIndex: 'lastSeen', width: 120,
              render: (v: string) => v.slice(0, 10) },
            {
              title: '操作', width: 110,
              render: (_, r) => r.blacklisted
                ? <Tag color="blue">已在名单</Tag>
                : canWrite && (
                  <Popconfirm title="加入联防名单？" description="默认「转人工」，可在上方名单里改成直接拒绝"
                    onConfirm={() => void blacklistFromCross(r)}>
                    <Button size="small" type="link">拉黑</Button>
                  </Popconfirm>
                ),
            },
          ]} />
      </Card>

      <Modal title="加入联防名单" open={addOpen} onCancel={() => setAddOpen(false)} onOk={submit} destroyOnClose>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="填明文，落库只留摘要与掩码。之后无法反查原值，也无法从平台导出客户玩家名册" />
        <Form form={form} layout="vertical" initialValues={{ idType: 'device', severity: 'escalate' }}>
          <Form.Item name="idType" label="身份类型" rules={[{ required: true }]}>
            <Select options={Object.entries(ID_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="rawValue" label="值" rules={[{ required: true, message: '请填要拉黑的值' }]}
            help="手机号带不带国码都行（内部按后 10 位比对）；卡号可带空格">
            <Input placeholder="09171234567 / 6222020212345678 / 设备指纹" />
          </Form.Item>
          <Form.Item name="severity" label="处置" rules={[{ required: true }]}>
            <Select options={[
              { value: 'watch', label: '只记不拦（观察期）' },
              { value: 'escalate', label: '转人工复核（推荐）' },
              { value: 'deny', label: '直接拒绝（已确认的团伙）' },
            ]} />
          </Form.Item>
          <Form.Item name="reason" label="原因" rules={[{ required: true, message: '必须填原因' }]}
            help="名单会直接拦玩家，事后要能解释为什么">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
