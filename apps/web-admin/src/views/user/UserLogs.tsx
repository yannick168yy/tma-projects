import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Tabs, Table, Spin, Alert, Typography, Modal, Descriptions, InputNumber, Input, Space, Button, Progress, Tag, message } from 'antd'
import {
  getUserTurnover, adjustTurnoverRequirement,
  getUserLedgerPage, getUserLoginLogsPage, getUserBetOrdersPage, getUserPromoClaimsPage,
  type TurnoverRequirement, type PagedResult,
} from '../../api'

// 服务端分页数据加载：active 首次为 true 时加载第一页，翻页/改页大小时重新请求
function usePaged<T>(fetcher: (page: number, pageSize: number) => Promise<PagedResult<T>>, active: boolean) {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async (p: number, ps: number) => {
    setLoading(true)
    try {
      const r = await fetcher(p, ps)
      setItems(r.items); setTotal(r.total); setPage(p); setPageSize(ps); setLoaded(true)
    } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }, [fetcher])

  useEffect(() => { if (active && !loaded) void load(1, 20) }, [active, loaded, load])

  const pagination = {
    current: page, pageSize, total,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100],
    showTotal: (t: number) => `共 ${t} 条`,
    onChange: (p: number, ps: number) => { void load(ps !== pageSize ? 1 : p, ps) },
  }
  return { items, total, loading, pagination }
}

function ledgerTypeColor(t: string) {
  return ({ deposit: 'green', admin_adjust: 'blue', withdraw: 'orange', bet: 'purple', bonus: 'cyan', red_packet: 'magenta' } as Record<string, string>)[t] ?? 'default'
}
function ledgerTypeText(t: string) {
  return ({ deposit: '存款', withdraw: '取款', bet: '投注', win: '中奖', bonus: '奖励', red_packet: '红包', adjust: '调整', admin_adjust: '后台调整' } as Record<string, string>)[t] ?? t
}
function sourceLabel(req: TurnoverRequirement) {
  if (req.sourceType === 'deposit') return `存款 ${req.sourceRef}`
  const names: Record<string, string> = { trial: '首席体验官', referral: '邀请共赢', firstdep: '首充嘉年华' }
  return names[req.sourceRef] ?? req.sourceRef
}
function reqStatusTag(s: string) {
  const map: Record<string, { color: string; text: string }> = {
    pending: { color: 'processing', text: '进行中' },
    completed: { color: 'success', text: '已完成' },
    expired: { color: 'warning', text: '已过期' },
    cancelled: { color: 'default', text: '已取消' },
  }
  const d = map[s] ?? { color: 'default', text: s }
  return <Tag color={d.color}>{d.text}</Tag>
}

interface Props { userId: string }

