import { useEffect, useState } from 'react'
import { Card, InputNumber, Select, Switch, Button, message, Typography, Table, Space, Spin } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { getCheckinConfig, saveCheckinConfig, type CheckinConfig, type CheckinTier } from '../api'

const { Title, Text } = Typography

const TIER_OPTIONS = [
  { value: 'starter', label: '普通转盘 (Starter)' },
  { value: 'premium', label: '高级转盘 (Premium)' },
  { value: 'elite', label: '至尊转盘 (Elite)' },
]

export default function Checkin() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cfg, setCfg] = useState<CheckinConfig | null>(null)

  async function load() {
    setLoading(true)
    try { setCfg(await getCheckinConfig()) }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function patch(updater: (draft: CheckinConfig) => void) {
    setCfg((prev) => {
      if (!prev) return prev
      const next: CheckinConfig = JSON.parse(JSON.stringify(prev))
      updater(next)
      return next
    })
  }

  async function save() {
    if (!cfg) return
    setSaving(true)
    try {
      setCfg(await saveCheckinConfig(cfg))
      message.success('已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !cfg) return <Spin style={{ display: 'block', marginTop: 80 }} />

  const tierSelect = (value: CheckinTier, onChange: (v: CheckinTier) => void) => (
    <Select size="small" style={{ width: 150 }} value={value} options={TIER_OPTIONS} onChange={onChange} />
  )

  return (
    <div style={{ maxWidth: 900 }}>
      <Title level={4}>每日签到配置</Title>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Space>
            <Text strong>活动开关</Text>
            <Switch checked={cfg.enabled} onChange={(v) => patch((d) => { d.enabled = v })} />
            <Text type="secondary">关闭后前端入口隐藏、签到接口拒绝</Text>
          </Space>
          <Space>
            <Text strong>增强轨阈值（USDT等值）</Text>
            <InputNumber min={0} value={cfg.enhancedMinPhp} onChange={(v) => patch((d) => { d.enhancedMinPhp = Number(v) || 0 })} />
            <Text type="secondary">当日充值 或 有效投注流水 ≥ 该值 即解锁增强奖励</Text>
          </Space>
        </Space>
      </Card>

      <Card size="small" title="7 天连签奖励（每天发多少次哪档转盘）" style={{ marginBottom: 16 }}>
        <Table
          size="small"
          pagination={false}
          rowKey={(_, i) => String(i)}
          dataSource={cfg.cycle.map((c, i) => ({ ...c, day: i + 1 }))}
          columns={[
            { title: '天', dataIndex: 'day', width: 60, render: (d: number) => `第${d}天${d === cfg.cycle.length ? ' (峰值)' : ''}` },
            {
              title: '基础轨（仅登录）', render: (_, __, i) => (
                <Space>
                  {tierSelect(cfg.cycle[i].base.tier, (v) => patch((d) => { d.cycle[i].base.tier = v }))}
                  ×<InputNumber size="small" min={0} style={{ width: 70 }} value={cfg.cycle[i].base.n} onChange={(v) => patch((d) => { d.cycle[i].base.n = Number(v) || 0 })} />
                </Space>
              ),
            },
            {
              title: '增强轨（当日有充值/投注，叠加）', render: (_, __, i) => (
                <Space>
                  {tierSelect(cfg.cycle[i].enh.tier, (v) => patch((d) => { d.cycle[i].enh.tier = v }))}
                  ×<InputNumber size="small" min={0} style={{ width: 70 }} value={cfg.cycle[i].enh.n} onChange={(v) => patch((d) => { d.cycle[i].enh.n = Number(v) || 0 })} />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card
        size="small"
        title="月度里程碑（当月累计签到达标额外发放）"
        style={{ marginBottom: 16 }}
        extra={<Button size="small" icon={<PlusOutlined />} onClick={() => patch((d) => { d.milestones.push({ atDays: 7, tier: 'premium', n: 1 }) })}>新增</Button>}
      >
        <Table
          size="small"
          pagination={false}
          rowKey={(_, i) => String(i)}
          dataSource={cfg.milestones}
          columns={[
            {
              title: '累计签到天数', width: 200, render: (_, __, i) => (
                <InputNumber size="small" min={1} value={cfg.milestones[i].atDays} onChange={(v) => patch((d) => { d.milestones[i].atDays = Number(v) || 1 })} />
              ),
            },
            { title: '奖励档位', render: (_, __, i) => tierSelect(cfg.milestones[i].tier, (v) => patch((d) => { d.milestones[i].tier = v })) },
            {
              title: '次数', width: 120, render: (_, __, i) => (
                <InputNumber size="small" min={0} value={cfg.milestones[i].n} onChange={(v) => patch((d) => { d.milestones[i].n = Number(v) || 0 })} />
              ),
            },
            {
              title: '', width: 60, render: (_, __, i) => (
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => patch((d) => { d.milestones.splice(i, 1) })} />
              ),
            },
          ]}
        />
      </Card>

      <Button type="primary" loading={saving} onClick={() => void save()}>保存配置</Button>
    </div>
  )
}
