import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, Descriptions, Tag, Button, Space, Spin, Alert, Image, Collapse } from 'antd'
import { fetchKycImageBlob, getKycDetail, type AdminKycDetail } from '../api'

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

const ACTION_LABEL: Record<string, string> = {
  neutral: '正视',
  blink: '眨眼',
  mouth: '张嘴',
}

export default function KycDetail() {
  const { userId = '' } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AdminKycDetail | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const detail = await getKycDetail(userId)
      setData(detail)
      const urls: Record<string, string> = {}
      const keys: { key: string; label: string }[] = []
      if (detail.kyc.docImageKey) keys.push({ key: detail.kyc.docImageKey, label: '证件照' })
      for (const frame of detail.kyc.livenessFrames ?? []) {
        keys.push({ key: frame.key, label: ACTION_LABEL[frame.action] ?? frame.action })
      }
      await Promise.all(keys.map(async ({ key, label }) => {
        try {
          urls[label + key] = await fetchKycImageBlob(userId, key)
        } catch { /* skip missing files */ }
      }))
      setImageUrls(urls)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
    return () => {
      Object.values(imageUrls).forEach((u) => URL.revokeObjectURL(u))
    }
  }, [load])

  if (loading) return <Spin />
  if (!data) return <Alert type="error" message="KYC 记录不存在" />

  const { kyc, user } = data

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={() => navigate(-1)}>← 返回</Button>
        <h2 style={{ margin: 0 }}>KYC 详情 — {user?.displayName || userId}</h2>
        {user && (
          <Button type="link" onClick={() => navigate(`/users/${userId}`)}>用户详情</Button>
        )}
      </Space>

      <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="用户 ID">{userId}</Descriptions.Item>
          <Descriptions.Item label="状态">{kycStatusTag(kyc.status)}</Descriptions.Item>
          <Descriptions.Item label="手机">{kyc.phone ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="姓名">{kyc.fullName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="证件类型">{kyc.docType ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="证件号">{kyc.extractedIdNo ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Gemini 置信度">{kyc.geminiConfidence ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="认证时间">
            {kyc.reviewedAt ? new Date(kyc.reviewedAt).toLocaleString('zh-CN') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="手机验证">{kyc.phoneVerified ? '是' : '否'}</Descriptions.Item>
          <Descriptions.Item label="证件验证">{kyc.docVerified ? '是' : '否'}</Descriptions.Item>
          <Descriptions.Item label="人脸验证">{kyc.faceVerified ? '是' : '否'}</Descriptions.Item>
          <Descriptions.Item label="证件提交">
            {kyc.docSubmittedAt ? new Date(kyc.docSubmittedAt).toLocaleString('zh-CN') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="人脸提交" span={2}>
            {kyc.faceSubmittedAt ? new Date(kyc.faceSubmittedAt).toLocaleString('zh-CN') : '—'}
          </Descriptions.Item>
          {kyc.rejectReason && (
            <Descriptions.Item label="拒绝原因" span={2}>
              {kyc.rejectReason}{kyc.rejectStep ? `（${kyc.rejectStep}）` : ''}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card title="影像资料" size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={16}>
          {kyc.docImageKey && imageUrls[`证件照${kyc.docImageKey}`] && (
            <div>
              <p style={{ marginBottom: 4, fontSize: 12 }}>证件照</p>
              <Image width={200} src={imageUrls[`证件照${kyc.docImageKey}`]} />
            </div>
          )}
          {(kyc.livenessFrames ?? []).map((frame) => {
            const label = ACTION_LABEL[frame.action] ?? frame.action
            const url = imageUrls[label + frame.key]
            if (!url) return null
            return (
              <div key={frame.key}>
                <p style={{ marginBottom: 4, fontSize: 12 }}>{label}</p>
                <Image width={160} src={url} />
              </div>
            )
          })}
          {!kyc.docImageKey && !(kyc.livenessFrames?.length) && <span style={{ color: '#999' }}>暂无影像</span>}
        </Space>
      </Card>

      {kyc.geminiResult && (
        <Collapse
          items={[{
            key: 'gemini',
            label: 'Gemini 判定结果（原始 JSON）',
            children: (
              <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 400 }}>
                {JSON.stringify(kyc.geminiResult, null, 2)}
              </pre>
            ),
          }]}
        />
      )}
    </div>
  )
}
