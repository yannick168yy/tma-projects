import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import {
  addTenantDomain, getTenantDetail, probeDomains, removeTenantDomain,
  updateTenantPool, updateTenantStatus, type TenantDetail as Detail,
} from '../api'

const STATUS: Record<string, { text: string; color: string }> = {
  trial: { text: '试用', color: 'blue' },
  active: { text: '正常', color: 'green' },
  withdraw_suspended: { text: '停提现', color: 'orange' },
  deposit_suspended: { text: '停充值', color: 'orange' },
  suspended: { text: '停站', color: 'red' },
  closed: { text: '关站', color: 'default' },
}

const CERT: Record<string, { text: string; color: string }> = {
  none: { text: '未探测', color: 'default' },
  pending_dns: { text: '待解析', color: 'orange' },
  issued: { text: '已签发', color: 'green' },
  expiring: { text: '即将到期', color: 'gold' },
  failed: { text: '异常', color: 'red' },
}

// 与服务端的状态机保持一致；服务端仍会二次校验，前端只是少让人点错
const FLOW: Record<string, string[]> = {
  trial: ['active', 'suspended', 'closed'],
  active: ['trial', 'withdraw_suspended', 'deposit_suspended', 'suspended', 'closed'],
  withdraw_suspended: ['active', 'deposit_suspended', 'suspended', 'closed'],
  deposit_suspended: ['active', 'withdraw_suspended', 'suspended', 'closed'],
  suspended: ['active', 'closed'],
  closed: [],
}

