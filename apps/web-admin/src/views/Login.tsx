import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/auth'
import { adminLogin, adminLoginTotp } from '../api'

export default function Login() {
  const navigate = useNavigate()
  const { setSession } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [challengeToken, setChallengeToken] = useState('')

  async function handleLogin(values: { username: string; password: string }) {
    setLoading(true)
    try {
      const res = await adminLogin(values.username, values.password)
      if ('requiresTotp' in res && res.requiresTotp) {
        setChallengeToken(res.challengeToken)
        message.info('请输入 Google Authenticator 验证码')
        return
      }
      setSession(res.token, res.role)
      message.success('登录成功')
      navigate('/dashboard')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleTotp(values: { code: string }) {
    setLoading(true)
    try {
      const res = await adminLoginTotp(challengeToken, values.code)
      setSession(res.token, res.role)
      message.success('登录成功')
      navigate('/dashboard')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '验证失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <Card title="BetoGo 管理后台" style={{ width: 380 }}>
        {challengeToken ? (
          <Form onFinish={handleTotp} layout="vertical">
            <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]}>
              <Input prefix={<SafetyCertificateOutlined />} placeholder="6 位验证码" size="large" maxLength={6} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>验证并登录</Button>
            </Form.Item>
            <Button type="link" block onClick={() => setChallengeToken('')}>返回账号密码登录</Button>
          </Form>
        ) : (
          <Form onFinish={handleLogin} layout="vertical">
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>登录</Button>
            </Form.Item>
          </Form>
        )}
      </Card>
    </div>
  )
}
