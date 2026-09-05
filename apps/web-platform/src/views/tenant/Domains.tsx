import { useState } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, message } from 'antd'
import { addTenantDomain, probeDomains, removeTenantDomain, setDomainAcme } from '../../api'
import { useTenant } from './context'

const CERT: Record<string, { text: string; color: string }> = {
  none: { text: '未探测', color: 'default' },
  pending_dns: { text: '待解析', color: 'orange' },
  issued: { text: '已签发', color: 'green' },
  expiring: { text: '即将到期', color: 'gold' },
  failed: { text: '异常', color: 'red' },
}

export default function Domains() {
  const { d, reload } = useTenant()
  const [probing, setProbing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm] = Form.useForm<{ type: 'platform_subdomain' | 'custom'; domain?: string; market: string; purpose: string }>()

  async function runProbe() {
    setProbing(true)
    try {
      const res = await probeDomains(d.domains.map((x) => x.id))
      const bad = res.filter((r) => r.certStatus !== 'issued')
      message.success(bad.length === 0 ? `巡检完成，${res.length} 个域名全部正常` : `巡检完成，${bad.length}/${res.length} 个域名需要处理`)
      await reload()
    } catch (e) { message.error(e instanceof Error ? e.message : '巡检失败') }
    finally { setProbing(false) }
  }

  async function submitDomain() {
    const v = await addForm.validateFields()
    try {
      const res = await addTenantDomain(d.id, v)
      message.success(`已添加 ${res.domain}`)
      setAddOpen(false)
      addForm.resetFields()
      await reload()
    } catch (e) { message.error(e instanceof Error ? e.message : '添加失败') }
  }

  async function toggleAcme(domainId: number, enabled: boolean) {
    try {
      await setDomainAcme(d.id, domainId, enabled)
      message.success(enabled ? '已开启自动签发，下一轮（最多 1 小时）生效' : '已关闭自动签发')
      await reload()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  async function delDomain(domainId: number) {
    try {
      await removeTenantDomain(d.id, domainId)
      message.success('已删除')
      await reload()
    } catch (e) { message.error(e instanceof Error ? e.message : '删除失败') }
  }

  return (
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
          // 自动签发只对自带域名有意义：平台子域名走泛域名证书，没有单独签发这回事
          { title: '自动签发', width: 100,
            render: (_, r) => r.domainType === 'platform_subdomain'
              ? <Tooltip title="平台子域名由泛域名证书覆盖"><Tag color="cyan">泛域名</Tag></Tooltip>
              : (
                <Tooltip title={r.certLastError ?? (r.certIssuedAt ? `上次签发 ${r.certIssuedAt.slice(0, 16)}` : '尚未签发')}>
                  <Switch size="small" checked={r.acmeEnabled}
                    onChange={(v) => void toggleAcme(r.id, v)} />
                </Tooltip>
              ) },
          { title: '解析到', dataIndex: 'dnsResolvedIp', width: 120, render: (v: string | null) => v ?? '-' },
          { title: '启用', dataIndex: 'enabled', width: 60, render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          { title: '操作', width: 70,
            render: (_, r) => (
              <Popconfirm title="确认删除该域名？" description="删除后该域名立即无法访问" onConfirm={() => delDomain(r.id)}>
                <Button size="small" danger>删除</Button>
              </Popconfirm>
            ) },
        ]} />

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
              { value: 'platform_subdomain', label: '平台子域名（自动生成，泛域名证书即刻可用）' },
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
    </Card>
  )
}
