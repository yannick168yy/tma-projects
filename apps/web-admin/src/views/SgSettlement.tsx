import { useEffect, useState } from 'react'
import { Table, Button, Space, Tag, Tooltip, DatePicker, message, Card } from 'antd'
import type { TablePaginationConfig } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { getSgSettlements, triggerReconcile, markReconciled, type SgSettlementRecord } from '../api'

function fmtTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

const pageSize = 20
const yesterday = () => dayjs().subtract(1, 'day')

export default function SgSettlement() {
  const [loading, setLoading] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [items, setItems] = useState<SgSettlementRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [reconcileDate, setReconcileDate] = useState<Dayjs | null>(yesterday())
  const [markingId, setMarkingId] = useState<number | null>(null)

  async function load(p = 1) {
    setLoading(true)
    try {
      const res = await getSgSettlements({ page: p, pageSize })
      setItems(res.items); setTotal(res.total); setPage(p)
    } catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function handleReconcile() {
    if (!reconcileDate) return
    setReconciling(true)
    try {
      await triggerReconcile(reconcileDate.format('YYYY-MM-DD'))
      message.success(`${reconcileDate.format('YYYY-MM-DD')} 对账完成`)
      void load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '对账失败')
      void load()
    }
    finally { setReconciling(false) }
  }

  async function handleMark(record: SgSettlementRecord) {
    setMarkingId(record.id)
    try {
      await markReconciled(record.id)
      setItems((prev) => prev.map((r) => r.id === record.id ? { ...r, reconciled: 1 } : r))
      message.success('已标记核对')
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setMarkingId(null) }
  }

  const columns = [
    { title: '日期', key: 'reportDate', width: 110, render: (_: unknown, r: SgSettlementRecord) => <span style={{ fontWeight: 600 }}>{r.reportDate}</span> },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 70 },
    {
      title: 'SG 数据', key: 'sgAmounts', width: 200,
      render: (_: unknown, r: SgSettlementRecord) => (
        <div style={{ lineHeight: 1.6 }}>
          <div>投注: <b>{Number(r.sgBetAmount).toFixed(2)} {r.currency}</b></div>
          <div>派彩: <b>{Number(r.sgWinAmount).toFixed(2)} {r.currency}</b></div>
          <div>GGR: <b style={{ color: r.sgGgr >= 0 ? '#3f8600' : '#cf1322' }}>{Number(r.sgGgr).toFixed(2)} {r.currency}</b></div>
        </div>
      ),
    },
    {
      title: '本地数据（PHP）', key: 'localAmounts', width: 200,
      render: (_: unknown, r: SgSettlementRecord) => (
        <div style={{ lineHeight: 1.6 }}>
          <div>投注: <b>₱{Number(r.localBet).toFixed(2)}</b></div>
          <div>派彩: <b>₱{Number(r.localWin).toFixed(2)}</b></div>
          <div>GGR: <b style={{ color: r.localBet >= r.localWin ? '#3f8600' : '#cf1322' }}>₱{(r.localBet - r.localWin).toFixed(2)}</b></div>
        </div>
      ),
    },
    { title: '局数', dataIndex: 'sgRoundCount', key: 'sgRoundCount', width: 80 },
    {
      title: '核对结果', key: 'discrepancy', width: 90,
      render: (_: unknown, r: SgSettlementRecord) => !r.discrepancyNote
        ? <Tag color="green">一致</Tag>
        : <Tooltip title={r.discrepancyNote}><Tag color="red">有差异</Tag></Tooltip>,
    },
    {
      title: '核对状态', key: 'reconciled', width: 120,
      render: (_: unknown, r: SgSettlementRecord) => r.reconciled
        ? <Tag color="green">已核对</Tag>
        : <Button size="small" loading={markingId === r.id} onClick={() => handleMark(r)}>标记已核对</Button>,
    },
    { title: '拉取时间', key: 'fetchedAt', width: 150, render: (_: unknown, r: SgSettlementRecord) => <span style={{ fontSize: 11, color: '#888' }}>{fmtTime(r.fetchedAt)}</span> },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total,
    showSizeChanger: false,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => load(p),
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>SG 结算对账</h2>
      </div>
      <Card size="small" title="手动对账" style={{ marginBottom: 16 }}>
        <Space wrap>
          <DatePicker value={reconcileDate} format="YYYY-MM-DD" placeholder="选择日期" onChange={setReconcileDate} />
          <Button type="primary" loading={reconciling} disabled={!reconcileDate} onClick={handleReconcile}>手动触发对账</Button>
        </Space>
      </Card>
      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={pagination}
        size="small"
        locale={{ emptyText: '暂无对账记录，请选择日期后手动触发对账' }}
      />
    </div>
  )
}
