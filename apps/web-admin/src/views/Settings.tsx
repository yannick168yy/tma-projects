import { useEffect, useState } from 'react'
import { Row, Col, Card, Descriptions, Badge, Form, Input, Button, Alert, Typography, message } from 'antd'
import { getOpPasswordStatus, setOpPassword } from '../api'
import { useAuthStore } from '../stores/auth'

export default function Settings() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [opPwdConfigured, setOpPwdConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<{ current: string; newPwd: string; confirm: string }>()

  async function loadStatus() {
    try {
      const res = await getOpPasswordStatus()
      setOpPwdConfigured(res.configured)
    } catch { /* ignore */ }
  }

  useEffect(() => { void loadStatus() }, [])

  async function handleSave() {
    const values = form.getFieldsValue()
    if (!values.newPwd || values.newPwd.length < 6) { message.warning('新密码至少6位'); return }
    if (values.newPwd !== values.confirm) { message.warning('两次输入的密码不一致'); return }
    if (opPwdConfigured && !values.current) { message.warning('请输入当前操作密码'); return }
    setSaving(true)
    try {
      await setOpPassword(values.newPwd, opPwdConfigured ? values.current : undefined)
      message.success(opPwdConfigured ? '操作密码已修改' : '操作密码已设置')
      form.resetFields()
      await loadStatus()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16 }}>
        <h2 style={{ margin: 0 }}>系统设置</h2>
      </div>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="操作密码管理" bordered={false}>
            {!isSuperAdmin && (
              <Alert message="仅 super_admin 可修改操作密码" type="warning" showIcon style={{ marginBottom: 16 }} />
            )}
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                {opPwdConfigured
                  ? <Badge status="success" text="已设置" />
                  : <Badge status="warning" text="未设置" />
                }
              </Descriptions.Item>
            </Descriptions>
            {isSuperAdmin && (
              <Form form={form} layout="vertical">
                {opPwdConfigured && (
                  <Form.Item label="当前操作密码" name="current">
                    <Input.Password placeholder="请输入当前操作密码" />
                  </Form.Item>
                )}
                <Form.Item label="新操作密码" name="newPwd">
                  <Input.Password placeholder="至少6位" />
                </Form.Item>
                <Form.Item label="确认新密码" name="confirm">
                  <Input.Password placeholder="再次输入新密码" />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" loading={saving} onClick={handleSave}>
                    {opPwdConfigured ? '修改操作密码' : '设置操作密码'}
                  </Button>
                </Form.Item>
              </Form>
            )}
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              操作密码用于保护高风险操作（如余额调整）。调整用户余额时需输入此密码验证身份。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
