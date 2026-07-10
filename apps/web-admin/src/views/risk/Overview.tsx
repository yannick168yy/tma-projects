import { useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, Table, Tag, Alert, message } from 'antd'
import { getRiskOverview, type RiskOverview } from '../../api'
import { actionTag, tagLabel } from './shared'

export default function RiskOverviewPage() {
  const [data, setData] = useState<RiskOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRiskOverview()
      .then(setData)
      .catch((e) => message.error(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const shadowHits = data?.hits24h.filter((h) => h.action === 'tag_only').reduce((s, h) => s + h.count, 0) ?? 0
  const blockedHits = data?.hits24h.filter((h) => h.action !== 'tag_only').reduce((s, h) => s + h.count, 0) ?? 0
  const autoTags = data?.tags.filter((t) => t.source === 'auto').reduce((s, t) => s + t.count, 0) ?? 0
  const manualTags = data?.tags.filter((t) => t.source === 'manual').reduce((s, t) => s + t.count, 0) ?? 0

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="风控负责「看见」，审核负责「处置」"
        description="行为规则默认处于影子模式（tag_only）：只打标、不干预。请先用命中日志复核误报率，确认某条规则可靠后，再到「规则与策略」逐条改为 deny / escalate。"
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card loading={loading}><Statistic title="已建档用户" value={data?.profiledUsers ?? 0} /></Card></Col>
        <Col span={6}><Card loading={loading}><Statistic title="高风险用户（≥50分）" value={data?.highRiskUsers ?? 0} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card loading={loading}><Statistic title="近24h 影子命中" value={shadowHits} suffix="未拦截" /></Card></Col>
        <Col span={6}><Card loading={loading}><Statistic title="近24h 实际拦截" value={blockedHits} valueStyle={{ color: blockedHits ? '#cf1322' : undefined }} /></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title={`标签分布（自动 ${autoTags} / 人工 ${manualTags}）`} loading={loading} size="small">
            <Table
              size="small"
              rowKey={(r) => `${r.tagCode}:${r.source}`}
              pagination={false}
              dataSource={data?.tags ?? []}
              locale={{ emptyText: '暂无标签' }}
              columns={[
                { title: '标签', dataIndex: 'tagCode', render: (c: string) => tagLabel(c, data?.tagMeta) },
                { title: '来源', dataIndex: 'source', render: (s: string) => <Tag color={s === 'manual' ? 'blue' : 'default'}>{s === 'manual' ? '人工' : '自动'}</Tag> },
                { title: '用户数', dataIndex: 'count' },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="近 24h 命中分布" loading={loading} size="small">
            <Table
              size="small"
              rowKey={(r) => `${r.checkpoint}:${r.action}`}
              pagination={false}
              dataSource={data?.hits24h ?? []}
              locale={{ emptyText: '近 24h 无命中' }}
              columns={[
                { title: '管控点', dataIndex: 'checkpoint' },
                { title: '动作', dataIndex: 'action', render: actionTag },
                { title: '次数', dataIndex: 'count' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
