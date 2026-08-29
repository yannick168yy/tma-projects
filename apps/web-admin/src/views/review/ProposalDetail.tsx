import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, Descriptions, Tag, Button, Space, Table, Modal, Input, message, Spin, Row, Col, Alert, Popconfirm, Select } from 'antd'
import {
  getReviewProposalDetail, approveWithdrawal, rejectWithdrawal, ignoreReviewProposal, rerunReview,
  type ReviewProposalDetail,
} from '../../api'
import { ruleVerdictTag, wdStatusLabel, toPhp } from './shared'
import { DEFAULT_WITHDRAW_USER_REJECT_REASON, WITHDRAW_USER_REJECT_REASON_OPTIONS } from './withdrawRejectReasons'

// 快照字段 → 中文标签 + 是否金额(元)。yuan=true 直接按元展示，不再 /100
const SNAP_LABELS: Record<string, { label: string; yuan?: boolean }> = {
  depositPhp: { label: '窗口内真实存款', yuan: true },
  deposit24hPhp: { label: '近24h存款', yuan: true },
  lifetimeDepositPhp: { label: '累计真实存款', yuan: true },
  withdrawPhp: { label: '本次取款额', yuan: true },
  lifetimeDepositCount: { label: '生涯存款笔数' },
  profitPhp: { label: '窗口内净盈利(含bonus通道)', yuan: true },
  profit24hPhp: { label: '近24h净盈利', yuan: true },
  gameBonusPhp: { label: '游戏bonus通道派彩', yuan: true },
  bonusPhp: { label: '窗口内优惠总额', yuan: true },
  completedWithdrawCount: { label: '已完成取款笔数' },
  promoTurnoverRemaining: { label: '未完成优惠流水' },
  relatedIpAccounts: { label: '同IP关联账号数' },
  relatedDeviceAccounts: { label: '同设备关联账号数' },
  relatedDeviceIdAccounts: { label: '同设备ID关联账号数' },
  relatedDeviceFpAccounts: { label: '同设备指纹关联账号数' },
  tamperOrphanRounds: { label: '凭空派彩round数' },
  commissionEarnedPhp: { label: '累计佣金收入', yuan: true },
  commissionDownlineGgrPhp: { label: '下线累计GGR', yuan: true },
  commissionDupGroups: { label: '佣金重复入账组' },
}
const yuan = (n: number) => `PHP ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 等值`

// _score_policy 影子评分写入 snapshot 的字段（弱关联信号加权，见 bff withdraw-review.service）
type ScoreSnapshot = {
  scoreShadow?: boolean
  scoreTotal?: number
  scoreThreshold?: number
  scoreHits?: { code: string; weight: number }[]
  gateManual?: boolean
  scoredVerdict?: string
  legacyVerdict?: string
  shadowWouldChange?: boolean
}

