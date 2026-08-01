import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Row, Col, Button, Spin } from 'antd'
import { getUserDetail } from '../api'
import UserInfo from './user/UserInfo'
import UserActions from './user/UserActions'
import UserGrowth from './user/UserGrowth'
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
              <UserGrowth growth={detail.growth ?? []} />
            </Col>
            <Col span={24}>
              <UserKyc
                userId={id!}
                kyc={detail.kyc ?? null}
                kycConfig={detail.kycConfig}
                onSuccess={loadDetail}
              />
            </Col>
            <Col span={24}><UserLogs userId={id!} /></Col>
          </Row>
        )}
      </Spin>
    </div>
  )
}
