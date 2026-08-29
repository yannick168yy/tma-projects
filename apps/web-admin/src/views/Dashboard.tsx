import { useEffect, useState } from 'react'
import { Badge, Card, Col, Row, Space, Spin, Table, Tag, Tooltip } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { getHomeDashboard, type HomeDashboard } from '../api'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()

function ago(isoTime: string | null): { text: string; stale: boolean } {
  if (!isoTime) return { text: '无记录', stale: true }
  const mins = Math.floor((Date.now() - new Date(isoTime).getTime()) / 60000)
  if (mins < 1) return { text: '刚刚', stale: false }
  if (mins < 60) return { text: `${mins} 分钟前`, stale: mins > 30 }
  if (mins < 24 * 60) return { text: `${Math.floor(mins / 60)} 小时前`, stale: true }
  return { text: `${Math.floor(mins / 1440)} 天前`, stale: true }
}

function Delta({ cur, base }: { cur: number; base: number }) {
  if (!base) return <span style={{ color: '#999', fontSize: 12 }}>较昨日 —</span>
  const pct = ((cur - base) / Math.abs(base)) * 100
  const color = pct >= 0 ? '#3f8600' : '#cf1322'
  return <span style={{ color, fontSize: 12 }}>较昨日 {pct >= 0 ? '↑' : '↓'}{Math.abs(pct).toFixed(1)}%</span>
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<HomeDashboard | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getHomeDashboard().then(setData).finally(() => setLoading(false))
    const timer = setInterval(() => getHomeDashboard().then(setData), 60_000)
    return () => clearInterval(timer)
  }, [])

  const todos = data ? [
    { label: '待人工审核提现', count: data.todos.manualWithdrawals, to: '/review/manual' },
    { label: 'KYC 拒件待处理', count: data.todos.rejectedKyc, to: '/kyc' },
    { label: '客服转人工', count: data.todos.csConversations, to: '/customer-service' },
    { label: '数据异常告警', count: data.todos.openAlerts, to: '/bi/providers' },
  ] : []

  const snapshot = data ? [
    { label: '今日 GGR（PHP等值）', cur: Math.round(data.today.ggr), base: Math.round(data.yesterdaySameTime.ggr) },
    { label: '今日充值（PHP等值）', cur: Math.round(data.today.depositAmount), base: Math.round(data.yesterdaySameTime.depositAmount) },
    { label: '今日提现（PHP等值）', cur: Math.round(data.today.withdrawAmount), base: Math.round(data.yesterdaySameTime.withdrawAmount) },
    { label: 'DAU', cur: data.today.dau, base: data.yesterdaySameTime.dau },
    { label: '新增注册', cur: data.today.newUsers, base: data.yesterdaySameTime.newUsers },
    { label: '首充人数', cur: data.today.firstDepUsers, base: data.yesterdaySameTime.firstDepUsers },
  ] : []

  const hb = data?.heartbeat
  const heartbeatItems = hb ? [
    { label: '最近一笔注单', ...ago(hb.lastBetAt), hint: '长时间无注单=568win 回调或游戏链路可能断了' },
    { label: '最近一笔充值', ...ago(hb.lastDepositAt), hint: '长时间无充值需关注支付通道' },
    { label: '最近一次登录', ...ago(hb.lastLoginAt), hint: '' },
  ] : []

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginBottom: 4 }}>数据看板</h2>
        <Link to="/bi/dashboard" style={{ fontSize: 12 }}>看趋势与分析 → 运营驾驶舱</Link>
      </div>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        当前网站状态与待办事项，每分钟自动刷新。金额均折算 PHP。
      </div>

      <Spin spinning={loading && !data}>
        {/* 待办中心 */}
        <Row gutter={16}>
          {todos.map((t) => (
            <Col xs={12} md={6} key={t.label}>
              <Card bordered={false} size="small" hoverable style={{ marginBottom: 16 }}
                onClick={() => navigate(t.to)}>
                <Space>
                  <Badge count={t.count} showZero color={t.count > 0 ? '#cf1322' : '#d9d9d9'} overflowCount={999} />
                  <span style={{ color: t.count > 0 ? '#0b0b0b' : '#8c8c8c' }}>{t.label}</span>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>

        {/* 今日快照 */}
        <Row gutter={16}>
          {snapshot.map((s) => (
            <Col xs={12} md={4} key={s.label}>
              <Card bordered={false} size="small" style={{ marginBottom: 16 }}>
                <div style={{ color: '#8c8c8c', fontSize: 13 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 600, margin: '2px 0' }}>{s.cur.toLocaleString()}</div>
                <Delta cur={s.cur} base={s.base} />
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={16}>
          {/* 资金状态 */}
          <Col xs={24} lg={12}>
            <Card bordered={false} size="small" title="资金状态" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8 }}>
                玩家钱包总余额 <b style={{ fontSize: 18 }}>PHP {fmtMoney(data?.balances.walletTotalPhp ?? 0)} 等值</b>
                <Space size={4} style={{ marginLeft: 8 }} wrap>
                  {(data?.balances.wallets ?? []).map((w) => (
                    <Tag key={w.currency}>{w.currency} {fmtMoney(w.amount)}</Tag>
                  ))}
                </Space>
              </div>
              <div style={{ marginBottom: 12 }}>
                待付提现 <b>{data?.balances.pendingWithdrawCount ?? 0} 笔 / PHP {fmtMoney(data?.balances.pendingWithdrawPhp ?? 0)} 等值</b>
                <Link to="/withdrawals" style={{ marginLeft: 8, fontSize: 12 }}>去处理</Link>
              </div>
              <Table size="small" rowKey="provider" pagination={false}
                dataSource={data?.balances.providers ?? []}
                columns={[
                  { title: '支付服务商账户', dataIndex: 'provider' },
                  { title: '余额', dataIndex: 'balance', render: (v: number, r) => `${fmtMoney(v)} ${r.currency}` },
                  { title: '状态', dataIndex: 'status',
                    render: (v: string) => v.startsWith('ok') || v === 'success'
                      ? <Tag color="green">正常</Tag>
                      : <Tooltip title={v}><Tag color="red">{v.slice(0, 12) || '未知'}</Tag></Tooltip> },
                  { title: '更新于', dataIndex: 'updatedAt', render: (v: string | null) => ago(v).text },
                ]} />
            </Card>
          </Col>

          {/* 系统心跳 */}
          <Col xs={24} lg={12}>
            <Card bordered={false} size="small" title="系统心跳" style={{ marginBottom: 16 }}>
              <Row gutter={8}>
                {heartbeatItems.map((h) => (
                  <Col span={8} key={h.label}>
                    <Tooltip title={h.hint}>
                      <Card size="small" bodyStyle={{ padding: 8 }}>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>{h.label}</div>
                        <div style={{ fontWeight: 600, color: h.stale ? '#cf1322' : '#3f8600' }}>{h.text}</div>
                      </Card>
                    </Tooltip>
                  </Col>
                ))}
              </Row>
              <div style={{ margin: '12px 0 4px', color: '#8c8c8c', fontSize: 12 }}>今日支付通道</div>
              {(hb?.channelsToday?.length ?? 0) === 0 && <span style={{ color: '#999' }}>今日暂无终态订单</span>}
              <Space wrap>
                {(hb?.channelsToday ?? []).map((c) => {
                  const rate = c.total > 0 ? c.success / c.total : 0
                  return (
                    <Tag key={`${c.direction}:${c.channel}`} color={rate >= 0.8 ? 'green' : 'red'}
                      style={{ cursor: 'pointer' }} onClick={() => navigate('/bi/channels')}>
                      {c.direction === 'deposit' ? '充' : '提'}·{c.channel} {(rate * 100).toFixed(0)}% ({c.success}/{c.total})
                    </Tag>
                  )
                })}
              </Space>
              <div style={{ marginTop: 16, color: '#8c8c8c', fontSize: 12 }}>用户结构</div>
              <Space size={16} style={{ marginTop: 4 }}>
                <span>总用户 <b>{data?.users.total ?? 0}</b></span>
                <span style={{ color: '#3f8600' }}>活跃 <b>{data?.users.active ?? 0}</b></span>
                <span style={{ color: '#cf1322' }}>冻结 <b>{data?.users.frozen ?? 0}</b></span>
              </Space>
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  )
}
