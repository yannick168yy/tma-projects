import { useEffect, useState } from 'react'
import { Alert, Button, Card, Popconfirm, Space, Table, Tag, Typography, message } from 'antd'
import { Link } from 'react-router-dom'
import {
  getDunningPolicy, listAccounts, listManualQueue, resolveManualQueue, runDunning,
  type ManualQueueRow, type TenantAccount,
} from '../api'
import { useAuthStore } from '../stores/auth'

const KIND_LABEL: Record<string, string> = {
  payout_insufficient: '代付额度不足',
  invoice_overdue: '账单逾期',
  settle_failed: '核销失败',
}

/**
 * 额度与人工队列（P2-6 / P2-10）。
 *
 * 额度不足**不自动拒绝、不平台垫付** —— 转人工。这一页就是那个「人」看的地方：
 * 左边是谁快没额度了，右边是已经卡住的具体单子。
 */
export default function Accounts() {
  const role = useAuthStore((s) => s.role)
  const canWrite = role === 'platform_super' || role === 'platform_finance'
  const [accounts, setAccounts] = useState<Array<TenantAccount & { code: string; name: string; status: string }>>([])
  const [queue, setQueue] = useState<ManualQueueRow[]>([])
  const [policy, setPolicy] = useState<{ warnDays: number; suspendWithdrawDays: number; suspendDepositDays: number; suspendSiteDays: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [a, q, p] = await Promise.all([listAccounts(), listManualQueue('pending'), getDunningPolicy()])
      setAccounts(a)
      setQueue(q)
      setPolicy(p)
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function doRunDunning() {
    setRunning(true)
    try {
      const { actions } = await runDunning()
      message.success(actions.length === 0 ? '判定完成，无租户需要降级' : `已降级 ${actions.length} 家`)
      await load()
    } catch (e) { message.error((e as Error).message) }
    finally { setRunning(false) }
  }

  async function resolve(id: number, status: 'resolved' | 'rejected') {
    try {
      await resolveManualQueue(id, status)
      await load()
      message.success('已处理')
    } catch (e) { message.error((e as Error).message) }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="租户额度账户" loading={loading} size="small"
        extra={canWrite && <Button size="small" loading={running} onClick={doRunDunning}>立即跑一轮催收判定</Button>}>
        {policy && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={`欠费降级：逾期 ${policy.warnDays} 天进人工队列 → ${policy.suspendWithdrawDays} 天停提现 → ${policy.suspendDepositDays} 天停充值 → ${policy.suspendSiteDays} 天停站`}
            description="每天马尼拉 05:00 自动判定一次。恢复由账单核销触发，不会自动放开人工停站的租户。" />
        )}
        <Table rowKey="tenantId" size="small" pagination={false} dataSource={accounts}
          locale={{ emptyText: '还没有租户开过额度账户' }}
          columns={[
            { title: '租户', dataIndex: 'code', width: 140,
              render: (v: string, r) => <Link to={`/tenants/${r.tenantId}/billing`}>{v}</Link> },
            { title: '名称', dataIndex: 'name' },
            { title: '余额', dataIndex: 'balance', align: 'right', width: 120,
              render: (v: number) => v < 0 ? <Typography.Text type="danger">{v}</Typography.Text> : v },
            { title: '授信', dataIndex: 'creditLimit', align: 'right', width: 110 },
            { title: '押金', dataIndex: 'depositAmount', align: 'right', width: 110 },
            { title: '可动用', dataIndex: 'available', align: 'right', width: 120,
              render: (v: number) => v < 0
                ? <Tag color="red">{v}</Tag>
                : v === 0 ? <Tag color="orange">{v}</Tag> : <Tag color="green">{v}</Tag> },
            { title: '币种', dataIndex: 'currency', width: 80 },
          ]} />
      </Card>

      <Card title={`人工队列（${queue.length}）`} size="small" loading={loading}>
        <Table rowKey="id" size="small" pagination={false} dataSource={queue}
          locale={{ emptyText: '没有待处理的事项' }}
          columns={[
            { title: '类型', dataIndex: 'kind', width: 130, render: (v: string) => KIND_LABEL[v] ?? v },
            { title: '租户', dataIndex: 'code', width: 110,
              render: (v: string, r) => <Link to={`/tenants/${r.tenantId}/billing`}>{v}</Link> },
            { title: '金额', dataIndex: 'amount', width: 110, align: 'right',
              render: (v: number, r) => `${v} ${r.currency}` },
            { title: '原因', dataIndex: 'reason' },
            { title: '产生时间', dataIndex: 'createdAt', width: 160,
              render: (v: string) => v.slice(0, 16).replace('T', ' ') },
            ...(canWrite ? [{
              title: '操作', width: 130,
              render: (_: unknown, r: ManualQueueRow) => (
                <Space size={4}>
                  <Popconfirm title="标记为已处理？" onConfirm={() => void resolve(r.id, 'resolved')}>
                    <Button size="small" type="link">已处理</Button>
                  </Popconfirm>
                  <Popconfirm title="驳回该事项？" onConfirm={() => void resolve(r.id, 'rejected')}>
                    <Button size="small" type="link" danger>驳回</Button>
                  </Popconfirm>
                </Space>
              ),
            }] : []),
          ]} />
      </Card>
    </Space>
  )
}
