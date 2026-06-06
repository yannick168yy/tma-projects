import { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Spin, Tag } from 'antd'
import { getDashboard } from '../api'

type Stats = Awaited<ReturnType<typeof getDashboard>>

export default function Dashboard() {
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    setLoading(true)
    getDashboard().then(setStats).finally(() => setLoading(false))
  }, [])

  const cards = stats ? [
    { label: '总用户数', value: stats.totalUsers },
    { label: '活跃用户', value: stats.activeUsers, color: '#3f8600' },
    { label: '冻结用户', value: stats.frozenUsers, color: '#cf1322' },
    { label: '今日存款笔数', value: stats.todayDepositCount },
    { label: '今日存款金额', value: stats.todayDepositAmount, suffix: ' PHP' },
    { label: '今日提款笔数', value: stats.todayWithdrawCount },
    { label: '今日提款金额', value: Math.round(stats.todayWithdrawAmount * 100) / 100, suffix: ' PHP' },
    { label: '待审批提款', value: stats.pendingWithdrawCount, color: stats.pendingWithdrawCount > 0 ? '#d46b08' : undefined },
    { label: '平台总余额', value: Math.round(stats.totalBalance * 100) / 100, suffix: ' PHP' },
  ] : []

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>数据概览</h2>
      <Spin spinning={loading}>
        {stats && (
          <Card bordered={false} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 600, color: '#666' }}>多币种模式（SG_MULTI_CURRENCY）</span>
              {stats.sgMultiCurrency
                ? <Tag color="green">已开启 — 按原生币种独立计算</Tag>
                : <Tag color="default">已关闭 — 统一使用 EUR（测试环境）</Tag>
              }
            </div>
          </Card>
        )}
        <Row gutter={16}>
          {cards.map((card) => (
            <Col span={6} key={card.label}>
              <Card bordered={false} style={{ marginBottom: 16 }}>
                <Statistic
                  title={card.label}
                  value={card.value}
                  suffix={card.suffix}
                  valueStyle={card.color ? { color: card.color } : undefined}
                />
              </Card>
            </Col>
          ))}
        </Row>
      </Spin>
    </div>
  )
}
