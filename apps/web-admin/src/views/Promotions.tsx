import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Switch, Button, message, Divider, Typography, Row, Col, Spin } from 'antd'
import { GiftOutlined } from '@ant-design/icons'
import { getPromoConfig, savePromoConfig, type PromoConfig } from '../api'

const { Title, Text } = Typography

export default function Promotions() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<PromoConfig>()

  async function load() {
    setLoading(true)
    try {
      const cfg = await getPromoConfig()
      form.setFieldsValue(cfg)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function handleSave() {
    let values: PromoConfig
    try { values = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      await savePromoConfig(values)
      message.success('活动配置已保存，客户端即时生效')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <GiftOutlined style={{ fontSize: 20, color: '#faad14' }} />
        <Title level={4} style={{ margin: 0 }}>活动配置</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>修改后客户端展示和发放金额即时同步</Text>
      </div>

      <Form form={form} layout="vertical" requiredMark={false}>

        {/* 首席体验官 */}
        <Card
          title={<span>🎖️ 首席体验官</span>}
          style={{ marginBottom: 16 }}
          extra={
            <Form.Item name={['trial', 'enabled']} valuePropName="checked" noStyle>
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          }
        >
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                label="注册奖励金额（PHP）"
                name={['trial', 'amount']}
                rules={[{ required: true, type: 'number', min: 1, max: 50000, message: '请输入 1-50000' }]}
              >
                <InputNumber prefix="₱" style={{ width: '100%' }} min={1} max={50000} precision={0} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 邀请共赢 */}
        <Card
          title={<span>🤝 邀请共赢</span>}
          style={{ marginBottom: 16 }}
          extra={
            <Form.Item name={['referral', 'enabled']} valuePropName="checked" noStyle>
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          }
        >
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                label="邀请人奖励（PHP）"
                name={['referral', 'inviterAmount']}
                rules={[{ required: true, type: 'number', min: 0, max: 50000, message: '请输入 0-50000' }]}
              >
                <InputNumber prefix="₱" style={{ width: '100%' }} min={0} max={50000} precision={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="被邀请人奖励（PHP）"
                name={['referral', 'inviteeAmount']}
                rules={[{ required: true, type: 'number', min: 0, max: 50000, message: '请输入 0-50000' }]}
              >
                <InputNumber prefix="₱" style={{ width: '100%' }} min={0} max={50000} precision={0} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 首充嘉年华 */}
        <Card
          title={<span>💰 首充嘉年华</span>}
          style={{ marginBottom: 24 }}
          extra={
            <Form.Item name={['firstdep', 'enabled']} valuePropName="checked" noStyle>
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          }
        >
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                label="加成比例（%）"
                name={['firstdep', 'matchPct']}
                rules={[{ required: true, type: 'number', min: 1, max: 1000, message: '请输入 1-1000' }]}
              >
                <InputNumber suffix="%" style={{ width: '100%' }} min={1} max={1000} precision={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="最高奖励上限（PHP）"
                name={['firstdep', 'maxBonus']}
                rules={[{ required: true, type: 'number', min: 1, message: '请输入大于 0 的金额' }]}
              >
                <InputNumber prefix="₱" style={{ width: '100%' }} min={1} precision={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="最低存款门槛（PHP）"
                name={['firstdep', 'minDeposit']}
                rules={[{ required: true, type: 'number', min: 1, message: '请输入大于 0 的金额' }]}
              >
                <InputNumber prefix="₱" style={{ width: '100%' }} min={1} precision={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="流水要求倍率（x）"
                name={['firstdep', 'turnoverX']}
                rules={[{ required: true, type: 'number', min: 1, max: 100, message: '请输入 1-100' }]}
              >
                <InputNumber suffix="x" style={{ width: '100%' }} min={1} max={100} precision={0} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Divider />
        <Button type="primary" size="large" loading={saving} onClick={handleSave}>
          保存配置
        </Button>
      </Form>
    </div>
  )
}
