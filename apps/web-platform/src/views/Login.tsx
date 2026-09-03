import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { platformLogin } from '../api'
import { useAuthStore } from '../stores/auth'

export default function Login() {
  const nav = useNavigate()
  const signIn = useAuthStore((s) => s.signIn)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(values: { username: string; password: string }) {
    setErr('')
    setLoading(true)
    try {
      const res = await platformLogin(values.username, values.password)
      signIn(res.token, res.role, res.username)
      nav('/tenants', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f0f2f5' }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ textAlign: 'center', marginBottom: 4 }}>BetoGo 平台控制台</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>包网运营商管理</Typography.Paragraph>
        {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
        <Form layout="vertical" onFinish={submit}>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
        </Form>
      </Card>
    </div>
  )
}
