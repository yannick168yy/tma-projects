import { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Space, Select, Divider, Typography, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  updateUserKycOverride,
  type AdminKycSummary,
  type KycOverrideMode,
  type KycUserConfig,
} from '../../api'

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

function overrideToMode(v: boolean | null): KycOverrideMode {
  if (v === true) return 'on'
  if (v === false) return 'off'
  return 'inherit'
}

const OVERRIDE_OPTIONS: { value: KycOverrideMode; label: string }[] = [
  { value: 'inherit', label: '跟随系统' },
  { value: 'on', label: '开启' },
  { value: 'off', label: '关闭' },
]

interface Props {
  userId: string
  kyc: AdminKycSummary | null
  kycConfig: KycUserConfig
  onSuccess: () => void
}

export default function UserKyc({ userId, kyc, kycConfig, onSuccess }: Props) {
  const navigate = useNavigate()
  const [docMode, setDocMode] = useState<KycOverrideMode>(() => overrideToMode(kycConfig.docOverride))
  const [faceMode, setFaceMode] = useState<KycOverrideMode>(() => overrideToMode(kycConfig.faceOverride))
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDocMode(overrideToMode(kycConfig.docOverride)) }, [kycConfig.docOverride])
  useEffect(() => { setFaceMode(overrideToMode(kycConfig.faceOverride)) }, [kycConfig.faceOverride])

  const dirty =
    docMode !== overrideToMode(kycConfig.docOverride) ||
    faceMode !== overrideToMode(kycConfig.faceOverride)

  async function saveOverride() {
    setSaving(true)
    try {
      await updateUserKycOverride(userId, docMode, faceMode)
      message.success('校验设置已保存')
      onSuccess()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="实名认证" bordered={false} style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 12, fontWeight: 500 }}>校验设置</div>
      <Space wrap size={24} style={{ marginBottom: 8 }}>
        <Space>
          <span>证件校验</span>
          <Select
            value={docMode}
            style={{ width: 120 }}
            options={OVERRIDE_OPTIONS}
            onChange={setDocMode}
          />
        </Space>
        <Space>
          <span>人脸校验</span>
          <Select
            value={faceMode}
            style={{ width: 120 }}
            options={OVERRIDE_OPTIONS}
            onChange={setFaceMode}
          />
        </Space>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void saveOverride()}>
          保存
        </Button>
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
        系统默认：证件 {kycConfig.system.requireDocument ? '开' : '关'}，人脸 {kycConfig.system.requireFace ? '开' : '关'}
        {' · '}
        该用户生效：证件 {kycConfig.effective.requireDocument ? '开' : '关'}，人脸 {kycConfig.effective.requireFace ? '开' : '关'}
      </Typography.Text>

      <Divider style={{ margin: '12px 0' }} />

      {!kyc || kyc.status === 'none' ? (
        <Descriptions column={1} size="small">
          <Descriptions.Item label="状态"><Tag>未实名</Tag></Descriptions.Item>
        </Descriptions>
      ) : (
        <>
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
              <Descriptions.Item label="拒绝原因" span={2}>
                {kyc.rejectReason}{kyc.rejectStep ? `（步骤：${kyc.rejectStep}）` : ''}
              </Descriptions.Item>
            )}
          </Descriptions>
          <Button type="link" style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => navigate(`/kyc/${userId}`)}>
            查看完整 KYC 记录
          </Button>
        </>
      )}
    </Card>
  )
}
