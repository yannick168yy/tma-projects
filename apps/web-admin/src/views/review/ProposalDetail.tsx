import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, Descriptions, Tag, Button, Space, Table, Modal, Input, message, Spin, Row, Col, Alert, Popconfirm } from 'antd'
import {
  getReviewProposalDetail, approveWithdrawal, rejectWithdrawal, rerunReview,
  type ReviewProposalDetail,
} from '../../api'
import { ruleVerdictTag, wdStatusLabel, toPhp } from './shared'

// 快照字段 → 中文标签 + 是否金额(分)
const SNAP_LABELS: Record<string, { label: string; cents?: boolean }> = {
  depositCents: { label: '窗口内真实存款', cents: true },
  deposit24hCents: { label: '近24h存款', cents: true },
  lifetimeDepositCount: { label: '生涯存款笔数' },
  profitCents: { label: '窗口内净盈利', cents: true },
  profit24hCents: { label: '近24h净盈利', cents: true },
  bonusCents: { label: '窗口内优惠总额', cents: true },
  completedWithdrawCount: { label: '已完成取款笔数' },
  promoTurnoverRemaining: { label: '未完成优惠流水', cents: true },
  relatedIpAccounts: { label: '同IP关联账号数' },
  relatedDeviceAccounts: { label: '同设备关联账号数' },
  tamperOrphanRounds: { label: '凭空派彩round数' },
  commissionEarnedCents: { label: '累计佣金收入', cents: true },
  commissionDownlineGgrCents: { label: '下线累计GGR', cents: true },
  commissionDupGroups: { label: '佣金重复入账组' },
}

