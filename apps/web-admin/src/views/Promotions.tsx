import { useEffect, useState } from 'react'
import { Card, InputNumber, Switch, Button, message, Typography, Row, Col, Spin, Tabs, Table, Space } from 'antd'
import { GiftOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { getPromoConfig, savePromoConfig, FIRSTDEP_CURRENCIES, type PromoConfig, type FirstDepTier } from '../api'

const { Title, Text } = Typography

export default function Promotions() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cfg, setCfg] = useState<PromoConfig | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await getPromoConfig()
      for (const c of FIRSTDEP_CURRENCIES) if (!data.firstdep.tiers[c]) data.firstdep.tiers[c] = []
      setCfg(data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function patch(updater: (draft: PromoConfig) => void) {
    setCfg((prev) => {
      if (!prev) return prev
      const next: PromoConfig = JSON.parse(JSON.stringify(prev))
      updater(next)
      return next
    })
  }

  function validate(c: PromoConfig): string | null {
    if (c.trial.amount <= 0 || c.trial.amount > 50000) return 'trial 注册奖励必须在 1-50000'
    if (c.referral.inviterAmount < 0 || c.referral.inviteeAmount < 0) return 'referral 金额不能为负'
    if (c.firstdep.turnoverX < 0 || c.firstdep.turnoverDays < 0) return 'firstdep 流水倍率/有效期不能为负'
    for (const [currency, list] of Object.entries(c.firstdep.tiers)) {
      for (const t of list) {
        if (!(t.depositAmount > 0) || t.bonusAmount < 0) return `${currency} 档位金额必须大于 0、奖励不能为负`
      }
    }
    return null
  }

  async function handleSave() {
    if (!cfg) return
    const err = validate(cfg)
    if (err) { message.error(err); return }
    setSaving(true)
    try {
      await savePromoConfig(cfg)
      message.success('活动配置已保存，客户端即时生效')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !cfg) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>

  const tierColumns = (currency: string) => [
    {
      title: '充值额',
      dataIndex: 'depositAmount',
      render: (_: number, _row: FirstDepTier, idx: number) => (
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          value={cfg.firstdep.tiers[currency][idx].depositAmount}
          onChange={(v) => patch((d) => { d.firstdep.tiers[currency][idx].depositAmount = Number(v ?? 0) })}
        />
      ),
    },
    {
      title: '首存奖励',
      dataIndex: 'bonusAmount',
      render: (_: number, _row: FirstDepTier, idx: number) => (
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          value={cfg.firstdep.tiers[currency][idx].bonusAmount}
          onChange={(v) => patch((d) => { d.firstdep.tiers[currency][idx].bonusAmount = Number(v ?? 0) })}
        />
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, _row: FirstDepTier, idx: number) => (
        <Button
          danger
          type="text"
          icon={<DeleteOutlined />}
          onClick={() => patch((d) => { d.firstdep.tiers[currency].splice(idx, 1) })}
        />
      ),
    },
  ]

  const firstdepTab = (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="middle">
          <Col span={8}>
            <Space>
              <Text>活动开关</Text>
              <Switch
                checkedChildren="开启" unCheckedChildren="关闭"
                checked={cfg.firstdep.enabled}
                onChange={(v) => patch((d) => { d.firstdep.enabled = v })}
              />
            </Space>
          </Col>
          <Col span={8}>
            <Text>流水倍率（0=不要求）</Text>
            <InputNumber
              suffix="x" style={{ width: '100%', marginTop: 4 }} min={0} max={100} precision={0}
              value={cfg.firstdep.turnoverX}
              onChange={(v) => patch((d) => { d.firstdep.turnoverX = Number(v ?? 0) })}
            />
          </Col>
          <Col span={8}>
            <Text>流水有效期（0=永久）</Text>
            <InputNumber
              suffix="天" style={{ width: '100%', marginTop: 4 }} min={0} max={365} precision={0}
              value={cfg.firstdep.turnoverDays}
              onChange={(v) => patch((d) => { d.firstdep.turnoverDays = Number(v ?? 0) })}
            />
          </Col>
        </Row>
      </Card>

      <Card title={<span>各币种档位（充值额 → 首存奖励，向下匹配）</span>}>
        <Tabs
          items={FIRSTDEP_CURRENCIES.map((currency) => ({
            key: currency,
            label: currency === 'USDC' ? `${currency}（预留）` : currency,
            children: (
              <>
                <Table<FirstDepTier>
                  size="small"
                  pagination={false}
                  rowKey={(_, idx) => `${currency}-${idx}`}
                  dataSource={cfg.firstdep.tiers[currency]}
                  columns={tierColumns(currency)}
                  locale={{ emptyText: '暂无档位，点击下方添加' }}
                />
                <Button
                  block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 12 }}
                  onClick={() => patch((d) => { d.firstdep.tiers[currency].push({ depositAmount: 0, bonusAmount: 0 }) })}
                >
                  添加档位
                </Button>
              </>
            ),
          }))}
        />
      </Card>
    </>
  )

  const generalTab = (
    <>
      <Card
        title={<span>🎖️ 首席体验官</span>}
        style={{ marginBottom: 16 }}
        extra={<Switch checkedChildren="开启" unCheckedChildren="关闭" checked={cfg.trial.enabled} onChange={(v) => patch((d) => { d.trial.enabled = v })} />}
      >
        <Row gutter={24}>
          <Col span={8}>
            <Text>注册奖励金额（PHP）</Text>
            <InputNumber prefix="₱" style={{ width: '100%', marginTop: 4 }} min={1} max={50000} precision={0} value={cfg.trial.amount} onChange={(v) => patch((d) => { d.trial.amount = Number(v ?? 0) })} />
          </Col>
          <Col span={8}>
            <Text>流水倍率（0=不要求）</Text>
            <InputNumber suffix="x" style={{ width: '100%', marginTop: 4 }} min={0} max={100} precision={0} value={cfg.trial.turnoverX} onChange={(v) => patch((d) => { d.trial.turnoverX = Number(v ?? 0) })} />
          </Col>
          <Col span={8}>
            <Text>流水有效期（0=永久）</Text>
            <InputNumber suffix="天" style={{ width: '100%', marginTop: 4 }} min={0} max={365} precision={0} value={cfg.trial.turnoverDays} onChange={(v) => patch((d) => { d.trial.turnoverDays = Number(v ?? 0) })} />
          </Col>
        </Row>
      </Card>

      <Card
        title={<span>🤝 邀请共赢</span>}
        extra={<Switch checkedChildren="开启" unCheckedChildren="关闭" checked={cfg.referral.enabled} onChange={(v) => patch((d) => { d.referral.enabled = v })} />}
      >
        <Row gutter={24}>
          <Col span={12}>
            <Text>邀请人奖励（PHP）</Text>
            <InputNumber prefix="₱" style={{ width: '100%', marginTop: 4 }} min={0} max={50000} precision={0} value={cfg.referral.inviterAmount} onChange={(v) => patch((d) => { d.referral.inviterAmount = Number(v ?? 0) })} />
          </Col>
          <Col span={12}>
            <Text>被邀请人奖励（PHP）</Text>
            <InputNumber prefix="₱" style={{ width: '100%', marginTop: 4 }} min={0} max={50000} precision={0} value={cfg.referral.inviteeAmount} onChange={(v) => patch((d) => { d.referral.inviteeAmount = Number(v ?? 0) })} />
          </Col>
          <Col span={12} style={{ marginTop: 16 }}>
            <Text>流水倍率（0=不要求）</Text>
            <InputNumber suffix="x" style={{ width: '100%', marginTop: 4 }} min={0} max={100} precision={0} value={cfg.referral.turnoverX} onChange={(v) => patch((d) => { d.referral.turnoverX = Number(v ?? 0) })} />
          </Col>
          <Col span={12} style={{ marginTop: 16 }}>
            <Text>流水有效期（0=永久）</Text>
            <InputNumber suffix="天" style={{ width: '100%', marginTop: 4 }} min={0} max={365} precision={0} value={cfg.referral.turnoverDays} onChange={(v) => patch((d) => { d.referral.turnoverDays = Number(v ?? 0) })} />
          </Col>
        </Row>
      </Card>
    </>
  )

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <GiftOutlined style={{ fontSize: 20, color: '#faad14' }} />
        <Title level={4} style={{ margin: 0 }}>活动配置</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>修改后客户端展示和发放金额即时同步</Text>
      </div>

      <Tabs
        defaultActiveKey="general"
        items={[
          { key: 'general', label: '常规活动', children: generalTab },
          { key: 'firstdep', label: '💰 首充嘉年华', children: firstdepTab },
        ]}
      />

      <Button type="primary" size="large" loading={saving} onClick={handleSave} style={{ marginTop: 24 }}>
        保存配置
      </Button>
    </div>
  )
}
