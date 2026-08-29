import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Button, Popconfirm, DatePicker, Checkbox, message, Descriptions, Tag, Table, Input, Modal, Space, Badge } from 'antd'
import { PlusOutlined, EditOutlined, StarOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { getTeamConfig, updateTeamConfig, triggerTeamSettle, getTeamRatePlans, createTeamRatePlan, updateTeamRatePlan, setDefaultTeamRatePlan, type TeamConfig, type TeamRatePlan } from '../api'

function yesterdayStr() {
  return dayjs().subtract(1, 'day').format('YYYY-MM-DD')
}

export default function TeamReferralConfig() {
  const [configForm] = Form.useForm<TeamConfig>()
  const [configSaving, setConfigSaving] = useState(false)
  const [settling, setSettling] = useState(false)
  const [settleDate, setSettleDate] = useState(yesterdayStr())
  const [forceSettle, setForceSettle] = useState(false)
  const [configLoaded, setConfigLoaded] = useState<TeamConfig | null>(null)

  const [plans, setPlans] = useState<TeamRatePlan[]>([])
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<TeamRatePlan | null>(null)
  const [planForm] = Form.useForm<{ name: string; l1_rate_pct: number; l2_rate_pct: number; l3_rate_pct: number }>()
  const [planSaving, setPlanSaving] = useState(false)

  async function loadConfig() {
    const cfg = await getTeamConfig()
    configForm.setFieldsValue(cfg)
    setConfigLoaded(cfg)
  }

  async function loadPlans() {
    try {
      const data = await getTeamRatePlans()
      setPlans(data.items)
    } catch { message.error('加载套餐失败') }
  }

  function openCreate() {
    setEditingPlan(null)
    planForm.resetFields()
    setPlanModalOpen(true)
  }

  function openEdit(plan: TeamRatePlan) {
    setEditingPlan(plan)
    planForm.setFieldsValue({ name: plan.name, l1_rate_pct: plan.l1_rate_pct, l2_rate_pct: plan.l2_rate_pct, l3_rate_pct: plan.l3_rate_pct })
    setPlanModalOpen(true)
  }

  async function savePlan() {
    const vals = await planForm.validateFields()
    setPlanSaving(true)
    try {
      if (editingPlan) {
        await updateTeamRatePlan(editingPlan.id, vals)
        message.success('套餐已更新')
      } else {
        await createTeamRatePlan(vals)
        message.success('套餐已创建')
      }
      setPlanModalOpen(false)
      await loadPlans()
    } catch { message.error('保存失败') }
    finally { setPlanSaving(false) }
  }

  async function setDefault(id: number) {
    try {
      await setDefaultTeamRatePlan(id)
      message.success('已设为默认套餐')
      await loadPlans()
    } catch { message.error('操作失败') }
  }

  async function saveConfig() {
    const values = configForm.getFieldsValue()
    setConfigSaving(true)
    try {
      await updateTeamConfig(values)
      message.success('配置已保存')
      await loadConfig()
    } catch { message.error('保存失败') }
    finally { setConfigSaving(false) }
  }

  async function doSettle() {
    setSettling(true)
    try {
      await triggerTeamSettle(settleDate, forceSettle)
      message.success(`${settleDate} 结算已触发，后台处理中`)
    } catch (e) { message.error(e instanceof Error ? e.message : '触发失败') }
    finally { setSettling(false) }
  }

  useEffect(() => { void loadConfig(); void loadPlans() }, [])

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>佣金配置</h2>

      <Card title="门槛与上限" style={{ marginBottom: 20 }}>
        <Form form={configForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <Form.Item label="激活门槛 (PHP分)" name="min_activation_cents">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="最低提现 (PHP分)" name="min_withdrawal_cents">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="最低提现 (IDR分)" name="min_withdrawal_idr_cents">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="单次结算佣金上限 (PHP分，空=不限)" name="max_commission_per_settlement_cents">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="单次结算佣金上限 (IDR分，空=不限)" name="max_commission_per_settlement_idr_cents">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item>
            <Button type="primary" onClick={saveConfig} loading={configSaving}>保存配置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="自动结算时间" style={{ marginBottom: 20 }}>
        <Form form={configForm} layout="vertical">
          <Form.Item label="结算时（各市场当地时间，0-23点，每天该时刻结算前一天）" name="settlement_hour">
            <InputNumber min={0} max={23} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={saveConfig} loading={configSaving}>保存结算时间</Button>
          </Form.Item>
        </Form>
        {configLoaded?.last_auto_settlement && (
          <Descriptions size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="上次自动结算">{configLoaded.last_auto_settlement}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Card
        title="费率套餐管理"
        style={{ marginBottom: 20 }}
        extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>新建套餐</Button>}
      >
        <Table
          size="small"
          rowKey="id"
          dataSource={plans}
          pagination={false}
          columns={[
            {
              title: '套餐名称', dataIndex: 'name', key: 'name',
              render: (name: string, r: TeamRatePlan) => (
                <Space size={6}>
                  {name}
                  {r.is_default === 1 && <Badge status="processing" text="默认（C端展示）" />}
                </Space>
              ),
            },
            { title: 'L1 费率', dataIndex: 'l1_rate_pct', key: 'l1', width: 90, render: (v: number) => `${v}%` },
            { title: 'L2 费率', dataIndex: 'l2_rate_pct', key: 'l2', width: 90, render: (v: number) => `${v}%` },
            { title: 'L3 费率', dataIndex: 'l3_rate_pct', key: 'l3', width: 90, render: (v: number) => `${v}%` },
            {
              title: '操作', key: 'actions', width: 180,
              render: (_: unknown, r: TeamRatePlan) => (
                <Space size={4}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
                  {r.is_default !== 1 && (
                    <Popconfirm title="设为默认套餐？" description="C端广告将展示此套餐费率。" onConfirm={() => setDefault(r.id)}>
                      <Button size="small" icon={<StarOutlined />}>设为默认</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={planModalOpen}
        title={editingPlan ? '编辑套餐' : '新建套餐'}
        onCancel={() => setPlanModalOpen(false)}
        onOk={savePlan}
        confirmLoading={planSaving}
        destroyOnHidden
        width={400}
      >
        <Form form={planForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="套餐名称" name="name" rules={[{ required: true, message: '请输入套餐名称' }]}>
            <Input placeholder="如：标准套餐、VIP套餐" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Form.Item label="L1 费率 (%)" name="l1_rate_pct" rules={[{ required: true }]}>
              <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="L2 费率 (%)" name="l2_rate_pct" rules={[{ required: true }]}>
              <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="L3 费率 (%)" name="l3_rate_pct" rules={[{ required: true }]}>
              <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Card title="手动触发每日结算">
        <p style={{ color: '#888', marginBottom: 16, fontSize: 13 }}>
          选择需要结算的日期，点击触发结算。结算为异步操作，触发后后台处理。
          勾选"覆盖重算"时，若该日期已结算，将回滚旧佣金并重新计算。
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <DatePicker
            value={dayjs(settleDate)}
            allowClear={false}
            style={{ width: 160 }}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            onChange={(val) => { if (val) setSettleDate(val.format('YYYY-MM-DD')) }}
          />
          <Checkbox checked={forceSettle} onChange={(e) => setForceSettle(e.target.checked)}>
            覆盖重算
          </Checkbox>
          {forceSettle && <Tag color="orange">覆盖模式：已结算数据将回滚重算</Tag>}
          <Popconfirm
            title={`确认触发 ${settleDate} 日结算？`}
            description={forceSettle ? '覆盖模式将回滚已入账佣金后重新计算，请确认无误。' : '结算将计算当日投注流水佣金并入账。'}
            onConfirm={doSettle}
          >
            <Button type="primary" danger={forceSettle} loading={settling}>
              触发 {settleDate} 结算{forceSettle ? '（覆盖）' : ''}
            </Button>
          </Popconfirm>
        </div>
      </Card>
    </div>
  )
}