export default function UserLogs({ userId }: Props) {
  const navigate = useNavigate()
  const lookup = (field: 'ip' | 'deviceId' | 'fpVisitor', v: string | null) =>
    v ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/device-lookup?field=${field}&value=${encodeURIComponent(v)}`)}>{v}</Button> : '-'
  const [activeTab, setActiveTab] = useState('ledger')
  const ledger = usePaged(useCallback((p: number, ps: number) => getUserLedgerPage(userId, { page: p, pageSize: ps }), [userId]), activeTab === 'ledger')
  const logins = usePaged(useCallback((p: number, ps: number) => getUserLoginLogsPage(userId, { page: p, pageSize: ps }), [userId]), activeTab === 'login')
  const bets = usePaged(useCallback((p: number, ps: number) => getUserBetOrdersPage(userId, { page: p, pageSize: ps }), [userId]), activeTab === 'bets')
  const promos = usePaged(useCallback((p: number, ps: number) => getUserPromoClaimsPage(userId, { page: p, pageSize: ps }), [userId]), activeTab === 'promo')
  const [turnover, setTurnover] = useState<Awaited<ReturnType<typeof getUserTurnover>> | null>(null)
  const [turnoverLoading, setTurnoverLoading] = useState(false)
  const [adjustModal, setAdjustModal] = useState<{ req: TurnoverRequirement } | null>(null)
  const [adjustValue, setAdjustValue] = useState(0)
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustLoading, setAdjustLoading] = useState(false)

  async function loadTurnover() {
    setTurnoverLoading(true)
    try { setTurnover(await getUserTurnover(userId)) }
    finally { setTurnoverLoading(false) }
  }

  async function doAdjustTurnover(action: 'adjust' | 'cancel') {
    if (!adjustModal) return
    setAdjustLoading(true)
    try {
      await adjustTurnoverRequirement(userId, adjustModal.req.id, action, action === 'adjust' ? adjustValue : undefined, adjustReason || undefined)
      message.success(action === 'cancel' ? '要求已取消' : '流水已调整')
      setAdjustModal(null); setAdjustValue(0); setAdjustReason('')
      await loadTurnover()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setAdjustLoading(false) }
  }

  const ledgerCols = [
    { title: '类型', dataIndex: 'type', key: 'type', width: 110, render: (t: string) => <Tag color={ledgerTypeColor(t)}>{ledgerTypeText(t)}</Tag> },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 110 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, render: (v: number) => <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f' }}>{v > 0 ? '+' : ''}{v}</span> },
    { title: '余额', dataIndex: 'balanceAfter', key: 'balanceAfter', width: 120 },
    { title: '描述', dataIndex: 'description', key: 'desc' },
    { title: '时间', dataIndex: 'createdAt', key: 'at', width: 160, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]
  const loginCols = [
    { title: '登录方式', dataIndex: 'authMethod', key: 'method', width: 90 },
    { title: '登录网址/TMA', dataIndex: 'entrySource', key: 'entrySource', width: 130, render: (v: string | null) => v || '-' },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 120, render: (v: string | null) => lookup('ip', v) },
    { title: '区域', dataIndex: 'region', key: 'region', width: 130, render: (v: string | null) => v || '-' },
    { title: '设备ID', dataIndex: 'deviceId', key: 'deviceId', width: 140, ellipsis: true, render: (v: string | null) => lookup('deviceId', v) },
    { title: '指纹', dataIndex: 'fpVisitor', key: 'fpVisitor', width: 140, ellipsis: true, render: (v: string | null) => lookup('fpVisitor', v) },
    { title: 'User-Agent', dataIndex: 'userAgent', key: 'ua', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', key: 'at', width: 160, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]
  const betCols = [
    { title: '类型', dataIndex: 'betType', key: 'type', width: 80 },
    { title: '币种', dataIndex: 'currencyCode', key: 'currency', width: 100 },
    { title: '金额', dataIndex: 'amount', key: 'amt', width: 100 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80 },
    { title: 'Round ID', dataIndex: 'roundId', key: 'round', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', key: 'at', width: 160, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]
  const promoCols = [
    { title: '优惠名称', dataIndex: 'promoName', key: 'name', width: 140 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, render: (v: number) => <span style={{ color: '#52c41a' }}>+{v}</span> },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 100 },
    { title: '描述', dataIndex: 'description', key: 'desc', ellipsis: true },
    { title: '领取时间', dataIndex: 'claimedAt', key: 'at', width: 160, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]
  const turnoverCols = [
    { title: '来源', key: 'source', render: (_: unknown, r: TurnoverRequirement) => sourceLabel(r) },
    { title: '要求金额', dataIndex: 'requiredAmount', key: 'req', width: 110, render: (v: number) => v.toFixed(4) },
    {
      title: '进度', key: 'progress', width: 200,
      render: (_: unknown, r: TurnoverRequirement) => {
        const pct = r.requiredAmount > 0 ? Math.min(100, (r.completedAmount / r.requiredAmount) * 100) : 100
        return (
          <div>
            <Progress percent={Math.round(pct)} size="small" status={r.status === 'completed' ? 'success' : r.status === 'expired' ? 'exception' : 'active'} />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.completedAmount.toFixed(4)} / {r.requiredAmount.toFixed(4)}</Typography.Text>
          </div>
        )
      },
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (s: string) => reqStatusTag(s) },
    { title: '到期时间', dataIndex: 'expiresAt', key: 'expires', width: 155, render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '永久' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'created', width: 155, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'action', width: 80,
      render: (_: unknown, r: TurnoverRequirement) =>
        r.status !== 'expired' && r.status !== 'cancelled'
          ? <Button size="small" onClick={() => { setAdjustModal({ req: r }); setAdjustValue(r.completedAmount) }}>调整</Button>
          : null,
    },
  ]

  return (
    <Card bordered={false} style={{ marginBottom: 16 }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => { setActiveTab(key); if (key === 'turnover' && !turnover) void loadTurnover() }}
        items={[
          { key: 'ledger', label: `账变记录${ledger.total ? ` (${ledger.total})` : ''}`, children: <Table columns={ledgerCols} dataSource={ledger.items as object[]} rowKey="id" loading={ledger.loading} pagination={ledger.pagination} size="small" /> },
          { key: 'login', label: `登录记录${logins.total ? ` (${logins.total})` : ''}`, children: <Table columns={loginCols} dataSource={logins.items} rowKey="id" loading={logins.loading} pagination={logins.pagination} size="small" /> },
          { key: 'bets', label: `游戏记录${bets.total ? ` (${bets.total})` : ''}`, children: <Table columns={betCols} dataSource={bets.items} rowKey="id" loading={bets.loading} pagination={bets.pagination} size="small" /> },
          { key: 'promo', label: `优惠领取记录${promos.total ? ` (${promos.total})` : ''}`, children: <Table columns={promoCols} dataSource={promos.items} rowKey="id" loading={promos.loading} pagination={promos.pagination} size="small" /> },
          {
            key: 'turnover', label: '流水记录',
            children: (
              <Spin spinning={turnoverLoading}>
                {turnover && (
                  <div>
                    <Alert
                      style={{ marginBottom: 12 }}
                      type={turnover.canWithdraw ? 'success' : 'warning'}
                      message={turnover.canWithdraw ? '流水要求已全部完成，可提款' : `流水未完成，还需完成 ${turnover.totalRemaining.toFixed(4)}`}
                      showIcon
                    />
                    <Table columns={turnoverCols} dataSource={turnover.requirements} rowKey="id" pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} size="small" />
                  </div>
                )}
                {!turnover && !turnoverLoading && <Typography.Text type="secondary">点击「流水记录」Tab 加载数据</Typography.Text>}
              </Spin>
            ),
          },
        ]}
      />
      <Modal open={!!adjustModal} title="调整流水要求" onCancel={() => setAdjustModal(null)} footer={null} destroyOnClose>
        {adjustModal && (
          <div>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="来源">{sourceLabel(adjustModal.req)}</Descriptions.Item>
              <Descriptions.Item label="要求金额">{adjustModal.req.requiredAmount.toFixed(4)}</Descriptions.Item>
              <Descriptions.Item label="当前已完成">{adjustModal.req.completedAmount.toFixed(4)}</Descriptions.Item>
              <Descriptions.Item label="状态">{reqStatusTag(adjustModal.req.status)}</Descriptions.Item>
            </Descriptions>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 6, fontWeight: 500 }}>修改已完成金额</div>
                <InputNumber value={adjustValue} onChange={(v) => setAdjustValue(v ?? 0)} min={0} max={adjustModal.req.requiredAmount} precision={4} step={1} style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ marginBottom: 6, fontWeight: 500 }}>操作原因</div>
                <Input.TextArea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} rows={2} placeholder="填写原因（可选，会记入审计日志）" />
              </div>
              <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                <Button danger loading={adjustLoading} onClick={() => doAdjustTurnover('cancel')}>取消该要求</Button>
                <Button type="primary" loading={adjustLoading} onClick={() => doAdjustTurnover('adjust')}>确认调整</Button>
              </Space>
            </Space>
          </div>
        )}
      </Modal>
    </Card>
  )
}
