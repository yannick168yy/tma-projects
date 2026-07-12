import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Tag, Select, Button, Space, Switch, Card, InputNumber, message, Grid } from 'antd'
import { getKycList, getKycSettings, setKycSettings, type AdminKycListItem, type KycStepSettings } from '../api'
import { MobileCardList } from '../components/MobileCardList'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

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
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AdminKycListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
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
      const res = await getKycList({ page, pageSize, status })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, status])

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
              onChange={(v) => void saveCfg({ requireDocument: v, requireFace: v && (cfg?.requireFace ?? true), faceMatchThreshold: cfg?.faceMatchThreshold ?? 0.75 })}
            />
          </Space>
          <Space>
            <span>人脸验证</span>
            <Switch
              checked={cfg?.requireFace ?? true}
              loading={savingCfg}
              disabled={!cfg || !cfg.requireDocument}
              onChange={(v) => void saveCfg({ requireDocument: cfg?.requireDocument ?? true, requireFace: v, faceMatchThreshold: cfg?.faceMatchThreshold ?? 0.75 })}
            />
          </Space>
          <Space>
            <span>人脸通过相似度阈值</span>
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              value={cfg?.faceMatchThreshold ?? 0.75}
              disabled={!cfg || !cfg.requireFace}
              onChange={(v) => { if (cfg && typeof v === 'number') void saveCfg({ ...cfg, faceMatchThreshold: v }) }}
            />
            <span style={{ color: '#999', fontSize: 12 }}>0~1，自拍与证件照相似度达到此值才通过</span>
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
      {isMobile ? (
        <MobileCardList
          items={items} loading={loading} page={page} total={total} pageSize={pageSize} onPage={setPage}
          renderItem={(r) => {
            const ts = r.faceSubmittedAt ?? r.docSubmittedAt ?? r.submittedAt
            return (
              <Card key={r.userId} size="small" style={{ marginBottom: 10 }}
                title={<Space>{r.displayName || r.userId} {kycStatusTag(r.status)}</Space>}
              >
                <div style={{ color: '#999', fontSize: 12 }}>
                  ID {r.userId}{r.fullName ? ` · ${r.fullName}` : ''}{r.phone ? ` · ${r.phone}` : ''}
                </div>
                <div style={{ marginTop: 6 }}>
                  <Space size={4}>
                    <Tag color={r.phoneVerified ? 'green' : 'default'}>手机</Tag>
                    <Tag color={r.docVerified ? 'green' : 'default'}>证件</Tag>
                    <Tag color={r.faceVerified ? 'green' : 'default'}>人脸</Tag>
                  </Space>
                </div>
                <div style={{ marginTop: 6, color: '#999', fontSize: 12 }}>
                  {ts ? new Date(ts).toLocaleString('zh-CN') : '—'}
                </div>
                <Button block size="large" style={{ marginTop: 12 }} onClick={() => navigate(`/kyc/${r.userId}`)}>查看详情</Button>
              </Card>
            )
          }}
        />
      ) : (
        <Table
          rowKey="userId"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={{ current: page, total, pageSize, pageSizeOptions: PAGE_SIZE_OPTIONS, onChange: (p, ps) => { setPage(p); setPageSize(ps) } }}
        />
      )}
    </div>
  )
}
