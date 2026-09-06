import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, QRCode, Space, Tag, Typography, message } from 'antd'
import {
  disablePlatformTotp, enablePlatformTotp, getPlatformTotpStatus, setupPlatformTotp,
  type PlatformTotpSetup,
} from '../api'
import { useAuthStore } from '../stores/auth'

/**
 * 平台后台的两步验证。平台域名不再有 IP 白名单，这一页就是那道被替换掉的门禁。
 */
export default function Security() {
  const nav = useNavigate()
  const mustSetup = useAuthStore((s) => s.totpSetupRequired)
  const clearSetupFlag = useAuthStore((s) => s.clearTotpSetupRequired)
  const [enabled, setEnabled] = useState(false)
  const [setup, setSetup] = useState<PlatformTotpSetup | null>(null)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{ code: string }>()
  const [offForm] = Form.useForm<{ code: string }>()

  async function load() {
    try { setEnabled((await getPlatformTotpStatus()).enabled) }
    catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [])

  async function startSetup() {
    setLoading(true)
    try {
      setSetup(await setupPlatformTotp())
      form.resetFields()
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }

  async function confirm(values: { code: string }) {
    setLoading(true)
    try {
      await enablePlatformTotp(values.code)
      setSetup(null)
      setEnabled(true)
      clearSetupFlag()
      message.success('两步验证已开启')
      if (mustSetup) nav('/tenants', { replace: true })
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }

  async function turnOff(values: { code: string }) {
    setLoading(true)
    try {
      await disablePlatformTotp(values.code)
      setEnabled(false)
      offForm.resetFields()
      message.success('两步验证已关闭')
    } catch (e) { message.error((e as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <Card title="两步验证（Google Authenticator）" style={{ maxWidth: 560 }}>
      {mustSetup && (
        <Alert
          type="warning"
          showIcon
          message="必须完成绑定才能使用平台后台"
          description="当前登录态只能访问这一页。绑定完成后会自动进入后台。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Space style={{ marginBottom: 16 }}>
        <Typography.Text>当前状态：</Typography.Text>
        {enabled ? <Tag color="green">已开启</Tag> : <Tag color="red">未开启</Tag>}
      </Space>

      {setup ? (
        <>
          <Typography.Paragraph>
            用 Google Authenticator 扫描下方二维码，然后输入 App 显示的 6 位验证码完成绑定。
          </Typography.Paragraph>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <QRCode value={setup.otpauthUri} size={200} />
          </div>
          <Typography.Paragraph type="secondary">
            扫不了码可手动输入密钥：<Typography.Text code copyable>{setup.secret}</Typography.Text>
          </Typography.Paragraph>
          <Form form={form} layout="vertical" onFinish={confirm}>
            <Form.Item name="code" label="验证码" rules={[{ required: true, message: '请输入 6 位验证码' }]}>
              <Input placeholder="6 位验证码" maxLength={6} inputMode="numeric" autoComplete="one-time-code" />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>确认绑定</Button>
              <Button onClick={() => setSetup(null)}>取消</Button>
            </Space>
          </Form>
        </>
      ) : enabled ? (
        <>
          <Typography.Paragraph type="secondary">
            换手机时先用当前验证码「重新绑定」，会生成新二维码并作废旧的。
          </Typography.Paragraph>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button onClick={startSetup} loading={loading}>重新绑定（换手机）</Button>
            <Form form={offForm} layout="inline" onFinish={turnOff} style={{ marginTop: 8 }}>
              <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]}>
                <Input placeholder="6 位验证码" maxLength={6} inputMode="numeric" />
              </Form.Item>
              <Button danger htmlType="submit" loading={loading}>关闭两步验证</Button>
            </Form>
          </Space>
        </>
      ) : (
        <Button type="primary" onClick={startSetup} loading={loading}>开启两步验证</Button>
      )}
    </Card>
  )
}