export default function TenantDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [next, setNext] = useState<string>()
  const [pool, setPool] = useState({ min: 0, max: 1, queueLimit: 0 })
  const [savingPool, setSavingPool] = useState(false)
  const [probing, setProbing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm] = Form.useForm<{ type: 'platform_subdomain' | 'custom'; domain?: string; market: string; purpose: string }>()

  async function load() {
    setLoading(true)
    try {
      const detail = await getTenantDetail(Number(id))
      setD(detail)
      setPool(detail.pool)
    }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [id])

  async function changeStatus() {
    if (!next || !d) return
    try {
      await updateTenantStatus(d.id, next)
      message.success('状态已变更')
      setNext(undefined)
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '变更失败') }
  }

  async function savePool() {
    if (!d) return
    if (pool.min > pool.max) { message.error('初始连接数不能大于最大连接数'); return }
    setSavingPool(true)
    try {
      const res = await updateTenantPool(d.id, pool.min, pool.max, pool.queueLimit)
      message.success(res.poolRecreated ? '已保存，连接池已按新配置重建' : '已保存，下次建池时生效')
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSavingPool(false) }
  }

  async function runProbe() {
    if (!d) return
    setProbing(true)
    try {
      const res = await probeDomains(d.domains.map((x) => x.id))
      const bad = res.filter((r) => r.certStatus !== 'issued')
      message.success(bad.length === 0 ? `巡检完成，${res.length} 个域名全部正常` : `巡检完成，${bad.length}/${res.length} 个域名需要处理`)
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '巡检失败') }
    finally { setProbing(false) }
  }

  async function submitDomain() {
    if (!d) return
    const v = await addForm.validateFields()
    try {
      const res = await addTenantDomain(d.id, v)
      message.success(`已添加 ${res.domain}`)
      setAddOpen(false)
      addForm.resetFields()
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '添加失败') }
  }

  async function delDomain(domainId: number) {
    if (!d) return
    try {
      await removeTenantDomain(d.id, domainId)
      message.success('已删除')
      await load()
    } catch (e) { message.error(e instanceof Error ? e.message : '删除失败') }
  }

  if (!d) return <Card loading={loading} title="租户详情" />

  const options = (FLOW[d.status] ?? []).map((s) => ({ value: s, label: STATUS[s]?.text ?? s }))

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card
        title={`租户详情 · ${d.code}`}
        extra={<Button onClick={() => nav('/tenants')}>返回列表</Button>}
        loading={loading}
      >
        <Descriptions column={3} size="small" bordered>
          <Descriptions.Item label="名称">{d.name}</Descriptions.Item>
          <Descriptions.Item label="库">{d.database}</Descriptions.Item>
          <Descriptions.Item label="套餐">{d.planName ?? <Tag>未分配</Tag>}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS[d.status]?.color}>{STATUS[d.status]?.text ?? d.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="连接池">
            <Space>
              <InputNumber size="small" min={0} max={pool.max} value={pool.min} style={{ width: 72 }}
                onChange={(v) => setPool({ ...pool, min: Number(v ?? 0) })} />
              <span>/</span>
              <InputNumber size="small" min={1} max={100} value={pool.max} style={{ width: 72 }}
                onChange={(v) => setPool({ ...pool, max: Number(v ?? 1) })} />
              <span>/</span>
              <InputNumber size="small" min={0} max={10000} value={pool.queueLimit} style={{ width: 88 }}
                onChange={(v) => setPool({ ...pool, queueLimit: Number(v ?? 0) })} />
              <Button size="small" type="primary" loading={savingPool} onClick={savePool}
                disabled={pool.min === d.pool.min && pool.max === d.pool.max && pool.queueLimit === d.pool.queueLimit}>
                保存
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>初始 / 最大 / 排队上限</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{d.createdAt}</Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>{d.remark ?? '-'}</Descriptions.Item>
        </Descriptions>

        <div style={{ marginTop: 16 }}>
          {d.selfOperated ? (
            <Alert type="info" showIcon message="自营站不允许改状态：停掉它等于把整个平台自己关了" />
          ) : options.length === 0 ? (
            <Alert type="warning" showIcon message="已关站，无可用状态变更" />
          ) : (
            <Space>
              <Select placeholder="变更为" style={{ width: 160 }} value={next} onChange={setNext} options={options} />
              <Popconfirm
                title="确认变更状态？"
                description="停提现/停充值/停站会立即影响该租户的线上用户"
                onConfirm={changeStatus}
                disabled={!next}
              >
                <Button type="primary" danger disabled={!next}>执行变更</Button>
              </Popconfirm>
            </Space>
          )}
        </div>
      </Card>

      <Card title="市场" size="small">
        <Table rowKey="market" size="small" pagination={false} dataSource={d.markets}
          columns={[
            { title: '市场', dataIndex: 'market' },
            { title: '币种', dataIndex: 'currency' },
            { title: '时区', dataIndex: 'timezone' },
            { title: '启用', dataIndex: 'enabled', render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          ]} />
      </Card>

      <Card
        title={`域名（${d.domains.length}）`}
        size="small"
        extra={
          <Space>
            <Button size="small" loading={probing} onClick={runProbe}>巡检 DNS/证书</Button>
            <Button size="small" type="primary" onClick={() => setAddOpen(true)}>添加域名</Button>
          </Space>
        }
      >
        <Table rowKey="id" size="small" pagination={false} dataSource={d.domains}
          columns={[
            { title: '域名', dataIndex: 'domain',
              render: (v: string, r) => (
                <Space size={4}>
                  <span>{v}</span>
                  {r.domainType === 'platform_subdomain' && <Tag color="cyan">平台子域名</Tag>}
                </Space>
              ) },
            { title: '市场', dataIndex: 'market', width: 70 },
            { title: '用途', dataIndex: 'purpose', width: 90 },
            { title: '证书', dataIndex: 'certStatus', width: 110,
              render: (v: string, r) => {
                const m = CERT[v] ?? { text: v, color: 'default' }
                const tag = <Tag color={m.color}>{m.text}</Tag>
                // 失败/待解析的原因是排查依据，必须能看到，不能只显示一个状态色块
                return r.certDetail ? <Tooltip title={r.certDetail}>{tag}</Tooltip> : tag
              } },
            { title: '到期', dataIndex: 'certExpiresAt', width: 110,
              render: (v: string | null) => v ? v.slice(0, 10) : '-' },
            { title: '解析到', dataIndex: 'dnsResolvedIp', width: 120, render: (v: string | null) => v ?? '-' },
            { title: '启用', dataIndex: 'enabled', width: 60, render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
            { title: '操作', width: 70,
              render: (_, r) => (
                <Popconfirm title="确认删除该域名？" description="删除后该域名立即无法访问" onConfirm={() => delDomain(r.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              ) },
          ]} />
      </Card>

      <Modal
        title="添加域名"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={submitDomain}
        okText="添加"
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" initialValues={{ type: 'platform_subdomain', purpose: 'site', market: d.markets[0]?.market }}>
          <Form.Item name="type" label="接入方式">
            <Select options={[
              { value: 'platform_subdomain', label: `平台子域名（自动生成，泛域名证书即刻可用）` },
              { value: 'custom', label: '客户自带域名（需客户先配 A 记录）' },
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.type !== b.type}>
            {({ getFieldValue }) => getFieldValue('type') === 'custom' ? (
              <Form.Item name="domain" label="域名" rules={[{ required: true, message: '请输入域名' }]}>
                <Input placeholder="abcgame.com" />
              </Form.Item>
            ) : (
              <Alert type="info" showIcon style={{ marginBottom: 16 }}
                message={`将按租户代号自动生成，形如 ${d.code}.<平台根域名>`}
                description="子域名由平台生成而非手工填写，避免抢注他人子域名或写出泛解析覆盖不到的地址。" />
            )}
          </Form.Item>
          <Form.Item name="market" label="归属市场" rules={[{ required: true }]}>
            <Select options={d.markets.map((m) => ({ value: m.market, label: `${m.market}（${m.currency}）` }))} />
          </Form.Item>
          <Form.Item name="purpose" label="用途" rules={[{ required: true }]}>
            <Select options={[
              { value: 'site', label: '前台站点' },
              { value: 'admin', label: '业务后台' },
              { value: 'app_route', label: 'App 线路' },
              { value: 'landing', label: '落地页' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Card title="聚合商子代理" size="small">
        <Table rowKey="provider" size="small" pagination={false} dataSource={d.providers}
          locale={{ emptyText: '未配置（P1-5 一键开站时自动创建）' }}
          columns={[
            { title: '聚合商', dataIndex: 'provider' },
            { title: '子代理账号', dataIndex: 'agentAccount' },
            { title: '状态', dataIndex: 'status' },
          ]} />
      </Card>

      <Card title="支付通道" size="small">
        <Table rowKey="channelCode" size="small" pagination={false} dataSource={d.channels}
          locale={{ emptyText: '未配置' }}
          columns={[
            { title: '通道', dataIndex: 'channelCode' },
            { title: '归属', dataIndex: 'owner', render: (v: string) => v === 'platform' ? <Tag color="gold">平台代收</Tag> : <Tag color="blue">租户自带</Tag> },
            { title: '商户号', dataIndex: 'merchantNo', render: (v: string | null) => v ?? '-' },
            { title: '启用', dataIndex: 'enabled', render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          ]} />
      </Card>
    </Space>
  )
}
