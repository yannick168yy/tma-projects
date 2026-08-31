import { useEffect, useState } from 'react'
import { Table, Select, Typography, Tag, message } from 'antd'
import { GiftOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { getPromoClaims, type PromotionClaimListRecord } from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

const { Title, Text } = Typography

const PROMO_OPTIONS = [
  { value: '', label: '全部活动' },
  { value: 'trial', label: '首席体验官' },
  { value: 'firstdep', label: '首充嘉年华' },
  { value: 'regular_redep', label: '常规复充赠金' },
  { value: 'appdl', label: 'App下载礼金' },
]

const PROMO_COLOR: Record<string, string> = {
  '首席体验官': 'gold',
  '邀请共赢': 'green',
  '首充嘉年华': 'blue',
  '常规复充赠金': 'cyan',
  'App下载礼金': 'purple',
}

const STATUS_TEXT: Record<string, { text: string; color: string }> = {
  pending: { text: '待领取', color: 'processing' },
  claimed: { text: '已领取', color: 'success' },
  expired: { text: '已过期', color: 'default' },
  cancelled: { text: '已取消', color: 'default' },
  rejected: { text: '已拒绝', color: 'error' },
}

const columns: ColumnsType<PromotionClaimListRecord> = [
  { title: '用户', dataIndex: 'userId', width: 110, render: (id, r) => (
    <span><div style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</div><div style={{ color: '#999', fontSize: 12 }}>{r.displayName}</div></span>
  ) },
  { title: '活动', dataIndex: 'promoName', width: 130, render: (name) => (
    <Tag color={PROMO_COLOR[name] ?? 'default'}>{name}</Tag>
  ) },
  { title: '达标充值', dataIndex: 'depositAmount', width: 120, render: (amt, r) => amt == null ? '-' : (
    <span>{r.currency === 'PHP' ? `₱${Number(amt).toFixed(2)}` : `${Number(amt)} ${r.currency}`}</span>
  ) },
  { title: '奖励金额', dataIndex: 'amount', width: 120, render: (amt, r) => (
    <span style={{ fontWeight: 600 }}>
      {r.currency === 'PHP' ? `₱${Number(amt).toFixed(2)}` : `${Number(amt)} ${r.currency}`}
    </span>
  ) },
  { title: '状态', dataIndex: 'status', width: 90, render: (status) => status ? (
    <Tag color={STATUS_TEXT[status]?.color}>{STATUS_TEXT[status]?.text ?? status}</Tag>
  ) : <Tag color="success">已领取</Tag> },
  { title: '领取截止', dataIndex: 'expiresAt', width: 160, render: (t) => (
    <span style={{ fontSize: 12 }}>{t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
  ) },
  { title: '领取时间', dataIndex: 'claimedAt', width: 160, render: (t) => (
    <span style={{ fontSize: 12 }}>{t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
  ) },
]

export default function PromotionClaims() {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<PromotionClaimListRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [promoId, setPromoId] = useState('')

  async function load(p = page, pid = promoId, ps = pageSize) {
    setLoading(true)
    try {
      const res = await getPromoClaims({ page: p, pageSize: ps, promoId: pid || undefined })
      setItems(res.items)
      setTotal(res.total)
      setPage(res.page)
      setPageSize(ps)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(1, promoId) }, [promoId])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <GiftOutlined style={{ fontSize: 18, color: '#faad14' }} />
        <Title level={4} style={{ margin: 0 }}>活动参与记录</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>用户领取活动奖励的历史明细</Text>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Select
          value={promoId}
          onChange={(v) => setPromoId(v)}
          options={PROMO_OPTIONS}
          style={{ width: 160 }}
        />
      </div>

      <Table<PromotionClaimListRecord>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showTotal: (t) => `共 ${t} 条`,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onChange: (p, ps) => void load(p, promoId, ps),
        }}
        size="middle"
      />
    </div>
  )
}
