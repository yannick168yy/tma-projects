import { useEffect, useState } from 'react'
import { Alert, Button, Card, Descriptions, InputNumber, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd'
import { updateTenantPool, updateTenantStatus } from '../../api'
import { STATUS, useTenant } from './context'

// 与服务端的状态机保持一致；服务端仍会二次校验，前端只是少让人点错
const FLOW: Record<string, string[]> = {
  trial: ['active', 'suspended', 'closed'],
  active: ['trial', 'withdraw_suspended', 'deposit_suspended', 'suspended', 'closed'],
  withdraw_suspended: ['active', 'deposit_suspended', 'suspended', 'closed'],
  deposit_suspended: ['active', 'withdraw_suspended', 'suspended', 'closed'],
  suspended: ['active', 'closed'],
  closed: [],
}

export default function Overview() {
  const { d, reload } = useTenant()
  const [next, setNext] = useState<string>()
  const [pool, setPool] = useState(d.pool)
  const [savingPool, setSavingPool] = useState(false)

  useEffect(() => { setPool(d.pool) }, [d.pool])

  async function changeStatus() {
    if (!next) return
    try {
      await updateTenantStatus(d.id, next)
      message.success('状态已变更')
      setNext(undefined)
      await reload()
    } catch (e) { message.error(e instanceof Error ? e.message : '变更失败') }
  }

  async function savePool() {
    if (pool.min > pool.max) { message.error('初始连接数不能大于最大连接数'); return }
    setSavingPool(true)
    try {
      const res = await updateTenantPool(d.id, pool.min, pool.max, pool.queueLimit)
      message.success(res.poolRecreated ? '已保存，连接池已按新配置重建' : '已保存，下次建池时生效')
      await reload()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSavingPool(false) }
  }

  const options = (FLOW[d.status] ?? []).map((s) => ({ value: s, label: STATUS[s]?.text ?? s }))

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
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

      <Card title="状态变更" size="small">
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
    </Space>
  )
}
