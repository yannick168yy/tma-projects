import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import { platformLogin, platformLoginTotp } from '../api'
import { useAuthStore } from '../stores/auth'

export default function Login() {
  const nav = useNavigate()
  const signIn = useAuthStore((s) => s.signIn)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [challengeToken, setChallengeToken] = useState('')

  async function submit(values: { username: string; password: string }) {
    setErr('')
    setLoading(true)
    try {
      const res = await platformLogin(values.username, values.password)
      if ('requiresTotp' in res && res.requiresTotp) {
        setChallengeToken(res.challengeToken)
        return
      }
      signIn(res.token, res.role, res.username, res.totpSetupRequired)
      // 强制绑定但还没绑：这个 session 除了绑定接口什么都调不了，直接送去绑定页
      nav(res.totpSetupRequired ? '/security' : '/tenants', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败')
    } finally { setLoading(false) }
  }

  async function submitTotp(values: { code: string }) {
    setErr('')
    setLoading(true)
    try {
      const res = await platformLoginTotp(challengeToken, values.code)
      signIn(res.token, res.role, res.username)
      nav('/tenants', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '验证失败')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f0f2f5' }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ textAlign: 'center', marginBottom: 4 }}>BetoGo 平台控制台</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          {challengeToken ? '两步验证' : '包网运营商管理'}
        </Typography.Paragraph>
        {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
        {challengeToken ? (
          <Form layout="vertical" onFinish={submitTotp}>
            <Form.Item name="code" label="Google Authenticator 验证码" rules={[{ required: true, message: '请输入 6 位验证码' }]}>
              <Input
                prefix={<SafetyCertificateOutlined />}
                placeholder="6 位验证码"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>验证并登录</Button>
            <Button type="link" block onClick={() => { setChallengeToken(''); setErr('') }}>返回账号密码登录</Button>
          </Form>
        ) : (
          <Form layout="vertical" onFinish={submit}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
          </Form>
        )}
      </Card>
    </div>
  )
}
