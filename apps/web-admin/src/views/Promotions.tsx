import { useEffect, useState } from 'react'
import { Card, InputNumber, Select, Switch, Button, message, Typography, Row, Col, Spin, Tabs, Table, Space, Segmented } from 'antd'
import { GiftOutlined, PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import { getPromoConfig, savePromoConfig, triggerVipNegativeRebate, FIRSTDEP_CURRENCIES, CONFIG_CCY_OPTIONS, type PromoConfig, type FirstDepTier, type PopupConfig, type BonusCard } from '../api'

const { Title, Text } = Typography

const POPUP_NAMES: Record<string, string> = { new_player: '新人礼包弹窗', firstdep: '首充悬浮入口', trial: '首席体验官' }

// Bonuses 页卡片：统一开关/排序/人群
const BONUS_CARD_NAMES: Record<string, string> = {
  checkin: '📅 每日签到',
  agent: '🏆 3-Circle 推广返佣',
  trial: '🎖️ 首席体验官',
  appdl: '📲 App 下载礼金',
  firstdep: '💰 首充嘉年华',
  lossrebate: '💸 负盈利返水',
}

// 进站自动弹窗，弹出频率才生效；其余为常驻入口（首充悬浮球），只用开关+人群
const AUTO_POPUP_IDS = new Set(['new_player', 'trial'])

const AUDIENCE_OPTIONS = [
  { value: 'all', label: '所有访客' },
  { value: 'guest', label: '仅未登录游客' },
  { value: 'no_deposit', label: '未充值用户或游客' },
  { value: 'new', label: '已登录未充值' },
  { value: 'deposited', label: '已充值用户' },
]

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: '每天一次' },
  { value: 'once', label: '仅一次' },
  { value: 'always', label: '每次进站' },
]

function currencyPrefix(currency: string): string {
  if (currency === 'PHP') return '₱'
  if (currency === 'IDR') return 'Rp'
  return currency
}

function formatCurrencyTotals(byCurrency: Record<string, number>): string {
  return Object.entries(byCurrency)
    .map(([currency, amount]) => `${currencyPrefix(currency)}${Number(amount).toLocaleString('en-US', { maximumFractionDigits: currency === 'IDR' ? 0 : 4 })}`)
    .join(' / ')
}

