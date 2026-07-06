import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Row, Col, Statistic, Table, Tag, Alert, Spin } from 'antd'
import { getReviewOverview, type ReviewOverview } from '../../api'

export default function Overview() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ReviewOverview | null>(null)

  useEffect(() => {
    getReviewOverview().then(setData).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spin />

  return (
    <div>
      <h2>审核总览</h2>

      {data && data.overdue > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message={`有 ${data.overdue} 笔转人工提案待处理超过 6 小时，请及时处理`}
          action={<a onClick={() => navigate('/review/manual')}>去处理</a>}
        />
      )}

      <Row gutter={16} style={{ marginBottom: 16 }} className="responsive-cols">
        <Col span={6}><Card><Statistic title="近7天自动通过率" value={data?.autoApproveRate ?? 0} suffix="%" valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}>
          <Card hoverable onClick={() => navigate('/review/manual')}>
            <Statistic title="待人工处理" value={data?.manualBacklog ?? 0} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col span={6}><Card><Statistic title="处理超时(>6h)" value={data?.overdue ?? 0} valueStyle={{ color: data?.overdue ? '#cf1322' : undefined }} /></Card></Col>
        <Col span={6}><Card><Statistic title="近7天已审核" value={data?.totalReviewed7d ?? 0} /></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="近7天规则命中 TOP" size="small">
            <Table
              rowKey="ruleCode" size="small" pagination={false}
              dataSource={data?.topHits ?? []}
              locale={{ emptyText: '近7天无命中' }}
              columns={[
                { title: '规则', dataIndex: 'name' },
                { title: '命中次数', dataIndex: 'count', width: 120, render: (v: number) => <Tag color="orange">{v}</Tag> },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="近7天审核趋势" size="small">
            <Table
              rowKey="date" size="small" pagination={false}
              dataSource={data?.trend ?? []}
              locale={{ emptyText: '暂无数据' }}
              columns={[
                { title: '日期', dataIndex: 'date' },
                { title: '自动通过', dataIndex: 'pass', render: (v: number) => <Tag color="green">{v}</Tag> },
                { title: '转人工', dataIndex: 'manual', render: (v: number) => <Tag color="orange">{v}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
