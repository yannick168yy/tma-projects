import { useEffect, useState } from 'react'
import { Card, InputNumber, Select, Switch, Button, message, Typography, Row, Col, Spin, Tabs, Table, Space } from 'antd'
import { GiftOutlined, PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import { getPromoConfig, savePromoConfig, FIRSTDEP_CURRENCIES, type PromoConfig, type FirstDepTier, type PopupConfig } from '../api'

const { Title, Text } = Typography

const POPUP_NAMES: Record<string, string> = { new_player: '新人礼包弹窗' }

const AUDIENCE_OPTIONS = [
  { value: 'all', label: '所有访客' },
  { value: 'guest', label: '仅未登录游客' },
  { value: 'no_deposit', label: '未充值用户（含访客和已登录）' },
  { value: 'new', label: '已登录未充值' },
  { value: 'deposited', label: '已充值用户' },
]

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: '每天一次' },
  { value: 'once', label: '仅一次' },
  { value: 'always', label: '每次进站' },
]

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
    if (c.firstdep.turnoverX < 0 || c.firstdep.turnoverDays < 0) return 'firstdep 流水倍率/有效期不能为负'
    if (c.appdl.amount <= 0 || c.appdl.amount > 50000) return 'App 下载礼金必须在 1-50000'
    if (c.appdl.turnoverX < 0 || c.appdl.turnoverDays < 0) return 'App 下载礼金流水倍率/有效期不能为负'
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
        title={<span>📲 App 下载礼金</span>}
        style={{ marginBottom: 16 }}
        extra={<Switch checkedChildren="开启" unCheckedChildren="关闭" checked={cfg.appdl.enabled} onChange={(v) => patch((d) => { d.appdl.enabled = v })} />}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          用户在 App / PWA（添加到主屏幕）内一次性领取；开启后客户端顶部下载条、Bonuses 页展示区自动亮出金额宣传
        </Text>
        <Row gutter={24}>
          <Col span={8}>
            <Text>礼金金额（PHP）</Text>
            <InputNumber prefix="₱" style={{ width: '100%', marginTop: 4 }} min={1} max={50000} precision={0} value={cfg.appdl.amount} onChange={(v) => patch((d) => { d.appdl.amount = Number(v ?? 0) })} />
          </Col>
          <Col span={8}>
            <Text>流水倍率（0=不要求）</Text>
            <InputNumber suffix="x" style={{ width: '100%', marginTop: 4 }} min={0} max={100} precision={0} value={cfg.appdl.turnoverX} onChange={(v) => patch((d) => { d.appdl.turnoverX = Number(v ?? 0) })} />
          </Col>
          <Col span={8}>
            <Text>流水有效期（0=永久）</Text>
            <InputNumber suffix="天" style={{ width: '100%', marginTop: 4 }} min={0} max={365} precision={0} value={cfg.appdl.turnoverDays} onChange={(v) => patch((d) => { d.appdl.turnoverDays = Number(v ?? 0) })} />
          </Col>
        </Row>
      </Card>

    </>
  )

  function movePopup(idx: number, delta: number) {
    patch((d) => {
      const to = idx + delta
      if (to < 0 || to >= d.popups.length) return
      const [item] = d.popups.splice(idx, 1)
      d.popups.splice(to, 0, item)
      d.popups.forEach((p, i) => { p.order = i + 1 })
    })
  }

  const popupsTab = (
    <Card title="首页进站弹窗调度">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        控制用户进入首页后各弹窗的开关、弹出顺序与覆盖人群；弹出频率决定同一用户多久弹一次（新人礼包弹窗在三步任务全部完成后自动不再弹出，不受此处配置影响）
      </Text>
      <Table<PopupConfig>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={cfg.popups}
        columns={[
          { title: '弹窗', dataIndex: 'id', render: (id: string) => POPUP_NAMES[id] ?? id },
          {
            title: '开关', width: 100,
            render: (_, __, idx) => (
              <Switch checkedChildren="开" unCheckedChildren="关" checked={cfg.popups[idx].enabled} onChange={(v) => patch((d) => { d.popups[idx].enabled = v })} />
            ),
          },
          {
            title: '顺序', width: 110,
            render: (_, __, idx) => (
              <Space>
                <span>{cfg.popups[idx].order}</span>
                <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => movePopup(idx, -1)} />
                <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={idx === cfg.popups.length - 1} onClick={() => movePopup(idx, 1)} />
              </Space>
            ),
          },
          {
            title: '覆盖人群', width: 180,
            render: (_, __, idx) => (
              <Select style={{ width: '100%' }} options={AUDIENCE_OPTIONS} value={cfg.popups[idx].audience} onChange={(v) => patch((d) => { d.popups[idx].audience = v })} />
            ),
          },
          {
            title: '弹出频率', width: 150,
            render: (_, __, idx) => (
              <Select style={{ width: '100%' }} options={FREQUENCY_OPTIONS} value={cfg.popups[idx].frequency} onChange={(v) => patch((d) => { d.popups[idx].frequency = v })} />
            ),
          },
        ]}
      />
    </Card>
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
          { key: 'popups', label: '🪟 首页弹窗', children: popupsTab },
        ]}
      />

      <Button type="primary" size="large" loading={saving} onClick={handleSave} style={{ marginTop: 24 }}>
        保存配置
      </Button>
    </div>
  )
}
