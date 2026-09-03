import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, Descriptions, Popconfirm, Select, Space, Table, Tag, message } from 'antd'
import { getTenantDetail, updateTenantStatus, type TenantDetail as Detail } from '../api'

const STATUS: Record<string, { text: string; color: string }> = {
  trial: { text: '试用', color: 'blue' },
  active: { text: '正常', color: 'green' },
  withdraw_suspended: { text: '停提现', color: 'orange' },
  deposit_suspended: { text: '停充值', color: 'orange' },
  suspended: { text: '停站', color: 'red' },
  closed: { text: '关站', color: 'default' },
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

  async function load() {
    setLoading(true)
    try { setD(await getTenantDetail(Number(id))) }
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
          <Descriptions.Item label="连接池">初始 {d.pool.min} / 最大 {d.pool.max} / 排队 {d.pool.queueLimit}</Descriptions.Item>
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

      <Card title={`域名（${d.domains.length}）`} size="small">
        <Table rowKey="id" size="small" pagination={false} dataSource={d.domains}
          columns={[
            { title: '域名', dataIndex: 'domain' },
            { title: '市场', dataIndex: 'market', width: 80 },
            { title: '用途', dataIndex: 'purpose', width: 100 },
            { title: 'App 线路组', dataIndex: 'appMarket', width: 110, render: (v: string | null) => v ?? '-' },
            { title: '优先级', dataIndex: 'appPriority', width: 80 },
            { title: '启用', dataIndex: 'enabled', width: 70, render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          ]} />
      </Card>

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
