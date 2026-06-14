import { Card, Descriptions, Tag, Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { AdminKycSummary } from '../../api'

function kycStatusTag(status: string) {
  const map: Record<string, { color: string; label: string }> = {
    none: { color: 'default', label: '未开始' },
    pending: { color: 'processing', label: '进行中' },
    approved: { color: 'success', label: '已通过' },
    rejected: { color: 'error', label: '已拒绝' },
  }
  const item = map[status] ?? { color: 'default', label: status }
  return <Tag color={item.color}>{item.label}</Tag>
}

function docTypeLabel(t: string | null) {
  const map: Record<string, string> = {
    passport: '护照',
    drivers_license: '驾驶证',
    philid: 'PhilID',
    umid: 'UMID',
  }
  return t ? (map[t] ?? t) : '—'
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('zh-CN')
}

interface Props {
  userId: string
  kyc: AdminKycSummary | null
}

export default function UserKyc({ userId, kyc }: Props) {
  const navigate = useNavigate()

  if (!kyc || kyc.status === 'none') {
    return (
      <Card title="实名认证" bordered={false} style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="状态"><Tag>未实名</Tag></Descriptions.Item>
        </Descriptions>
      </Card>
    )
  }

  return (
    <Card title="实名认证" bordered={false} style={{ marginBottom: 16 }}>
      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="状态">{kycStatusTag(kyc.status)}</Descriptions.Item>
        <Descriptions.Item label="手机验证">{kyc.phoneVerified ? '已完成' : '未完成'}</Descriptions.Item>
        <Descriptions.Item label="证件验证">{kyc.docVerified ? '已通过' : '未完成'}</Descriptions.Item>
        <Descriptions.Item label="人脸验证">{kyc.faceVerified ? '已通过' : '未完成'}</Descriptions.Item>
        <Descriptions.Item label="手机">{kyc.phone ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="姓名">{kyc.fullName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="证件类型">{docTypeLabel(kyc.docType)}</Descriptions.Item>
        <Descriptions.Item label="认证时间">{fmtDate(kyc.reviewedAt ?? kyc.faceSubmittedAt ?? kyc.docSubmittedAt)}</Descriptions.Item>
        {kyc.rejectReason && (
          <Descriptions.Item label="拒绝原因" span={2}>{kyc.rejectReason}{kyc.rejectStep ? `（步骤：${kyc.rejectStep}）` : ''}</Descriptions.Item>
        )}
      </Descriptions>
      <Button type="link" style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => navigate(`/kyc/${userId}`)}>
        查看完整 KYC 记录
      </Button>
    </Card>
  )
}
