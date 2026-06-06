import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Button, Popconfirm, DatePicker, message, Descriptions } from 'antd'
import dayjs from 'dayjs'
import { getTeamConfig, updateTeamConfig, triggerTeamSettle, type TeamConfig } from '../api'

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function TeamReferralConfig() {
  const [configForm] = Form.useForm<TeamConfig>()
  const [configSaving, setConfigSaving] = useState(false)
  const [settling, setSettling] = useState(false)
  const [settlePeriod, setSettlePeriod] = useState(currentPeriod())
  const [configLoaded, setConfigLoaded] = useState<TeamConfig | null>(null)

  async function loadConfig() {
    const cfg = await getTeamConfig()
    configForm.setFieldsValue(cfg)
    setConfigLoaded(cfg)
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
      await triggerTeamSettle(settlePeriod)
      message.success(`${settlePeriod} 结算已触发，后台处理中`)
    } catch (e) { message.error(e instanceof Error ? e.message : '触发失败') }
    finally { setSettling(false) }
  }

  useEffect(() => { void loadConfig() }, [])

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>佣金配置</h2>

      <Card title="费率与门槛" style={{ marginBottom: 20 }}>
        <Form form={configForm} layout="vertical" onFinish={saveConfig}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <Form.Item label="L1 佣金比率(%)" name="l1_rate_pct">
              <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="L2 佣金比率(%)" name="l2_rate_pct">
              <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="L3 佣金比率(%)" name="l3_rate_pct">
              <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="激活门槛 (PHP分)" name="min_activation_cents">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="最低提现 (PHP分)" name="min_withdrawal_cents">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={configSaving}>保存配置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="自动结算时间" style={{ marginBottom: 20 }}>
        <Form form={configForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="结算日（每月第几天，0=纯手动）" name="settlement_day">
              <InputNumber min={0} max={28} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="结算时（菲律宾时间，0-23点）" name="settlement_hour">
              <InputNumber min={0} max={23} style={{ width: '100%' }} />
            </Form.Item>
          </div>
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

      <Card title="手动触发结算">
        <p style={{ color: '#888', marginBottom: 16, fontSize: 13 }}>
          选择需要结算的月份，点击触发结算。结算为异步操作，触发后后台处理（约1-3分钟）。
          同一月份可多次触发（幂等）。
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <DatePicker
            picker="month"
            value={dayjs(settlePeriod + '-01')}
            allowClear={false}
            style={{ width: 160 }}
            onChange={(val) => { if (val) setSettlePeriod(val.format('YYYY-MM')) }}
          />
          <Popconfirm
            title={`确认触发 ${settlePeriod} 月结算？`}
            description="结算将重新计算该月所有 GGR 佣金并入账，请确认月份无误。"
            onConfirm={doSettle}
          >
            <Button type="primary" danger loading={settling}>触发 {settlePeriod} 月结算</Button>
          </Popconfirm>
        </div>
      </Card>
    </div>
  )
}