export default function ProposalDetail() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [opLoading, setOpLoading] = useState(false)
  const [data, setData] = useState<ReviewProposalDetail | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [userReason, setUserReason] = useState(DEFAULT_WITHDRAW_USER_REJECT_REASON)
  const [recommendedNote, setRecommendedNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await getReviewProposalDetail(orderId)) }
    finally { setLoading(false) }
  }, [orderId])
  useEffect(() => { void load() }, [load])

  if (loading) return <Spin />
  if (!data) return <Alert type="error" message="提案不存在" />

  const { order, user, recipientCheck, snapshot, rules, related } = data
  const hitRules = rules.filter((r) => r.verdict === 'manual' || r.verdict === 'error')
  const canOperate = order.status === 'pending'

  async function doApprove() {
    setOpLoading(true)
    try { await approveWithdrawal(orderId); message.success('已批准并出款'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }
  async function doReject() {
    // 内部原因非必填，与取款列表页(Withdrawals.tsx)和后端(reason ?? 'Rejected by admin')保持一致；
    // 用户可见原因仍必填，它会展示在用户钱包历史里(7f3b588)
    if (!userReason) { message.warning('请选择用户可见原因'); return }
    setOpLoading(true)
    try { await rejectWithdrawal(orderId, reason, userReason); message.success('已拒绝并退款'); setRejectOpen(false); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }
  // 打开驳回弹窗：按命中的规则自动预选用户可见话术（rules 已随详情加载）
  function openReject() {
    const hit = rules.find((r) => (r.verdict === 'manual' || r.verdict === 'error') && r.recommendedUserReason)
    if (hit?.recommendedUserReason) {
      setUserReason(hit.recommendedUserReason)
      setRecommendedNote(`已按命中规则「${hit.ruleName}」预选话术，可手动调整`)
    } else {
      setRecommendedNote('')
    }
    setRejectOpen(true)
  }
  async function doRerun() {
    setOpLoading(true)
    try { const r = await rerunReview(orderId); message.success(`已重跑审核（第${r.round}轮）`); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }
  async function doIgnore() {
    setOpLoading(true)
    try { await ignoreReviewProposal(orderId); message.success('已忽略，不再提醒'); await load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => navigate(-1)}>← 返回</Button>
        <h2 style={{ margin: 0 }}>提案详情 {order.orderId}</h2>
        {order.badgeIgnored && <Tag color="default">已忽略提醒</Tag>}
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

      <Card title="收款实名核查" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="KYC姓名">{recipientCheck.kycFullName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="KYC通过时间">
            {recipientCheck.kycReviewedAt ? new Date(recipientCheck.kycReviewedAt).toLocaleString('zh-CN') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="提现户名">{recipientCheck.targetOwner ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="提现账号">{recipientCheck.targetAccount ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="姓名匹配">
            {recipientCheck.nameMatched == null ? '—' : (
              <Space>
                <Tag color={recipientCheck.nameMatched ? 'green' : 'red'}>{recipientCheck.nameMatched ? '匹配' : '不匹配'}</Tag>
                <span>{recipientCheck.nameMatchReason ?? '—'}</span>
              </Space>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="提现账号复用">
            <Space wrap>
              <Tag color={recipientCheck.withdrawAccountOtherUserCount > 0 ? 'red' : 'green'}>
                {recipientCheck.withdrawAccountOtherUserCount}
              </Tag>
              {recipientCheck.withdrawAccountOtherUsers.map((id) => (
                <Button key={id} type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/users/${id}`)}>{id}</Button>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="提现户名复用">
            <Space wrap>
              <Tag color={recipientCheck.withdrawOwnerOtherUserCount > 0 ? 'orange' : 'green'}>
                {recipientCheck.withdrawOwnerOtherUserCount}
              </Tag>
              {recipientCheck.withdrawOwnerOtherUsers.map((id) => (
                <Button key={id} type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/users/${id}`)}>{id}</Button>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="同名账号" span={2}>
            <Space wrap>
              <Tag color={recipientCheck.sameNameOtherUserCount > 0 ? 'red' : 'green'}>
                {recipientCheck.sameNameOtherUserCount}
              </Tag>
              {recipientCheck.sameNameOtherUsers.map((id) => (
                <Button key={id} type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/users/${id}`)}>{id}</Button>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 操作 */}
      {canOperate && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space>
            <Popconfirm title="确认批准并出款？" onConfirm={doApprove}>
              <Button type="primary" loading={opLoading}>批准出款</Button>
            </Popconfirm>
            <Button danger loading={opLoading} onClick={openReject}>拒绝退款</Button>
            <Button loading={opLoading} onClick={doRerun}>重跑审核</Button>
            {order.reviewVerdict === 'manual' && !order.badgeIgnored && (
              <Popconfirm
                title="忽略该提款提醒？"
                description="忽略后不再计入待人工处理和菜单角标，订单仍可继续批准或拒绝。"
                onConfirm={doIgnore}
              >
                <Button loading={opLoading}>忽略提醒</Button>
              </Popconfirm>
            )}
          </Space>
        </Card>
      )}

      {/* 综合评分（影子模式·弱关联信号加权） */}
      {(() => {
        const s = snapshot as unknown as ScoreSnapshot | null
        if (!s || (s.scoreTotal == null && !s.scoreHits)) {
          return (
            <Card title="综合评分（影子）" size="small" style={{ marginBottom: 16 }}>
              <span style={{ color: '#999' }}>此单在综合评分上线前审核，无评分数据。点上方「重跑审核」可生成。</span>
            </Card>
          )
        }
        const total = Number(s.scoreTotal ?? 0)
        const thr = Number(s.scoreThreshold ?? 100)
        const over = total >= thr
        const vtag = (v?: string) => v === 'manual' ? <Tag color="orange">转人工</Tag> : v === 'pass' ? <Tag color="green">通过</Tag> : <Tag>—</Tag>
        return (
          <Card
            title={<Space>综合评分（弱关联信号加权）{s.scoreShadow ? <Tag color="blue">影子模式·仅观测不改判定</Tag> : <Tag color="green">已生效</Tag>}</Space>}
            size="small" style={{ marginBottom: 16 }}
          >
            {s.shadowWouldChange && (
              <Alert
                type="error" showIcon style={{ marginBottom: 12 }}
                message="新评分与现行判定不一致"
                description={`影子判定=${s.scoredVerdict === 'manual' ? '转人工' : '通过'}，现行=${s.legacyVerdict === 'manual' ? '转人工' : '通过'}。正式生效后此单结果会改变。`}
              />
            )}
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="总分 / 阈值">
                <b style={{ color: over ? '#fa8c16' : '#52c41a', fontSize: 16 }}>{total}</b> / {thr}
              </Descriptions.Item>
              <Descriptions.Item label="硬闸门命中">{s.gateManual ? <Tag color="red">是（直接转人工）</Tag> : <Tag color="green">否</Tag>}</Descriptions.Item>
              <Descriptions.Item label="影子判定">{vtag(s.scoredVerdict)}</Descriptions.Item>
              <Descriptions.Item label="现行判定">{vtag(s.legacyVerdict)}</Descriptions.Item>
            </Descriptions>
            <div style={{ marginBottom: 8, color: '#666' }}>命中的弱关联信号（累加权重）：</div>
            {s.scoreHits && s.scoreHits.length > 0 ? (
              <Table
                rowKey="code" size="small" pagination={false} dataSource={s.scoreHits}
                columns={[
                  { title: '信号', dataIndex: 'code', render: (c: string) => rules.find((r) => r.ruleCode === c)?.ruleName ?? c },
                  { title: '权重', dataIndex: 'weight', width: 100 },
                ]}
              />
            ) : <span style={{ color: '#999' }}>无弱关联信号命中（转人工均来自硬闸门，或本单通过）</span>}
          </Card>
        )
      })()}

      {/* 审核当时快照 */}
      <Card title="审核快照（审核当时的核查数据）" size="small" style={{ marginBottom: 16 }}>
        {snapshot ? (
          <Descriptions column={3} size="small" bordered>
            {Object.entries(SNAP_LABELS).map(([k, meta]) => (
              <Descriptions.Item key={k} label={meta.label}>
                {snapshot[k] == null ? '—' : meta.yuan ? yuan(Number(snapshot[k])) : String(snapshot[k])}
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
        <Space direction="vertical" style={{ width: '100%' }}>
          {recommendedNote && (
            <div style={{ color: '#1677ff', fontSize: 12 }}>💡 {recommendedNote}</div>
          )}
          <Select
            value={userReason}
            options={WITHDRAW_USER_REJECT_REASON_OPTIONS}
            onChange={setUserReason}
            style={{ width: '100%' }}
            placeholder="请选择用户可见原因"
          />
          <Input.TextArea
            value={reason}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="内部拒绝原因（可选，仅后台可见）"
          />
        </Space>
      </Modal>
    </div>
  )
}
