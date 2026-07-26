import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Row, Col, Button, Spin, Card, Descriptions, Tag } from 'antd'
import { getUserDetail, type UserAttribution } from '../api'
import UserInfo from './user/UserInfo'
import UserActions from './user/UserActions'
import UserLogs from './user/UserLogs'
import UserKyc from './user/UserKyc'

type Detail = Awaited<ReturnType<typeof getUserDetail>>

export default function UserDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)

  async function loadDetail() {
    if (!id) return
    setLoading(true)
    try { setDetail(await getUserDetail(id)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadDetail() }, [id])

  const u = detail?.user as Record<string, unknown> | undefined

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={() => navigate(-1)}>返回</Button>
        <span style={{ fontWeight: 600, fontSize: 16 }}>用户详情</span>
      </div>
      <Spin spinning={loading}>
        {detail && (
          <Row gutter={16}>
            <Col span={12}><UserInfo detail={detail} onSuccess={loadDetail} /></Col>
            <Col span={12}>
              <UserActions
                userId={id!}
                currentStatus={String(u?.status ?? 'active')}
                currentLabel={String(u?.label ?? 'normal')}
                onSuccess={loadDetail}
              />
            </Col>
            <Col span={24}>
              <UserKyc
                userId={id!}
                kyc={detail.kyc ?? null}
                kycConfig={detail.kycConfig}
                onSuccess={loadDetail}
              />
            </Col>
            <Col span={24}><AttributionCard attr={detail.attribution ?? null} /></Col>
            <Col span={24}><UserLogs userId={id!} /></Col>
          </Row>
        )}
      </Spin>
    </div>
  )
}

function AttributionCard({ attr }: { attr: UserAttribution | null }) {
  if (!attr) {
    return <Card size="small" title="投放归因"><span style={{ color: '#999' }}>自然量 / 无买量归因记录</span></Card>
  }
  const platColor = attr.clickPlatform === 'facebook' ? 'blue' : attr.clickPlatform === 'tiktok' ? 'magenta' : 'default'
  return (
    <Card size="small" title="投放归因（对账时核这条线）">
      <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered contentStyle={{ wordBreak: 'break-all' }}>
        <Descriptions.Item label="投放渠道">{attr.channelCode ? <Tag color="geekblue">{attr.channelCode}</Tag> : '—'}</Descriptions.Item>
        <Descriptions.Item label="平台"><Tag color={platColor}>{attr.clickPlatform}</Tag></Descriptions.Item>
        <Descriptions.Item label="落地时间">{new Date(attr.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
        <Descriptions.Item label="落地域名">{attr.landingHost ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="落地路径">{attr.landingPath ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="注册 IP">{attr.clientIp ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="utm_source">{attr.utmSource ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="utm_campaign">{attr.utmCampaign ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="点击 ID（fbclid/ttclid）">{attr.clickId ?? '—'}</Descriptions.Item>
      </Descriptions>
    </Card>
  )
}