export default function ProposalDetail() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [opLoading, setOpLoading] = useState(false)
  const [data, setData] = useState<ReviewProposalDetail | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await getReviewProposalDetail(orderId)) }
    finally { setLoading(false) }
  }, [orderId])
  useEffect(() => { void load() }, [load])

  if (loading) return <Spin />
  if (!data) return <Alert type="error" message="提案不存在" />

  const { order, user, snapshot, rules, related } = data
  const hitRules = rules.filter((r) => r.verdict === 'manual' || r.verdict === 'error')
  const canOperate = order.status === 'pending'

  async function doApprove() {
    setOpLoading(true)
    try { await approveWithdrawal(orderId); message.success('已批准并出款'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }
  async function doReject() {
    if (!reason.trim()) { message.warning('请填写拒绝原因'); return }
    setOpLoading(true)
    try { await rejectWithdrawal(orderId, reason); message.success('已拒绝并退款'); setRejectOpen(false); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }
  async function doRerun() {
    setOpLoading(true)
    try { const r = await rerunReview(orderId); message.success(`已重跑审核（第${r.round}轮）`); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => navigate(-1)}>← 返回</Button>
        <h2 style={{ margin: 0 }}>提案详情 {order.orderId}</h2>
      </Space>

      {/* 为什么转人工 */}
      {hitRules.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message={`本提案因 ${hitRules.length} 条规则转人工`}
          description={
            <Space direction="vertical" style={{ width: '100%' }}>
              {hitRules.map((r) => (
                <div key={r.ruleCode}>
                  <b>{r.ruleName}</b>
                  {r.actualValue != null && <span>：实际值 <b>{r.actualValue}</b>{r.threshold != null ? ` / 阈值 ${r.threshold}` : ''}</span>}
                  {r.detail && <code style={{ marginLeft: 8 }}>{JSON.stringify(r.detail)}</code>}
                </div>
              ))}
            </Space>
          }
        />
      )}

      <Row gutter={16}>
        <Col span={12}>
          <Card title="提案信息" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="金额">{order.amount} {order.currency}</Descriptions.Item>
              <Descriptions.Item label="渠道">{order.channelId}</Descriptions.Item>
              <Descriptions.Item label="订单状态"><Tag>{wdStatusLabel(order.status)}</Tag></Descriptions.Item>
              <Descriptions.Item label="审核结果">
                {order.reviewVerdict === 'manual' ? <Tag color="orange">转人工</Tag> : order.reviewVerdict === 'pass' ? <Tag color="green">自动通过</Tag> : <Tag>未审核</Tag>}
                {order.reviewRound ? ` 第${order.reviewRound}轮` : ''}{order.reviewMs != null ? ` · ${order.reviewMs}ms` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{new Date(order.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
              {order.handledBy && <Descriptions.Item label="人工处理">{order.handledBy} @ {order.handledAt ? new Date(order.handledAt).toLocaleString('zh-CN') : ''}</Descriptions.Item>}
              {order.rejectReason && <Descriptions.Item label="拒绝原因">{order.rejectReason}</Descriptions.Item>}
            </Descriptions>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="用户画像" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="用户">
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/users/${user.userId}`)}>{user.displayName || user.userId}</Button>
              </Descriptions.Item>
              <Descriptions.Item label="账号状态"><Tag color={user.status === 'active' ? 'green' : 'red'}>{user.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="KYC">
                {user.kycStatus ? (
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/kyc/${user.userId}`)}>
                    <Tag color={user.kycStatus === 'approved' ? 'green' : user.kycStatus === 'rejected' ? 'red' : 'processing'}>
                      {{ none: '未开始', pending: '进行中', approved: '已通过', rejected: '已拒绝' }[user.kycStatus] ?? user.kycStatus}
                    </Tag>
                  </Button>
                ) : '未提交'}
              </Descriptions.Item>
              <Descriptions.Item label="钱包可用">{toPhp(user.walletAvailable)}（冻结 {toPhp(user.walletFrozen)}）</Descriptions.Item>
              <Descriptions.Item label="注册时间">{user.registeredAt ? new Date(user.registeredAt).toLocaleString('zh-CN') : '—'}</Descriptions.Item>
              <Descriptions.Item label="上线">{user.inviterId ?? '无'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 操作 */}
      {canOperate && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space>
            <Popconfirm title="确认批准并出款？" onConfirm={doApprove}>
              <Button type="primary" loading={opLoading}>批准出款</Button>
            </Popconfirm>
            <Button danger loading={opLoading} onClick={() => setRejectOpen(true)}>拒绝退款</Button>
            <Button loading={opLoading} onClick={doRerun}>重跑审核</Button>
          </Space>
        </Card>
      )}

      {/* 审核当时快照 */}
      <Card title="审核快照（审核当时的核查数据）" size="small" style={{ marginBottom: 16 }}>
        {snapshot ? (
          <Descriptions column={3} size="small" bordered>
            {Object.entries(SNAP_LABELS).map(([k, meta]) => (
              <Descriptions.Item key={k} label={meta.label}>
                {snapshot[k] == null ? '—' : meta.cents ? toPhp(Number(snapshot[k])) : String(snapshot[k])}
              </Descriptions.Item>
            ))}
          </Descriptions>
        ) : <span style={{ color: '#999' }}>无快照</span>}
      </Card>

      {/* 逐规则结果 */}
      <Card title="逐规则审核结果" size="small" style={{ marginBottom: 16 }}>
        <Table
          rowKey="ruleCode" size="small" pagination={false} dataSource={rules}
          columns={[
            { title: '规则', dataIndex: 'ruleName', width: 160 },
            { title: '状态', key: 'v', width: 90, render: (_: unknown, r) => ruleVerdictTag(r.verdict) },
            { title: '实际值', dataIndex: 'actualValue', width: 120, render: (v) => v ?? '—' },
            { title: '阈值', dataIndex: 'threshold', width: 120, render: (v) => v ?? '—' },
            { title: '明细', dataIndex: 'detail', render: (v) => v ? <code>{JSON.stringify(v)}</code> : '—' },
          ]}
        />
      </Card>

      {/* 关联账号（协助核查多账号/对打/刷佣） */}
      <Row gutter={16}>
        <Col span={12}>
          <Card title={`同IP关联账号（${related.ip.length}）`} size="small">
            <Table
              rowKey={(r) => `${r.userId}-${r.ip}`} size="small" pagination={false} dataSource={related.ip}
              locale={{ emptyText: '无' }}
              columns={[
                { title: '账号', dataIndex: 'userId', render: (v: string) => <Button type="link" size="small" onClick={() => navigate(`/users/${v}`)}>{v}</Button> },
                { title: 'IP', dataIndex: 'ip', render: (v: string) => v ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/device-lookup?field=ip&value=${encodeURIComponent(v)}`)}>{v}</Button> : '-' },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title={`同设备关联账号（${related.device.length}）`} size="small">
            <Table
              rowKey={(r) => `${r.userId}-${r.deviceId}`} size="small" pagination={false} dataSource={related.device}
              locale={{ emptyText: '无' }}
              columns={[
                { title: '账号', dataIndex: 'userId', render: (v: string) => <Button type="link" size="small" onClick={() => navigate(`/users/${v}`)}>{v}</Button> },
                { title: '设备', dataIndex: 'deviceId', render: (v: string) => v ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/device-lookup?field=deviceId&value=${encodeURIComponent(v)}`)}>{v}</Button> : '-' },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal open={rejectOpen} title="拒绝原因" onOk={doReject} confirmLoading={opLoading} onCancel={() => setRejectOpen(false)}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请输入拒绝原因（将退款给用户）" />
      </Modal>
    </div>
  )
}