export default function Promotions() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settling, setSettling] = useState(false)
  const [cfg, setCfg] = useState<PromoConfig | null>(null)
  const [redepCcy, setRedepCcy] = useState<string>('PHP')
  const [lossCcy, setLossCcy] = useState<string>('PHP')
  const [generalCcy, setGeneralCcy] = useState<string>('PHP')

  async function settleNow() {
    setSettling(true)
    try {
      const r = await triggerVipNegativeRebate(true)
      if (r.skipped) message.warning('活动未开启，未结算（请先开启开关并保存）')
      else message.success(`结算完成：${r.users} 人，${formatCurrencyTotals(r.byCurrency)}（写入待领取，幂等可重跑）`)
    } catch { message.error('结算失败') } finally { setSettling(false) }
  }

  async function load() {
    setLoading(true)
    try {
      const data = await getPromoConfig()
      for (const c of FIRSTDEP_CURRENCIES) if (!data.firstdep.tiers[c]) data.firstdep.tiers[c] = []
      if (!data.trial.amountByCcy) data.trial.amountByCcy = { PHP: data.trial.amount }
      if (!data.appdl.amountByCcy) data.appdl.amountByCcy = { PHP: data.appdl.amount }
      for (const c of FIRSTDEP_CURRENCIES) {
        if (data.trial.amountByCcy[c] == null) data.trial.amountByCcy[c] = data.trial.amount
        if (data.appdl.amountByCcy[c] == null) data.appdl.amountByCcy[c] = data.appdl.amount
      }
      // 防御性初始化按币种结构（后端一般已下发）
      if (!data.redep.byCcy) data.redep.byCcy = {}
      for (const c of FIRSTDEP_CURRENCIES) if (!data.redep.byCcy[c]) data.redep.byCcy[c] = { minDeposit: data.redep.minDeposit, bonusAmount: data.redep.bonusAmount }
      if (!data.regularRedep.tiers) data.regularRedep.tiers = {}
      if (!data.regularRedep.dailyBonusCaps) data.regularRedep.dailyBonusCaps = {}
      for (const c of FIRSTDEP_CURRENCIES) {
        if (!data.regularRedep.tiers[c]) data.regularRedep.tiers[c] = []
        if (data.regularRedep.dailyBonusCaps[c] == null) data.regularRedep.dailyBonusCaps[c] = 0
      }
      if (data.lossRebate.windowDays == null) data.lossRebate.windowDays = 7
      if (!data.lossRebate.minDepositByCcy) data.lossRebate.minDepositByCcy = {}
      for (const c of FIRSTDEP_CURRENCIES) if (data.lossRebate.minDepositByCcy[c] == null) data.lossRebate.minDepositByCcy[c] = data.lossRebate.minDeposit
      if (!Array.isArray(data.lossRebate.enabledCurrencies)) data.lossRebate.enabledCurrencies = ['PHP', 'USDT', 'USDC']
      if (!Array.isArray(data.bonusCards)) data.bonusCards = []
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
    if (Object.values(c.trial.amountByCcy).some((amount) => amount <= 0)) return '首席体验官各币种奖励必须大于 0'
    if (c.firstdep.turnoverX < 0 || c.firstdep.turnoverDays < 0) return 'firstdep 流水倍率/有效期不能为负'
    if (Object.values(c.appdl.amountByCcy).some((amount) => amount <= 0)) return 'App 下载礼金各币种金额必须大于 0'
    if (c.appdl.turnoverX < 0 || c.appdl.turnoverDays < 0) return 'App 下载礼金流水倍率/有效期不能为负'
    if (c.redep.minDeposit <= 0 || c.redep.bonusAmount < 0 || c.redep.windowHours <= 0) return '复充限时:档位/时长必须为正、奖励不能为负'
    if (c.regularRedep.turnoverX < 0 || c.regularRedep.turnoverDays < 0 || c.regularRedep.claimHours <= 0 || c.regularRedep.dailyMaxClaims <= 0) return '常规复充:流水、领取时限和每日次数配置无效'
    if (c.lossRebate.ratePct < 0 || c.lossRebate.ratePct > 100 || c.lossRebate.minDeposit < 0) return '负盈利返水:费率须在 0-100、门槛不能为负'
    for (const [currency, list] of Object.entries(c.firstdep.tiers)) {
      for (const t of list) {
        if (!(t.depositAmount > 0) || t.bonusAmount < 0) return `${currency} 档位金额必须大于 0、奖励不能为负`
      }
    }
    for (const [currency, list] of Object.entries(c.regularRedep.tiers)) {
      for (const t of list) if (t.depositAmount <= 0 || t.bonusAmount < 0) return `常规复充 ${currency} 档位金额必须大于0、奖励不能为负`
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
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          活动开关在「常规活动 · 活动卡片编排」统一控制；此处配置流水要求与各币种档位
        </Text>
        <Row gutter={24} align="middle">
          <Col span={12}>
            <Text>流水倍率（0=不要求）</Text>
            <InputNumber
              suffix="x" style={{ width: '100%', marginTop: 4 }} min={0} max={100} precision={0}
              value={cfg.firstdep.turnoverX}
              onChange={(v) => patch((d) => { d.firstdep.turnoverX = Number(v ?? 0) })}
            />
          </Col>
          <Col span={12}>
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
          items={CONFIG_CCY_OPTIONS.map(({ value: currency, label }) => ({
            key: currency,
            label,
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

  const bonusCardsTable = (
    <Card title="Bonuses 页活动卡片编排" style={{ marginBottom: 16 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        统一控制客户端 Bonuses 页各活动卡片的开关、显示顺序与覆盖人群；顺序即页面从上到下的渲染顺序。金额/流水/档位等明细在下方及「首充嘉年华」页配置
      </Text>
      <Table<BonusCard>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={cfg.bonusCards}
        columns={[
          { title: '活动', dataIndex: 'id', render: (id: string) => BONUS_CARD_NAMES[id] ?? id },
          {
            title: '开关', width: 100,
            render: (_, __, idx) => (
              <Switch checkedChildren="开" unCheckedChildren="关" checked={cfg.bonusCards[idx].enabled} onChange={(v) => patch((d) => { d.bonusCards[idx].enabled = v })} />
            ),
          },
          {
            title: '顺序', width: 110,
            render: (_, __, idx) => (
              <Space>
                <span>{cfg.bonusCards[idx].order}</span>
                <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => moveBonusCard(idx, -1)} />
                <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={idx === cfg.bonusCards.length - 1} onClick={() => moveBonusCard(idx, 1)} />
              </Space>
            ),
          },
          {
            title: '覆盖人群', width: 180,
            render: (_, __, idx) => (
              <Select style={{ width: '100%' }} options={AUDIENCE_OPTIONS} value={cfg.bonusCards[idx].audience} onChange={(v) => patch((d) => { d.bonusCards[idx].audience = v })} />
            ),
          },
        ]}
      />
    </Card>
  )

  const generalTab = (
    <>
      {bonusCardsTable}

      <Space style={{ marginBottom: 12 }} align="center">
        <Text strong>金额币种：</Text>
        <Segmented value={generalCcy} onChange={(v) => setGeneralCcy(String(v))}
          options={CONFIG_CCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      </Space>

      <Card
        title={<span>🎖️ 首席体验官 · 金额设置</span>}
        style={{ marginBottom: 16 }}
      >
        <Row gutter={24}>
          <Col span={8}>
            <Text>注册奖励金额（{generalCcy}）</Text>
            <InputNumber style={{ width: '100%', marginTop: 4 }} min={1} precision={generalCcy === 'IDR' ? 0 : 2} value={cfg.trial.amountByCcy[generalCcy]} onChange={(v) => patch((d) => { d.trial.amountByCcy[generalCcy] = Number(v ?? 0); if (generalCcy === 'PHP') d.trial.amount = Number(v ?? 0) })} />
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
        title={<span>📲 App 下载礼金 · 金额设置</span>}
        style={{ marginBottom: 16 }}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          用户在 App / PWA（添加到主屏幕）内一次性领取；卡片开关在上方「活动卡片编排」统一控制
        </Text>
        <Row gutter={24}>
          <Col span={8}>
            <Text>礼金金额（{generalCcy}）</Text>
            <InputNumber style={{ width: '100%', marginTop: 4 }} min={1} precision={generalCcy === 'IDR' ? 0 : 2} value={cfg.appdl.amountByCcy[generalCcy]} onChange={(v) => patch((d) => { d.appdl.amountByCcy[generalCcy] = Number(v ?? 0); if (generalCcy === 'PHP') d.appdl.amount = Number(v ?? 0) })} />
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

  const regularRedepTab = (
    <>
      <Card style={{ marginBottom: 16 }} title="常规复充赠金"
        extra={<Switch checkedChildren="开启" unCheckedChildren="关闭" checked={cfg.regularRedep.enabled} onChange={(value) => patch((d) => { d.regularRedep.enabled = value })} />}>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          非首充订单按最高达标档位生成待领取资格；用户领取后才增加赠金流水。默认与限时复充互斥，防止同一订单重复奖励。
        </Text>
        <Row gutter={[16, 16]}>
          <Col span={8}><Text>流水倍率</Text><InputNumber suffix="x" min={0} max={100} style={{ width: '100%', marginTop: 4 }} value={cfg.regularRedep.turnoverX} onChange={(v) => patch((d) => { d.regularRedep.turnoverX = Number(v ?? 0) })} /></Col>
          <Col span={8}><Text>流水有效期</Text><InputNumber suffix="天" min={0} max={365} style={{ width: '100%', marginTop: 4 }} value={cfg.regularRedep.turnoverDays} onChange={(v) => patch((d) => { d.regularRedep.turnoverDays = Number(v ?? 0) })} /></Col>
          <Col span={8}><Text>领取有效期</Text><InputNumber suffix="小时" min={1} max={168} style={{ width: '100%', marginTop: 4 }} value={cfg.regularRedep.claimHours} onChange={(v) => patch((d) => { d.regularRedep.claimHours = Number(v ?? 0) })} /></Col>
          <Col span={8}><Text>每日最多领取</Text><InputNumber suffix="次" min={1} max={100} style={{ width: '100%', marginTop: 4 }} value={cfg.regularRedep.dailyMaxClaims} onChange={(v) => patch((d) => { d.regularRedep.dailyMaxClaims = Number(v ?? 1) })} /></Col>
          <Col span={8}><Text>允许叠加限时复充</Text><div style={{ marginTop: 8 }}><Switch checked={cfg.regularRedep.stackWithLimited} onChange={(v) => patch((d) => { d.regularRedep.stackWithLimited = v })} /></div></Col>
        </Row>
      </Card>
      <Card title="各币种阶梯（单笔充值只匹配最高档）">
        <Tabs items={CONFIG_CCY_OPTIONS.map(({ value: currency, label }) => ({
          key: currency, label,
          children: <>
            <Text>每日赠金上限（{currency}）</Text>
            <InputNumber min={0} precision={currency === 'IDR' ? 0 : 2} prefix={currencyPrefix(currency)} style={{ width: 220, margin: '0 0 12px 8px' }} value={cfg.regularRedep.dailyBonusCaps[currency] ?? 0} onChange={(v) => patch((d) => { d.regularRedep.dailyBonusCaps[currency] = Number(v ?? 0) })} />
            <Table<FirstDepTier> size="small" pagination={false} rowKey={(_, idx) => `regular-${currency}-${idx}`}
              dataSource={cfg.regularRedep.tiers[currency]}
              columns={[
                { title: `充值门槛（${currency}）`, render: (_: unknown, __: FirstDepTier, idx: number) => <InputNumber min={0} precision={currency === 'IDR' ? 0 : 2} value={cfg.regularRedep.tiers[currency][idx].depositAmount} onChange={(v) => patch((d) => { d.regularRedep.tiers[currency][idx].depositAmount = Number(v ?? 0) })} /> },
                { title: `赠金（${currency}）`, render: (_: unknown, __: FirstDepTier, idx: number) => <InputNumber min={0} precision={currency === 'IDR' ? 0 : 2} value={cfg.regularRedep.tiers[currency][idx].bonusAmount} onChange={(v) => patch((d) => { d.regularRedep.tiers[currency][idx].bonusAmount = Number(v ?? 0) })} /> },
                { title: '操作', width: 80, render: (_: unknown, __: FirstDepTier, idx: number) => <Button danger type="text" icon={<DeleteOutlined />} onClick={() => patch((d) => { d.regularRedep.tiers[currency].splice(idx, 1) })} /> },
              ]} />
            <Button block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => patch((d) => { d.regularRedep.tiers[currency].push({ depositAmount: 0, bonusAmount: 0 }) })}>添加档位</Button>
          </>,
        }))} />
      </Card>
    </>
  )

  const redepTab = (
    <Card
      title={<span>⏰ 复充限时优惠</span>}
      extra={<Switch checkedChildren="开启" unCheckedChildren="关闭" checked={cfg.redep.enabled} onChange={(v) => patch((d) => { d.redep.enabled = v })} />}
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        面向「已首充且当日未充值」的用户：进站触发限时弹窗，窗口内充值 ≥ 档位金额额外送固定奖励（每个窗口只发一次）。
        不在充值页常驻展示，仅倒计时内充值面板对应金额档显示奖励角标与倒计时横幅
      </Text>
      <Space style={{ marginBottom: 8 }} align="center">
        <Text strong>币种：</Text>
        <Segmented value={redepCcy} onChange={(v) => setRedepCcy(String(v))} options={CONFIG_CCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <Text type="secondary" style={{ fontSize: 12 }}>门槛/奖励按币种独立(该币种口径);窗口/冷却/流水全币种通用</Text>
      </Space>
      <Row gutter={24} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Text>达标充值额（{redepCcy}）</Text>
          <InputNumber prefix={currencyPrefix(redepCcy)} style={{ width: '100%', marginTop: 4 }} min={0} precision={redepCcy === 'IDR' ? 0 : 2}
            value={cfg.redep.byCcy[redepCcy]?.minDeposit ?? 0}
            onChange={(v) => patch((d) => { d.redep.byCcy[redepCcy] = { ...d.redep.byCcy[redepCcy], minDeposit: Number(v ?? 0) }; if (redepCcy === 'PHP') d.redep.minDeposit = Number(v ?? 0) })} />
        </Col>
        <Col span={8}>
          <Text>额外奖励（{redepCcy}）</Text>
          <InputNumber prefix={currencyPrefix(redepCcy)} style={{ width: '100%', marginTop: 4 }} min={0} precision={redepCcy === 'IDR' ? 0 : 2}
            value={cfg.redep.byCcy[redepCcy]?.bonusAmount ?? 0}
            onChange={(v) => patch((d) => { d.redep.byCcy[redepCcy] = { ...d.redep.byCcy[redepCcy], bonusAmount: Number(v ?? 0) }; if (redepCcy === 'PHP') d.redep.bonusAmount = Number(v ?? 0) })} />
        </Col>
        <Col span={8}>
          <Text>窗口时长</Text>
          <InputNumber suffix="小时" style={{ width: '100%', marginTop: 4 }} min={1} max={72} precision={0} value={cfg.redep.windowHours} onChange={(v) => patch((d) => { d.redep.windowHours = Number(v ?? 0) })} />
        </Col>
      </Row>
      <Row gutter={24}>
        <Col span={8}>
          <Text>触发冷却（天）</Text>
          <InputNumber suffix="天" style={{ width: '100%', marginTop: 4 }} min={0} max={30} precision={0} value={cfg.redep.cooldownDays} onChange={(v) => patch((d) => { d.redep.cooldownDays = Number(v ?? 0) })} />
        </Col>
        <Col span={8}>
          <Text>流水倍率（0=不要求）</Text>
          <InputNumber suffix="x" style={{ width: '100%', marginTop: 4 }} min={0} max={100} precision={0} value={cfg.redep.turnoverX} onChange={(v) => patch((d) => { d.redep.turnoverX = Number(v ?? 0) })} />
        </Col>
        <Col span={8}>
          <Text>流水有效期（0=永久）</Text>
          <InputNumber suffix="天" style={{ width: '100%', marginTop: 4 }} min={0} max={365} precision={0} value={cfg.redep.turnoverDays} onChange={(v) => patch((d) => { d.redep.turnoverDays = Number(v ?? 0) })} />
        </Col>
      </Row>
    </Card>
  )

  const lossRebateTab = (
    <Card
      title={<span>💸 负盈利返水</span>}
      extra={<Switch checkedChildren="开启" unCheckedChildren="关闭" checked={cfg.lossRebate.enabled} onChange={(v) => patch((d) => { d.lossRebate.enabled = v })} />}
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        路线A：每日结算「昨天」净输（Σ投注−Σ派彩），按统一费率返还，全等级一致、无上限，用户手动领取。
        门槛/封顶均按「近 N 天累计有效充值」（滚动窗口，无需当天存款）；品类白名单只含电子类，排除真人/体育防对赌套利。
      </Text>
      <Row gutter={24} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Text>返水率</Text>
          <InputNumber suffix="%" style={{ width: '100%', marginTop: 4 }} min={0} max={100} precision={2} value={cfg.lossRebate.ratePct} onChange={(v) => patch((d) => { d.lossRebate.ratePct = Number(v ?? 0) })} />
        </Col>
        <Col span={8}>
          <Space size={4} align="center" style={{ marginBottom: 2 }}>
            <Text>充值门槛（{lossCcy}）</Text>
            <Segmented size="small" value={lossCcy} onChange={(v) => setLossCcy(String(v))} options={CONFIG_CCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
            <Switch
              style={{ marginLeft: 12 }}
              checked={cfg.lossRebate.enabledCurrencies.includes(lossCcy)}
              checkedChildren="该币种启用"
              unCheckedChildren="该币种停用"
              onChange={(enabled) => patch((d) => {
                d.lossRebate.enabledCurrencies = enabled
                  ? Array.from(new Set([...d.lossRebate.enabledCurrencies, lossCcy]))
                  : d.lossRebate.enabledCurrencies.filter((c) => c !== lossCcy)
              })}
            />
          </Space>
          <InputNumber prefix={currencyPrefix(lossCcy)} style={{ width: '100%', marginTop: 4 }} min={0} precision={lossCcy === 'IDR' ? 0 : 2}
            value={cfg.lossRebate.minDepositByCcy[lossCcy] ?? 0}
            onChange={(v) => patch((d) => { d.lossRebate.minDepositByCcy[lossCcy] = Number(v ?? 0); if (lossCcy === 'PHP') d.lossRebate.minDeposit = Number(v ?? 0) })} />
        </Col>
        <Col span={8}>
          <Text>存款统计窗口</Text>
          <InputNumber suffix="天" style={{ width: '100%', marginTop: 4 }} min={1} max={90} precision={0} value={cfg.lossRebate.windowDays} onChange={(v) => patch((d) => { d.lossRebate.windowDays = Number(v ?? 7) })} />
        </Col>
      </Row>
      <Row gutter={24} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Text>返水基数封顶近 {cfg.lossRebate.windowDays} 天存款</Text>
          <div style={{ marginTop: 4 }}>
            <Switch checkedChildren="封顶" unCheckedChildren="不封顶" checked={cfg.lossRebate.capToDeposit} onChange={(v) => patch((d) => { d.lossRebate.capToDeposit = v })} />
          </div>
        </Col>
      </Row>
      <Row gutter={24}>
        <Col span={24}>
          <Text>参与返水的品类白名单（⚠️ 勾选真人/体育有对赌无损套利风险）</Text>
          <Select
            mode="multiple"
            style={{ width: '100%', marginTop: 4 }}
            value={cfg.lossRebate.eligibleCats}
            onChange={(v) => patch((d) => { d.lossRebate.eligibleCats = v as string[] })}
            options={[
              { value: 'slots', label: '电子 slots' },
              { value: 'fishing', label: '捕鱼 fishing' },
              { value: 'table', label: '桌游 table' },
              { value: 'other', label: '其他 other' },
              { value: 'live', label: '⚠️ 真人 live' },
              { value: 'sports', label: '⚠️ 体育 sports' },
            ]}
          />
        </Col>
      </Row>
      <Row gutter={24} style={{ marginTop: 16 }} align="bottom">
        <Col span={8}>
          <Text>每日结算时刻（PHT 整点，结算前一日）</Text>
          <InputNumber suffix="点" style={{ width: '100%', marginTop: 4 }} min={0} max={23} precision={0} value={cfg.lossRebate.settleHour} onChange={(v) => patch((d) => { d.lossRebate.settleHour = Number(v ?? 0) })} />
        </Col>
        <Col span={16}>
          <Button onClick={settleNow} loading={settling}>⚡ 立刻结算「今日至今」（测试）</Button>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 12 }}>需先开启开关并保存；结算今日至今的返水写入待领取，幂等可重跑</Text>
        </Col>
      </Row>
    </Card>
  )

  function moveBonusCard(idx: number, delta: number) {
    patch((d) => {
      const to = idx + delta
      if (to < 0 || to >= d.bonusCards.length) return
      const [item] = d.bonusCards.splice(idx, 1)
      d.bonusCards.splice(to, 0, item)
      d.bonusCards.forEach((c, i) => { c.order = i + 1 })
    })
  }

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
        控制首页各活动入口的开关与覆盖人群；新人礼包、首席体验官为进站自动弹窗（弹出频率决定多久弹一次，已领取/任务完成后自动不再弹）；首充悬浮入口为常驻悬浮球，仅开关与人群生效
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
              AUTO_POPUP_IDS.has(cfg.popups[idx].id)
                ? <Select style={{ width: '100%' }} options={FREQUENCY_OPTIONS} value={cfg.popups[idx].frequency} onChange={(v) => patch((d) => { d.popups[idx].frequency = v })} />
                : <Text type="secondary" style={{ fontSize: 12 }}>常驻入口·不适用</Text>
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
          { key: 'regularRedep', label: '🎁 常规复充', children: regularRedepTab },
          { key: 'redep', label: '⏰ 复充限时', children: redepTab },
          { key: 'lossRebate', label: '💸 负盈利返水', children: lossRebateTab },
          { key: 'popups', label: '🪟 首页弹窗', children: popupsTab },
        ]}
      />

      <Button type="primary" size="large" loading={saving} onClick={handleSave} style={{ marginTop: 24 }}>
        保存配置
      </Button>
    </div>
  )
}
