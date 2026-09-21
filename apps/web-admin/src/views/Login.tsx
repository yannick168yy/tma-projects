import { useEffect, useState } from 'react'
import { SITE_TITLE } from '../site'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message, Popover, Space } from 'antd'
import { UserOutlined, LockOutlined, SafetyCertificateOutlined, KeyOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/auth'
import { adminCaptcha, adminLogin, adminLoginTotp, type AdminCaptcha } from '../api'

export default function Login() {
  const navigate = useNavigate()
  const { setSession } = useAuthStore()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [challengeToken, setChallengeToken] = useState('')
  // 是否需要验证码由服务端按租户判断，前端不自己看域名 —— 免得判断口径和后端不一致
  const [captcha, setCaptcha] = useState<Extract<AdminCaptcha, { required: true }> | null>(null)

  async function refreshCaptcha() {
    try {
      const res = await adminCaptcha()
      setCaptcha(res.required ? res : null)
    } catch {
      setCaptcha(null)
    }
    form.resetFields(['captchaCode'])
  }

  useEffect(() => { void refreshCaptcha() }, [])

  async function handleLogin(values: { username: string; password: string; accessCode?: string; captchaCode?: string }) {
    setLoading(true)
    try {
      const res = await adminLogin(
        values.username,
        values.password,
        values.accessCode,
        captcha ? { captchaId: captcha.captchaId, captchaCode: values.captchaCode ?? '' } : undefined,
      )
      if ('requiresTotp' in res && res.requiresTotp) {
        setChallengeToken(res.challengeToken)
        message.info('请输入 Google Authenticator 验证码')
        return
      }
      setSession(res.token, res.role)
      if ('totpSetupRequired' in res && res.totpSetupRequired) {
        message.warning('该角色必须开启 Google Authenticator，请先完成绑定')
        navigate('/settings')
        return
      }
      message.success('登录成功')
      navigate('/dashboard')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
      // 验证码一次性消费，无论哪种失败旧图都已作废，必须换一张
      if (captcha) await refreshCaptcha()
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
      <Card title={SITE_TITLE} style={{ width: 380 }}>
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
          <Form form={form} onFinish={handleLogin} layout="vertical">
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
            </Form.Item>
            {captcha && (
              <Form.Item name="accessCode" rules={[{ required: true, message: '请输入访问码' }]}>
                <Input
                  prefix={<KeyOutlined />}
                  placeholder="联系管理员获取"
                  size="large"
                  maxLength={4}
                  autoComplete="off"
                  style={{ textTransform: 'uppercase' }}
                  suffix={
                    <Popover
                      trigger="click"
                      title="联系管理员获取访问码"
                      content={
                        <Space direction="vertical" size={8}>
                          <a href="https://t.me/betogo777" target="_blank" rel="noreferrer">@betogo777</a>
                          <a href="https://t.me/betogoop" target="_blank" rel="noreferrer">@betogoop</a>
                          <a href="https://t.me/xinxiangshicheng66" target="_blank" rel="noreferrer">@xinxiangshicheng66</a>
                        </Space>
                      }
                    >
                      <QuestionCircleOutlined
                        title="联系管理员"
                        onClick={(event) => event.stopPropagation()}
                        style={{ color: '#1677ff', cursor: 'pointer' }}
                      />
                    </Popover>
                  }
                />
              </Form.Item>
            )}
            {captcha && (
              <Form.Item name="captchaCode" rules={[{ required: true, message: '请输入验证码' }]}>
                <Input
                  prefix={<SafetyCertificateOutlined />}
                  placeholder="验证码"
                  size="large"
                  maxLength={4}
                  autoComplete="off"
                  suffix={
                    <img
                      src={captcha.image}
                      alt="验证码"
                      title="点击换一张"
                      onClick={() => void refreshCaptcha()}
                      style={{ height: 34, cursor: 'pointer', marginRight: -8 }}
                    />
                  }
                />
              </Form.Item>
            )}
            <Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>登录</Button>
            </Form.Item>
          </Form>
        )}
      </Card>
    </div>
  )
}
