import { useEffect, useState } from 'react'
import { Table, Space, Button, Tag, message, Modal, Select, Alert, Input, Descriptions, Statistic, Row, Col } from 'antd'
import { getWxgameReconDiffs, resolveWxgameReconDiff, type WxgameReconDiff } from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

const TYPE_META: Record<string, { label: string; color: string; hint: string }> = {
  missing_local: { label: '掉单', color: 'red', hint: '上游有这一局、我方没有。玩家已经输赢完毕但我方账上没记，是最要紧的一类' },
  amount_mismatch: { label: '金额不符', color: 'orange', hint: '双方都有这一局但金额对不上' },
  missing_upstream: { label: '上游缺失', color: 'volcano', hint: '我方有、上游没有' },
  status_mismatch: { label: '状态不符', color: 'gold', hint: '注单状态与上游不一致' },
}

function money(v: number | null) {
  return v == null ? <span style={{ color: '#bbb' }}>—</span> : v.toFixed(2)
}
function fmtTime(t: string | null) {
  if (!t) return <span style={{ color: '#bbb' }}>—</span>
  return <span style={{ fontSize: 12, color: '#888' }}>{new Date(t).toLocaleString('zh-CN', { hour12: false })}</span>
}

export default function WxgameRecon() {
  const [rows, setRows] = useState<WxgameReconDiff[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [resolved, setResolved] = useState('0')
  const [type, setType] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<{ lastRunAt: string | null; lastScanned: number | null; lastError: string | null }>({ lastRunAt: null, lastScanned: null, lastError: null })
  const [target, setTarget] = useState<WxgameReconDiff | null>(null)
  const [note, setNote] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const r = await getWxgameReconDiffs({ resolved, type, page, pageSize })
      setRows(r.items); setTotal(r.total)
      setMeta({ lastRunAt: r.lastRunAt, lastScanned: r.lastScanned, lastError: r.lastError })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [page, pageSize, resolved, type])

  const doResolve = async () => {
    if (!target) return
    if (!note.trim()) { message.warning('请填写处理说明'); return }
    try {
      await resolveWxgameReconDiff(target.id, note.trim())
      message.success('已标记处理')
      setTarget(null); setNote(''); void load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert
        type="info" showIcon
        message="对账每 30 分钟自动跑一轮，拉取 WXGame 的注单与我方逐局比对"
        description="这里只做展示和标记，不提供自动补账 —— 金额对不上时以谁为准需要人工判断，自动补账在对账逻辑本身有问题时会放大损失。确认后请手工调账并在此标记处理说明。"
      />
      {meta.lastError && <Alert type="error" showIcon message={`上轮对账报错：${meta.lastError}`} />}

      <Row gutter={16}>
        <Col><Statistic title="待处理差异" value={resolved === '0' ? total : '—'} valueStyle={{ color: total > 0 && resolved === '0' ? '#cf1322' : undefined }} /></Col>
        <Col><Statistic title="上轮扫描条数" value={meta.lastScanned ?? '—'} /></Col>
        <Col><Statistic title="上轮运行时间" valueRender={() => fmtTime(meta.lastRunAt)} value={0} /></Col>
      </Row>

      <Space wrap>
        <Select value={resolved} onChange={(v) => { setResolved(v); setPage(1) }} style={{ width: 140 }}
          options={[{ value: '0', label: '待处理' }, { value: '1', label: '已处理' }]} />
        <Select value={type} onChange={(v) => { setType(v); setPage(1) }} allowClear placeholder="差异类型" style={{ width: 160 }}
          options={Object.entries(TYPE_META).map(([k, v]) => ({ value: k, label: v.label }))} />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <Table<WxgameReconDiff>
        rowKey="id" dataSource={rows} loading={loading} size="small"
        pagination={{
          current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
          onChange: (p, ps) => { setPage(p); setPageSize(ps) },
        }}
        columns={[
          {
            title: '类型', dataIndex: 'diffType',
            render: (v: string) => {
              const m = TYPE_META[v]
              return <Tag color={m?.color ?? 'default'} title={m?.hint}>{m?.label ?? v}</Tag>
            },
          },
          { title: '局号', dataIndex: 'roundId', render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
          { title: '玩家', dataIndex: 'userId', render: (v: string | null, r) => v ?? r.playerId ?? '—' },
          { title: '上游投注', key: 'ub', render: (_, r) => money(r.upstream.bet) },
          { title: '上游派彩', key: 'uw', render: (_, r) => money(r.upstream.win) },
          { title: '我方投注', key: 'lb', render: (_, r) => money(r.local.bet) },
          { title: '我方派彩', key: 'lw', render: (_, r) => money(r.local.win) },
          { title: '上游状态', key: 'us', render: (_, r) => r.upstream.status ?? '—' },
          { title: '发现时间', dataIndex: 'createdAt', render: fmtTime },
          {
            title: '操作', key: 'act',
            render: (_, r) => r.resolvedAt
              ? <span style={{ fontSize: 12, color: '#888' }} title={r.resolvedNote ?? ''}>已处理</span>
              : <Button size="small" onClick={() => setTarget(r)}>标记处理</Button>,
          },
        ]}
      />

      <Modal title="标记为已处理" open={target != null} onCancel={() => { setTarget(null); setNote('') }} onOk={doResolve}>
        {target && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="局号">{target.roundId}</Descriptions.Item>
              <Descriptions.Item label="上游交易号">{target.transactionId ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="上游 投注 / 派彩">{money(target.upstream.bet)} / {money(target.upstream.win)}</Descriptions.Item>
              <Descriptions.Item label="我方 投注 / 派彩">{money(target.local.bet)} / {money(target.local.win)}</Descriptions.Item>
            </Descriptions>
            <Input.TextArea rows={3} placeholder="处理说明，例如：已手工补记该局并调整余额 / 确认为上游重复记录，无需处理"
              value={note} onChange={(e) => setNote(e.target.value)} />
          </Space>
        )}
      </Modal>
    </Space>
  )
}
