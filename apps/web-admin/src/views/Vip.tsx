import { useEffect, useState } from 'react'
import {
  Card, Button, message, Typography, Spin, Table, Tag, Space, Input,
  InputNumber, Popconfirm, Select,
} from 'antd'
import { ThunderboltOutlined, CrownOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  getVipBenefits, saveVipBenefits, triggerVipNegativeRebate, getVipRecords,
  triggerVipWeeklySalary, triggerVipMonthlySalary, triggerVipBirthday, triggerVipRetention,
  type VipBenefitItem, type VipRewardRecord,
} from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

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

export default function Vip({ section = 'benefits' }: { section?: 'benefits' | 'records' }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [benefits, setBenefits] = useState<VipBenefitItem[]>([])

  const [settleLoading, setSettleLoading] = useState(false)

  const [records, setRecords] = useState<VipRewardRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsPageSize, setRecordsPageSize] = useState(DEFAULT_PAGE_SIZE)
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

  async function loadRecords(page = 1, ps = recordsPageSize) {
    setRecordsLoading(true)
    try {
      const res = await getVipRecords({ page, pageSize: ps, type: recordsType, userId: recordsUser || undefined })
      setRecords(res.items)
      setRecordsTotal(res.total)
      setRecordsPage(page)
      setRecordsPageSize(ps)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setRecordsLoading(false) }
  }

  useEffect(() => {
    if (section === 'records') loadRecords(1)
    else loadBenefits()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

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
      message.success(`负盈利返水 [${res.periodKey}]：${res.users} 人 / 合计 ${res.totalAmount}`)
      if (recordsType === undefined || recordsType === 'negative_rebate') loadRecords(1)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '结算失败')
    } finally { setSettleLoading(false) }
  }

  async function runTrigger(label: string, fn: () => Promise<{ users?: number; totalAmount?: number; processed?: number; demoted?: number }>) {
    setSettleLoading(true)
    try {
      const res = await fn()
      if (res.processed != null) message.success(`${label}：处理 ${res.processed} 人 / 降级 ${res.demoted}`)
      else message.success(`${label}：${res.users ?? 0} 人 / 合计 ${res.totalAmount ?? 0}`)
      loadRecords(1)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '执行失败')
    } finally { setSettleLoading(false) }
  }

  const benefitColumns: ColumnsType<VipBenefitItem> = [
    { title: '等级', dataIndex: 'level', width: 70, render: (v: number) => <Tag color="gold"><CrownOutlined /> VIP{v}</Tag> },
    { title: '晋级礼金', dataIndex: 'promotionBonus', render: (v, r) => <EditableNumber value={v} onChange={(x) => patchLevel(r.level, 'promotionBonus', x)} /> },
    { title: '周俸', dataIndex: 'weeklySalary', render: (v, r) => <EditableNumber value={v} onChange={(x) => patchLevel(r.level, 'weeklySalary', x)} /> },
    { title: '月俸', dataIndex: 'monthlySalary', render: (v, r) => <EditableNumber value={v} onChange={(x) => patchLevel(r.level, 'monthlySalary', x)} /> },
    { title: '生日礼金', dataIndex: 'birthdayBonus', render: (v, r) => <EditableNumber value={v} onChange={(x) => patchLevel(r.level, 'birthdayBonus', x)} /> },
    { title: '负盈利返水 %', dataIndex: 'negativeRebatePct', render: (v, r) => <EditableNumber value={v} step={0.1} precision={3} onChange={(x) => patchLevel(r.level, 'negativeRebatePct', x)} /> },
    { title: '保级线（季度流水）', dataIndex: 'retentionLine', render: (v, r) => <EditableNumber value={v} step={100} onChange={(x) => patchLevel(r.level, 'retentionLine', x)} /> },
    { title: '每日提现额度', dataIndex: 'withdrawDailyLimit', render: (v, r) => <EditableNumber value={v} step={100} onChange={(x) => patchLevel(r.level, 'withdrawDailyLimit', x)} /> },
    { title: '每日提现次数', dataIndex: 'withdrawDailyCount', render: (v, r) => <EditableNumber value={v} step={1} precision={0} onChange={(x) => patchLevel(r.level, 'withdrawDailyCount', x)} /> },
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

  const benefitsCard = (
    <Card>
      {loading ? <Spin /> : (
        <>
          <Space style={{ marginBottom: 12 }} wrap>
            <Button type="primary" loading={saving} onClick={handleSave}>保存权益配置</Button>
            <Popconfirm
              title="结算上一整周的负盈利返水？"
              description="按各用户上周净输 × 本级返水率写入待领取，幂等可重复执行。"
              onConfirm={() => handleSettle(false)}
            >
              <Button icon={<ThunderboltOutlined />} loading={settleLoading}>返水·上一周</Button>
            </Popconfirm>
            <Popconfirm title="结算本周至今的负盈利返水？（测试用）" onConfirm={() => handleSettle(true)}>
              <Button icon={<ThunderboltOutlined />} loading={settleLoading}>返水·本周至今</Button>
            </Popconfirm>
            <Popconfirm title="发放本周至今的周俸？（测试用，需当期有投注）" onConfirm={() => runTrigger('周俸', () => triggerVipWeeklySalary(true))}>
              <Button loading={settleLoading}>周俸·本周至今</Button>
            </Popconfirm>
            <Popconfirm title="发放本月至今的月俸？（测试用）" onConfirm={() => runTrigger('月俸', () => triggerVipMonthlySalary(true))}>
              <Button loading={settleLoading}>月俸·本月至今</Button>
            </Popconfirm>
            <Popconfirm title="发放今日生日礼金？" onConfirm={() => runTrigger('生日礼金', () => triggerVipBirthday())}>
              <Button loading={settleLoading}>生日礼金·今日</Button>
            </Popconfirm>
            <Popconfirm title="执行季度保级考核？（本季度只处理一次）" description="未达保级线降1级（总降幅封顶一级），活跃且低于历史最高则回升1级。" onConfirm={() => runTrigger('保级考核', () => triggerVipRetention())}>
              <Button danger loading={settleLoading}>季度保级考核</Button>
            </Popconfirm>
          </Space>
          <Table
            rowKey="level" size="small" pagination={false}
            columns={benefitColumns} dataSource={benefits}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
            金额单位与钱包一致（PHP）。周俸/月俸需当期有效投注才发放，限时手动领取。保级考核每季度执行（未达标降1级，总降幅封顶一级）。
            每日提现额度/次数为专属权益展示配置，暂未接入提现闸门（当前提现无每日限额基线）。
          </Text>
        </>
      )}
    </Card>
  )

  const recordsCard = (
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
          current: recordsPage, total: recordsTotal, pageSize: recordsPageSize, pageSizeOptions: PAGE_SIZE_OPTIONS,
          onChange: (p, ps) => loadRecords(p, ps),
        }}
      />
    </Card>
  )

  return (
    <div>
      <Title level={3}>
        <CrownOutlined /> {section === 'records' ? 'VIP 礼金记录' : 'VIP 权益配置'}
      </Title>
      <Text type="secondary">
        {section === 'records'
          ? 'VIP 晋级礼金 / 周俸月俸 / 负盈利返水 / 生日礼金的发放记录'
          : '等级复用洗码 VIP1–9（累计有效流水判级）。此处配置各级权益数值，保存即生效。'}
      </Text>
      <div style={{ marginTop: 16 }}>
        {section === 'records' ? recordsCard : benefitsCard}
      </div>
    </div>
  )
}
