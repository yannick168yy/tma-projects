import { useEffect, useState } from 'react'
import { Card, Col, Row, Segmented, Space, Spin, Table } from 'antd'
import { Link } from 'react-router-dom'
import {
  getBiFunnel, getBiLtv, getBiRetention, getBiRfm, getBiTopWinners,
  type BiFunnel, type BiLtvCohort, type BiRetentionCohort, type BiRfmCell, type BiTopWinner,
} from '../api'
import { HBarChart } from '../components/BiCharts'

const fmtMoney = (v: number) => Math.round(v).toLocaleString()
const pct = (n: number, base: number) => (base > 0 ? `${((n / base) * 100).toFixed(1)}%` : '—')

// 留存热力格：单色蓝按比例加深（顺序型编码），文字保持墨色保证可读
function RetCell({ n, size }: { n: number; size: number }) {
  const ratio = size > 0 ? n / size : 0
  return (
    <div style={{ background: `rgba(42,120,214,${Math.min(ratio * 0.85, 0.85)})`, padding: '4px 8px', borderRadius: 4, color: ratio > 0.55 ? '#fff' : '#0b0b0b' }}>
      {size > 0 ? `${(ratio * 100).toFixed(0)}%` : '—'}<span style={{ opacity: 0.65, fontSize: 11 }}> ({n})</span>
    </div>
  )
}

const TIER_LABEL: Record<string, string> = { whale: '大R (≥5万₱)', mid: '中R (≥5千₱)', small: '小R' }
const REC_LABEL: Record<string, string> = { active: '7天内有充值', cooling: '8-30天未充', churned: '30天+未充' }
const REC_COLOR: Record<string, string> = { active: '#3f8600', cooling: '#d46b08', churned: '#cf1322' }

export default function BiUsers() {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const [funnel, setFunnel] = useState<BiFunnel | null>(null)
  const [retention, setRetention] = useState<BiRetentionCohort[]>([])
  const [rfm, setRfm] = useState<{ cells: BiRfmCell[]; nonDepositors: number; totalUsers: number } | null>(null)
  const [ltv, setLtv] = useState<BiLtvCohort[]>([])
  const [winners, setWinners] = useState<BiTopWinner[]>([])

  useEffect(() => {
    getBiRetention(8).then(setRetention)
    getBiRfm(90).then(setRfm)
    getBiLtv(12).then(setLtv)
  }, [])
  useEffect(() => {
    setLoading(true)
    Promise.all([getBiFunnel({ days }), getBiTopWinners(days)])
      .then(([f, w]) => { setFunnel(f); setWinners(w) })
      .finally(() => setLoading(false))
  }, [days])

  const funnelData = funnel ? [
    { name: '注册', value: funnel.registered },
    { name: 'KYC 通过', value: funnel.kycApproved },
    { name: '首充', value: funnel.firstDep },
    { name: '复充(≥2笔)', value: funnel.redep },
  ] : []

  const retCols = [
    { title: '注册周', dataIndex: 'week' },
    { title: '人数', dataIndex: 'size' },
    ...([['d1', 'D1'], ['d3', 'D3'], ['d7', 'D7'], ['d14', 'D14'], ['d30', 'D30']] as const).map(([k, t]) => ({
      title: `${t} 留存`, dataIndex: k,
      render: (_: number, r: BiRetentionCohort) => <RetCell n={r[k]} size={r.size} />,
    })),
  ]

  const ltvCols = [
    { title: '注册周', dataIndex: 'week' },
    { title: '人数', dataIndex: 'size' },
    { title: 'D7 人均NGR(₱)', dataIndex: 'd7', render: fmtMoney },
    { title: 'D30 人均NGR(₱)', dataIndex: 'd30', render: fmtMoney },
    { title: 'D60 人均NGR(₱)', dataIndex: 'd60', render: fmtMoney },
    { title: 'D90 人均NGR(₱)', dataIndex: 'd90', render: fmtMoney },
  ]

  const winnerCols = [
    { title: '用户', dataIndex: 'displayName',
      render: (v: string, r: BiTopWinner) => <Link to={`/users/${r.userId}`}>{v || r.userId}</Link> },
    { title: '净赢(₱)', dataIndex: 'netWin',
      render: (v: number) => <span style={{ color: v > 0 ? '#cf1322' : undefined }}>{fmtMoney(v)}</span> },
    { title: '投注额(₱)', dataIndex: 'betAmount', render: fmtMoney },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>用户分析</h2>
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        漏斗/盈利榜口径随天数筛选；留存与 LTV 为固定周 cohort（留存=登录∪投注∪充值，LTV=人均累计 NGR 折算 PHP）。
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Segmented value={days} onChange={(v) => setDays(v as number)}
          options={[{ label: '近7天', value: 7 }, { label: '近30天', value: 30 }, { label: '近90天', value: 90 }]} />
      </Space>

      <Spin spinning={loading}>
        <Row gutter={16}>
          <Col xs={24} lg={10}>
            <Card bordered={false} title="转化漏斗（该期间注册用户）" size="small" style={{ marginBottom: 16 }}>
              <HBarChart data={funnelData} height={220} valueLabel=" 人" />
              {funnel && (
                <div style={{ color: '#52514e', fontSize: 12 }}>
                  注册→KYC {pct(funnel.kycApproved, funnel.registered)}；
                  KYC→首充 {pct(funnel.firstDep, funnel.kycApproved)}；
                  首充→复充 {pct(funnel.redep, funnel.firstDep)}
                </div>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card bordered={false} title="高盈利玩家 Top 20（点击进用户详情核查）" size="small" style={{ marginBottom: 16 }}>
              <Table size="small" rowKey="userId" columns={winnerCols} dataSource={winners} pagination={false} scroll={{ y: 220 }} />
            </Card>
          </Col>
        </Row>
      </Spin>

      <Card bordered={false} title="留存 Cohort（近 8 个注册周）" size="small" style={{ marginBottom: 16 }}>
        <Table size="small" rowKey="week" columns={retCols} dataSource={retention} pagination={false} scroll={{ x: 700 }} />
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="RFM 分层（近 90 天充值用户）" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={[8, 8]}>
              {(['whale', 'mid', 'small'] as const).map((tier) =>
                (['active', 'cooling', 'churned'] as const).map((rec) => {
                  const cell = rfm?.cells.find((c) => c.valueTier === tier && c.recency === rec)
                  return (
                    <Col span={8} key={`${tier}-${rec}`}>
                      <Card size="small" bodyStyle={{ padding: 8 }}>
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>{TIER_LABEL[tier]}</div>
                        <div style={{ fontSize: 11, color: REC_COLOR[rec] }}>{REC_LABEL[rec]}</div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{cell?.users ?? 0} 人</div>
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>充值 {fmtMoney(cell?.depositAmount ?? 0)} ₱</div>
                      </Card>
                    </Col>
                  )
                }))}
            </Row>
            <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 8 }}>
              未充值用户 {rfm?.nonDepositors ?? 0} / 全站 {rfm?.totalUsers ?? 0} 人
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="LTV Cohort（近 12 个注册周，人均累计 NGR）" size="small" style={{ marginBottom: 16 }}>
            <Table size="small" rowKey="week" columns={ltvCols} dataSource={ltv} pagination={false} scroll={{ x: 500, y: 300 }} />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
