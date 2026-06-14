import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Tag, Select, Button, Space, Switch, Card, message } from 'antd'
import { getKycList, getKycSettings, setKycSettings, type AdminKycListItem, type KycStepSettings } from '../api'

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

export default function KycList() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AdminKycListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string | undefined>()
  const [cfg, setCfg] = useState<KycStepSettings | null>(null)
  const [savingCfg, setSavingCfg] = useState(false)

  useEffect(() => { void getKycSettings().then(setCfg).catch(() => {}) }, [])

  async function saveCfg(next: KycStepSettings) {
    setSavingCfg(true)
    try {
      const saved = await setKycSettings(next)
      setCfg(saved)
      message.success('已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingCfg(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getKycList({ page, pageSize: 20, status })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => { void load() }, [load])

  const columns = [
    { title: '用户 ID', dataIndex: 'userId', key: 'userId', width: 120 },
    { title: '昵称', dataIndex: 'displayName', key: 'displayName', render: (v: string | null) => v ?? '—' },
    { title: '姓名', dataIndex: 'fullName', key: 'fullName', render: (v: string | null) => v ?? '—' },
    { title: '手机', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v ?? '—' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => kycStatusTag(v) },
    {
      title: '进度',
      key: 'progress',
      render: (_: unknown, r: AdminKycListItem) => (
        <Space size={4}>
          <Tag color={r.phoneVerified ? 'green' : 'default'}>手机</Tag>
          <Tag color={r.docVerified ? 'green' : 'default'}>证件</Tag>
          <Tag color={r.faceVerified ? 'green' : 'default'}>人脸</Tag>
        </Space>
      ),
    },
    {
      title: '提交时间',
      dataIndex: 'faceSubmittedAt',
      key: 'submitted',
      render: (_: unknown, r: AdminKycListItem) => {
        const ts = r.faceSubmittedAt ?? r.docSubmittedAt ?? r.submittedAt
        return ts ? new Date(ts).toLocaleString('zh-CN') : '—'
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, r: AdminKycListItem) => (
        <Button type="link" size="small" onClick={() => navigate(`/kyc/${r.userId}`)}>查看详情</Button>
      ),
    },
  ]

  return (
    <div>
      <Card size="small" title="验证流程设置" style={{ marginBottom: 16 }}>
        <Space size={32} wrap>
          <Space>
            <span>证件验证</span>
            <Switch
              checked={cfg?.requireDocument ?? true}
              loading={savingCfg}
              disabled={!cfg}
              onChange={(v) => void saveCfg({ requireDocument: v, requireFace: v && (cfg?.requireFace ?? true) })}
            />
          </Space>
          <Space>
            <span>人脸验证</span>
            <Switch
              checked={cfg?.requireFace ?? true}
              loading={savingCfg}
              disabled={!cfg || !cfg.requireDocument}
              onChange={(v) => void saveCfg({ requireDocument: cfg?.requireDocument ?? true, requireFace: v })}
            />
          </Space>
          <span style={{ color: '#999', fontSize: 12 }}>关闭证件验证将一并关闭人脸验证（人脸需证件照比对）。手机验证始终开启。</span>
        </Space>
      </Card>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>实名认证</span>
        <Select
          allowClear
          placeholder="筛选状态"
          style={{ width: 140 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1) }}
          options={[
            { value: 'pending', label: '进行中' },
            { value: 'approved', label: '已通过' },
            { value: 'rejected', label: '已拒绝' },
          ]}
        />
      </div>
      <Table
        rowKey="userId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
      />
    </div>
  )
}
