import { useEffect, useState } from 'react'
import { Button, Card, Popconfirm, Space, Spin, Table, Tag, message } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { getBiChurnRisk, grantChurnRedepOffer, type BiChurnUser } from '../api'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()

export default function BiChurn() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<BiChurnUser[]>([])
  const [granting, setGranting] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    getBiChurnRisk().then(setRows).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const grant = async (userId: string) => {
    setGranting(userId)
    try {
      const r = await grantChurnRedepOffer(userId)
      if (r.ok) message.success(`已开窗：充值满 ${r.minDeposit} 送 ${r.bonusAmount}（用户下次进站可见）`)
      else message.warning(r.reason ?? '未能开窗')
    } finally {
      setGranting(null)
    }
  }

  const scoreColor = (s: number) => (s >= 75 ? 'red' : s >= 50 ? 'orange' : 'gold')

  const columns = [
    { title: '用户', dataIndex: 'displayName',
      render: (v: string, r: BiChurnUser) => <Link to={`/users/${r.userId}`}>{v || r.userId}</Link> },
    { title: '90天充值（PHP等值）', dataIndex: 'deposit90d', render: fmtMoney,
      sorter: (a: BiChurnUser, b: BiChurnUser) => a.deposit90d - b.deposit90d },
    { title: '最近活跃', dataIndex: 'lastActive' },
    { title: '已静默', dataIndex: 'idleDays', render: (v: number) => `${v} 天`,
      sorter: (a: BiChurnUser, b: BiChurnUser) => a.idleDays - b.idleDays },
    { title: '个人节奏', dataIndex: 'cadenceDays', render: (v: number) => `每 ${v} 天活跃一次` },
    { title: '流失风险', dataIndex: 'score',
      render: (v: number) => <Tag color={scoreColor(v)}>{v} 分</Tag>,
      sorter: (a: BiChurnUser, b: BiChurnUser) => a.score - b.score },
    { title: '挽回动作', key: 'actions',
      render: (_: unknown, r: BiChurnUser) => (
        <Popconfirm title={`给 ${r.displayName || r.userId} 定向开一个复充优惠窗口？`} onConfirm={() => grant(r.userId)}>
          <Button size="small" type="primary" loading={granting === r.userId}>发复充优惠</Button>
        </Popconfirm>
      ) },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>流失挽回</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        入选规则：近 60 天有 ≥3 个活跃日，且当前静默时长超过本人平均活跃间隔的 2 倍（至少 3 天）。按 90 天充值额排序——优先挽回高价值用户。
        「发复充优惠」按当前活动配置直接给该用户开限时窗口（绕过冷却），操作记入审计日志。
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Button onClick={load}>刷新名单</Button>
        <Button onClick={() => navigate('/tg-broadcast')}>去 TG 群发（触达全量用户）</Button>
        <Button onClick={() => navigate('/promotions')}>调整复充优惠参数</Button>
      </Space>

      <Spin spinning={loading}>
        <Card bordered={false} size="small" title={`风险名单（${rows.length} 人）`}>
          <Table size="small" rowKey="userId" columns={columns} dataSource={rows}
            pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 800 }} />
        </Card>
      </Spin>
    </div>
  )
}
