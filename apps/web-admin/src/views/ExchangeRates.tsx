import { useEffect, useState, useRef } from 'react'
import { Table, Button, Space, Tag, Modal, Form, InputNumber, Alert, Collapse, message } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import {
  getExchangeRates, getRateHistory, refreshExchangeRates,
  setManualRate, clearManualRate,
  type ExchangeRate, type RateHistoryBatch,
} from '../api'

function fmtRate(r: number | string | null | undefined): string {
  if (r === null || r === undefined) return '—'
  const n = typeof r === 'string' ? parseFloat(r) : r
  return isNaN(n) ? '—' : n.toFixed(4)
}

function sourceLabel(s: string | null) {
  if (!s) return '未知'
  if (s === 'manual') return '手动'
  if (s === 'env-fallback') return '环境变量兜底'
  if (s === 'freecurrencyapi' || s === 'exchangerate-api') return 'FreeCurrency'
  if (s === 'coingecko') return 'CoinGecko'
  if (s === 'identity') return '同币种'
  return s
}

function sourceColor(s: string | null) {
  if (s === 'manual') return 'orange'
  if (s === 'freecurrencyapi' || s === 'exchangerate-api') return 'green'
  if (s === 'coingecko') return 'blue'
  if (s === 'env-fallback') return 'gold'
  return 'default'
}

function fmtTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

export default function ExchangeRates() {
  const [rates, setRates] = useState<ExchangeRate[]>([])
  const [history, setHistory] = useState<RateHistoryBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [histLoading, setHistLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const [editInfo, setEditInfo] = useState({ from: '', to: '' })
  const [form] = Form.useForm<{ rate: number }>()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void loadRates(); void loadHistory()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  async function loadRates() {
    setLoading(true)
    try { setRates(await getExchangeRates()) }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }

  async function loadHistory() {
    setHistLoading(true)
    try { setHistory(await getRateHistory()) }
    catch (e) { message.error(e instanceof Error ? e.message : '加载历史失败') }
    finally { setHistLoading(false) }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      setRates(await refreshExchangeRates())
      message.success('已从 API 刷新（手动覆盖的汇率未变动）')
      void loadHistory()
      setCooldown(10)
      timerRef.current = setInterval(() => {
        setCooldown(c => {
          if (c <= 1) { clearInterval(timerRef.current!); timerRef.current = null; return 0 }
          return c - 1
        })
      }, 1000)
    } catch (e) { message.error(e instanceof Error ? e.message : '刷新失败') }
    finally { setRefreshing(false) }
  }

  function openEdit(record: ExchangeRate) {
    setEditInfo({ from: record.from, to: record.to })
    form.setFieldsValue({ rate: record.rate ?? 0 })
    setEditOpen(true)
  }

  async function handleSaveManual() {
    const { rate } = form.getFieldsValue()
    if (!rate || rate <= 0) { message.warning('请输入有效汇率'); return }
    setSaving(true)
    try {
      await setManualRate(editInfo.from, editInfo.to, rate)
      message.success(`${editInfo.from}→${editInfo.to} 汇率已设为 ${rate}，7 天内不自动刷新`)
      setEditOpen(false)
      await loadRates()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  async function handleClearManual(record: ExchangeRate) {
    try {
      await clearManualRate(record.from, record.to)
      message.success(`${record.from}→${record.to} 已恢复 API 自动汇率`)
      await loadRates()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
  }

  const rateColumns = [
    { title: '货币对', key: 'pair', render: (_: unknown, r: ExchangeRate) => `${r.from} → ${r.to}` },
    {
      title: '当前汇率（= PHP）', key: 'rate',
      render: (_: unknown, r: ExchangeRate) => r.rate !== null
        ? <span style={{ fontSize: 15, fontWeight: 600 }}>{fmtRate(r.rate)}</span>
        : <Tag color="red">未配置</Tag>,
    },
    { title: '来源', key: 'source', render: (_: unknown, r: ExchangeRate) => <Tag color={sourceColor(r.source)}>{sourceLabel(r.source)}</Tag> },
    { title: '更新时间', key: 'fetchedAt', render: (_: unknown, r: ExchangeRate) => <span style={{ color: '#888', fontSize: 12 }}>{r.fetchedAt ? fmtTime(r.fetchedAt) : '—'}</span> },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: ExchangeRate) => (
        <Space>
          <Button size="small" type="primary" ghost onClick={() => openEdit(r)}>修改</Button>
          {r.source === 'manual' && <Button size="small" danger onClick={() => handleClearManual(r)}>恢复自动</Button>}
        </Space>
      ),
    },
  ]

  const historyColumns = [
    { title: '时间', key: 'fetchedAt', render: (_: unknown, r: RateHistoryBatch) => <span style={{ color: '#888', fontSize: 12 }}>{fmtTime(r.fetchedAt)}</span> },
    { title: 'EUR→PHP', key: 'EUR', render: (_: unknown, r: RateHistoryBatch) => <span style={{ fontSize: 12 }}>{fmtRate(r.rates?.EUR)}</span> },
    { title: 'USD→PHP', key: 'USD', render: (_: unknown, r: RateHistoryBatch) => <span style={{ fontSize: 12 }}>{fmtRate(r.rates?.USD)}</span> },
    { title: 'USDT→PHP', key: 'USDT', render: (_: unknown, r: RateHistoryBatch) => <span style={{ fontSize: 12 }}>{fmtRate(r.rates?.USDT)}</span> },
    { title: 'TON→PHP', key: 'TON', render: (_: unknown, r: RateHistoryBatch) => <span style={{ fontSize: 12 }}>{fmtRate(r.rates?.TON)}</span> },
    {
      title: '来源', key: 'hsource',
      render: (_: unknown, r: RateHistoryBatch) => (r.source || '').split(',').map((s) => (
        <Tag key={s} color={sourceColor(s)} style={{ fontSize: 11, marginBottom: 2 }}>{sourceLabel(s)}</Tag>
      )),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>汇率管理</h2>
        <Button loading={refreshing} disabled={cooldown > 0} onClick={handleRefresh} icon={<SyncOutlined />}>
          {cooldown > 0 ? `${cooldown}s 后可刷新` : '从 API 刷新'}
        </Button>
      </div>

      <Table dataSource={rates} columns={rateColumns} rowKey="from" loading={loading} pagination={false} style={{ marginBottom: 24 }} />

      <Collapse items={[{
        key: 'history',
        label: '汇率历史记录（最近 1000 条，按批次合并）',
        children: <Table dataSource={history} columns={historyColumns} rowKey="id" loading={histLoading} size="small" pagination={{ pageSize: 20, showSizeChanger: false }} />,
      }]} />

      <Modal
        open={editOpen}
        title={`设置汇率：${editInfo.from} → ${editInfo.to}`}
        onOk={handleSaveManual}
        confirmLoading={saving}
        onCancel={() => setEditOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label={`1 ${editInfo.from} = ? PHP`} name="rate">
            <InputNumber min={0.0001} step={0.01} precision={4} style={{ width: '100%' }} placeholder="例如：62.5000" />
          </Form.Item>
          <Alert type="info" showIcon message={'手动汇率有效期 7 天，期间不会被 API 自动覆盖。到期或点击"恢复自动"后恢复 API 汇率。'} />
        </Form>
      </Modal>
    </div>
  )
}
