import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, InputNumber, Typography, message } from 'antd'
import { getSystemParams, updateSystemParams } from '../api'
import { useAuthStore } from '../stores/auth'

export default function SystemParams() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [form] = Form.useForm<{ smsDailyLimitPerUser: number }>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      form.setFieldsValue(await getSystemParams())
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function save() {
    const limit = Number(form.getFieldValue('smsDailyLimitPerUser'))
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      message.warning('每日验证码上限必须是 1-1000 的整数'); return
    }
    setSaving(true)
    try {
      form.setFieldsValue(await updateSystemParams({ smsDailyLimitPerUser: limit }))
      message.success('系统参数已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16 }}>
        <h2 style={{ margin: 0 }}>系统参数</h2>
      </div>
      <Card title="验证码参数" bordered={false} loading={loading}>
        {!isSuperAdmin && (
          <Alert message="仅 super_admin 可修改系统参数" type="warning" showIcon style={{ marginBottom: 16 }} />
        )}
        <Form form={form} layout="vertical">
          <Form.Item label="每人每日验证码上限" name="smsDailyLimitPerUser">
            <InputNumber min={1} max={1000} precision={0} style={{ width: 220 }} disabled={!isSuperAdmin} />
          </Form.Item>
          {isSuperAdmin && (
            <Form.Item>
              <Button type="primary" loading={saving} onClick={save}>保存</Button>
            </Form.Item>
          )}
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          适用于 KYC 手机验证、找回密码等所有短信验证码发送。默认 30 次/人/天。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
