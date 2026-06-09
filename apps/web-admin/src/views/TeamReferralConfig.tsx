import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Button, Popconfirm, DatePicker, Checkbox, message, Descriptions, Tag } from 'antd'
import dayjs from 'dayjs'
import { getTeamConfig, updateTeamConfig, triggerTeamSettle, type TeamConfig } from '../api'

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
      await triggerTeamSettle(settleDate, forceSettle)
      message.success(`${settleDate} 结算已触发，后台处理中`)
    } catch (e) { message.error(e instanceof Error ? e.message : '触发失败') }
    finally { setSettling(false) }
  }

  useEffect(() => { void loadConfig() }, [])

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>佣金配置</h2>

      <Card title="门槛与上限" style={{ marginBottom: 20 }}>
        <Form form={configForm} layout="vertical" onFinish={saveConfig}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <Form.Item label="激活门槛 (PHP分)" name="min_activation_cents">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="最低提现 (PHP分)" name="min_withdrawal_cents">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="单次结算佣金上限 (PHP分，空=不限)" name="max_commission_per_settlement_cents">
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
          <Form.Item label="结算时（菲律宾时间，0-23点，每天该时刻结算前一天）" name="settlement_hour">
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
            disabledDate={(d) => d.isAfter(dayjs().subtract(1, 'day'))}
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
