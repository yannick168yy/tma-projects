import { useEffect, useState } from 'react'
import {
  Card, Button, message, Typography, Spin, Table, Tag, Space, Input,
  InputNumber, Tabs, Popconfirm, Select,
} from 'antd'
import { ThunderboltOutlined, CrownOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  getVipBenefits, saveVipBenefits, triggerVipNegativeRebate, getVipRecords,
  type VipBenefitItem, type VipRewardRecord,
} from '../api'

const { Title, Text } = Typography

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  promotion:       { label: '晋级礼金', color: 'gold' },
  negative_rebate: { label: '负盈利返水', color: 'red' },
  weekly:          { label: '周俸', color: 'blue' },
  monthly:         { label: '月俸', color: 'purple' },
  birthday:        { label: '生日礼金', color: 'magenta' },
}

function EditableNumber({ value, onChange, step = 1, precision = 2, min = 0 }: {
  value: number; onChange: (v: number) => void; step?: number; precision?: number; min?: number
}) {
  return (
    <InputNumber
      size="small" min={min} step={step} precision={precision} value={value}
      onChange={(v) => onChange(Number(v ?? 0))} style={{ width: 110 }}
    />
  )
}

export default function Vip() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [benefits, setBenefits] = useState<VipBenefitItem[]>([])

  const [settleLoading, setSettleLoading] = useState(false)

  const [records, setRecords] = useState<VipRewardRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsType, setRecordsType] = useState<string | undefined>()
  const [recordsUser, setRecordsUser] = useState('')

  async function loadBenefits() {
    setLoading(true)
    try {
      const res = await getVipBenefits()
      setBenefits(res.benefits)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }

  async function loadRecords(page = 1) {
    setRecordsLoading(true)
    try {
      const res = await getVipRecords({ page, pageSize: 50, type: recordsType, userId: recordsUser || undefined })
      setRecords(res.items)
      setRecordsTotal(res.total)
      setRecordsPage(page)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setRecordsLoading(false) }
  }

  useEffect(() => { loadBenefits() }, [])

  function patchLevel(level: number, field: keyof VipBenefitItem, value: number) {
    setBenefits((prev) => prev.map((b) => (b.level === level ? { ...b, [field]: value } : b)))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveVipBenefits(benefits)
      message.success('已保存')
      await loadBenefits()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  async function handleSettle(includeCurrentWeek: boolean) {
    setSettleLoading(true)
    try {
      const res = await triggerVipNegativeRebate(includeCurrentWeek)
      message.success(`结算完成 [${res.periodKey}]：${res.users} 人 / 合计 ${res.totalAmount}`)
      if (recordsType === undefined || recordsType === 'negative_rebate') loadRecords(1)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '结算失败')
    } finally { setSettleLoading(false) }
  }

  const benefitColumns: ColumnsType<VipBenefitItem> = [
    { title: '等级', dataIndex: 'level', width: 70, render: (v: number) => <Tag color="gold"><CrownOutlined /> VIP{v}</Tag> },
    { title: '晋级礼金', dataIndex: 'promotionBonus', render: (v, r) => <EditableNumber value={v} onChange={(x) => patchLevel(r.level, 'promotionBonus', x)} /> },
    { title: '周俸', dataIndex: 'weeklySalary', render: (v, r) => <EditableNumber value={v} onChange={(x) => patchLevel(r.level, 'weeklySalary', x)} /> },
    { title: '月俸', dataIndex: 'monthlySalary', render: (v, r) => <EditableNumber value={v} onChange={(x) => patchLevel(r.level, 'monthlySalary', x)} /> },
    { title: '负盈利返水 %', dataIndex: 'negativeRebatePct', render: (v, r) => <EditableNumber value={v} step={0.1} precision={3} onChange={(x) => patchLevel(r.level, 'negativeRebatePct', x)} /> },
    { title: '保级线（季度流水）', dataIndex: 'retentionLine', render: (v, r) => <EditableNumber value={v} step={100} onChange={(x) => patchLevel(r.level, 'retentionLine', x)} /> },
  ]

  const recordColumns: ColumnsType<VipRewardRecord> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '用户', dataIndex: 'userId', render: (v, r) => <span>{r.displayName || v}<br /><Text type="secondary" style={{ fontSize: 11 }}>{v}</Text></span> },
    { title: '等级', dataIndex: 'level', width: 70, render: (v: number) => <Tag>VIP{v}</Tag> },
    { title: '类型', dataIndex: 'type', width: 110, render: (v: string) => { const t = TYPE_LABELS[v]; return <Tag color={t?.color}>{t?.label ?? v}</Tag> } },
    { title: '金额', dataIndex: 'amount', render: (v, r) => <b>{v} {r.currencyCode}</b> },
    { title: '周期', dataIndex: 'periodKey', width: 110 },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={v === 'paid' ? 'green' : 'orange'}>{v === 'paid' ? '已领取' : '待领取'}</Tag> },
    { title: '发放时间', dataIndex: 'createdAt', width: 160 },
    { title: '领取时间', dataIndex: 'paidAt', width: 160 },
  ]

  return (
    <div>
      <Title level={3}><CrownOutlined /> VIP 成长体系</Title>
      <Text type="secondary">等级复用洗码 VIP1–9（累计有效流水判级）。此处配置各级权益数值，保存即生效。</Text>
      <Tabs
        defaultActiveKey="benefits"
        onChange={(k) => { if (k === 'records') loadRecords(1) }}
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'benefits',
            label: '权益配置',
            children: (
              <Card>
                {loading ? <Spin /> : (
                  <>
                    <Space style={{ marginBottom: 12 }}>
                      <Button type="primary" loading={saving} onClick={handleSave}>保存权益配置</Button>
                      <Popconfirm
                        title="结算上一整周的负盈利返水？"
                        description="按各用户上周净输 × 本级返水率写入待领取，幂等可重复执行。"
                        onConfirm={() => handleSettle(false)}
                      >
                        <Button icon={<ThunderboltOutlined />} loading={settleLoading}>手动结算·上一周</Button>
                      </Popconfirm>
                      <Popconfirm
                        title="结算本周至今的负盈利返水？（测试用）"
                        onConfirm={() => handleSettle(true)}
                      >
                        <Button icon={<ThunderboltOutlined />} loading={settleLoading}>手动结算·本周至今</Button>
                      </Popconfirm>
                    </Space>
                    <Table
                      rowKey="level" size="small" pagination={false}
                      columns={benefitColumns} dataSource={benefits}
                    />
                    <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
                      金额单位与钱包一致。周俸 / 月俸 / 保级线为二期启用项，可先预置数值。
                    </Text>
                  </>
                )}
              </Card>
            ),
          },
          {
            key: 'records',
            label: '发放记录',
            children: (
              <Card>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Select
                    allowClear placeholder="类型" style={{ width: 140 }} value={recordsType}
                    onChange={(v) => setRecordsType(v)}
                    options={Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
                  />
                  <Input
                    placeholder="用户ID" style={{ width: 180 }} value={recordsUser}
                    onChange={(e) => setRecordsUser(e.target.value)} allowClear
                  />
                  <Button onClick={() => loadRecords(1)}>查询</Button>
                </Space>
                <Table
                  rowKey="id" size="small" loading={recordsLoading}
                  columns={recordColumns} dataSource={records}
                  pagination={{
                    current: recordsPage, total: recordsTotal, pageSize: 50, showSizeChanger: false,
                    onChange: (p) => loadRecords(p),
                  }}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}
