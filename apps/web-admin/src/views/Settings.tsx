import { useEffect, useState } from 'react'
import { Row, Col, Card, Descriptions, Badge, Form, Input, Button, Alert, Typography, message, QRCode, Space, Modal, Switch } from 'antd'
import {
  cancelAdminTotpSetup,
  disableAdminTotp,
  enableAdminTotp,
  getAdminTotpStatus,
  getOpPasswordStatus,
  getWin568KeyRotationSettings,
  setOpPassword,
  setupAdminTotp,
  updateWin568KeyRotationSettings,
  type AdminTotpSetup,
  type AdminTotpStatus,
} from '../api'
import { useAuthStore } from '../stores/auth'

export default function Settings() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [opPwdConfigured, setOpPwdConfigured] = useState(false)
  const [totpStatus, setTotpStatus] = useState<AdminTotpStatus>({ enabled: false, confirmedAt: null })
  const [totpSetup, setTotpSetup] = useState<AdminTotpSetup | null>(null)
  const [win568KeyRotationEnabled, setWin568KeyRotationEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [totpLoading, setTotpLoading] = useState(false)
  const [win568KeyRotationSaving, setWin568KeyRotationSaving] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [form] = Form.useForm<{ current: string; newPwd: string; confirm: string }>()
  const [totpForm] = Form.useForm<{ code: string }>()
  const [disableForm] = Form.useForm<{ code: string }>()

  async function loadStatus() {
    try {
      const [op, totp, win568KeyRotation] = await Promise.all([getOpPasswordStatus(), getAdminTotpStatus(), getWin568KeyRotationSettings()])
      setOpPwdConfigured(op.configured)
      setTotpStatus(totp)
      setWin568KeyRotationEnabled(win568KeyRotation.enabled)
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

  async function startTotpSetup() {
    setTotpLoading(true)
    try {
      const res = await setupAdminTotp()
      setTotpSetup(res)
      totpForm.resetFields()
      message.success(totpStatus.enabled ? '已生成新的验证器二维码' : '已生成验证器二维码')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '生成失败')
    } finally { setTotpLoading(false) }
  }

  async function confirmTotpSetup() {
    const code = totpForm.getFieldValue('code')
    if (!/^\d{6}$/.test(String(code ?? ''))) { message.warning('请输入 6 位验证码'); return }
    setTotpLoading(true)
    try {
      await enableAdminTotp(code)
      message.success(totpStatus.enabled ? 'Google Authenticator 已重置' : 'Google Authenticator 已开启')
      setTotpSetup(null)
      await loadStatus()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '验证失败')
    } finally { setTotpLoading(false) }
  }

  async function cancelTotpSetup() {
    try { await cancelAdminTotpSetup() } catch { /* ignore */ }
    setTotpSetup(null)
    totpForm.resetFields()
  }

  async function confirmDisableTotp() {
    const code = disableForm.getFieldValue('code')
    if (totpStatus.enabled && !/^\d{6}$/.test(String(code ?? ''))) { message.warning('请输入 6 位验证码'); return }
    setTotpLoading(true)
    try {
      await disableAdminTotp(code)
      message.success('Google Authenticator 已取消')
      setDisableOpen(false)
      disableForm.resetFields()
      setTotpSetup(null)
      await loadStatus()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消失败')
    } finally { setTotpLoading(false) }
  }

  async function toggleWin568KeyRotation(enabled: boolean) {
    setWin568KeyRotationSaving(true)
    try {
      const saved = await updateWin568KeyRotationSettings(enabled)
      setWin568KeyRotationEnabled(saved.enabled)
      message.success(saved.enabled ? '568Win 金钥自动轮换已开启' : '568Win 金钥自动轮换已关闭')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally { setWin568KeyRotationSaving(false) }
  }

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16 }}>
        <h2 style={{ margin: 0 }}>管理员与权限</h2>
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
        <Col span={12}>
          <Card title="Google Authenticator" bordered={false}>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                {totpStatus.enabled
                  ? <Badge status="success" text="已开启" />
                  : <Badge status="warning" text="未开启" />
                }
              </Descriptions.Item>
              {totpStatus.confirmedAt && (
                <Descriptions.Item label="开启时间">{new Date(totpStatus.confirmedAt).toLocaleString()}</Descriptions.Item>
              )}
            </Descriptions>

            {!totpSetup && (
              <Space>
                <Button type="primary" loading={totpLoading} onClick={startTotpSetup}>
                  {totpStatus.enabled ? '重置验证器' : '开启验证器'}
                </Button>
                {totpStatus.enabled && (
                  <Button danger loading={totpLoading} onClick={() => setDisableOpen(true)}>取消验证器</Button>
                )}
              </Space>
            )}

            {totpSetup && (
              <div>
                <Alert
                  type="info"
                  showIcon
                  message="请用 Google Authenticator 扫描二维码，再输入 6 位验证码确认。确认前不会开启或替换当前验证器。"
                  style={{ marginBottom: 16 }}
                />
                <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                  <QRCode value={totpSetup.otpauthUri} size={180} />
                  <div style={{ minWidth: 220 }}>
                    <Typography.Text type="secondary">手动密钥</Typography.Text>
                    <Typography.Paragraph copyable style={{ fontSize: 18, letterSpacing: 1, marginTop: 8 }}>
                      {totpSetup.secret}
                    </Typography.Paragraph>
                    <Form form={totpForm} layout="vertical">
                      <Form.Item label="验证码" name="code">
                        <Input placeholder="6 位验证码" maxLength={6} />
                      </Form.Item>
                    </Form>
                    <Space>
                      <Button type="primary" loading={totpLoading} onClick={confirmTotpSetup}>确认开启</Button>
                      <Button onClick={cancelTotpSetup}>取消</Button>
                    </Space>
                  </div>
                </div>
              </div>
            )}

            <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
              开启后，该管理员账号每次登录后台都需要输入 Google Authenticator 动态验证码。
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="568Win 金钥自动轮换" bordered={false}>
            {!isSuperAdmin && (
              <Alert message="仅 super_admin 可修改 568Win 金钥自动轮换开关" type="warning" showIcon style={{ marginBottom: 16 }} />
            )}
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                {win568KeyRotationEnabled
                  ? <Badge status="success" text="已开启" />
                  : <Badge status="default" text="已关闭" />
                }
              </Descriptions.Item>
            </Descriptions>
            <Space>
              <Switch
                checked={win568KeyRotationEnabled}
                loading={win568KeyRotationSaving}
                disabled={!isSuperAdmin}
                checkedChildren="开启"
                unCheckedChildren="关闭"
                onChange={toggleWin568KeyRotation}
              />
              <Typography.Text type="secondary">
                开启后，系统会每天检查 568Win Company Key，到期前自动生成并切换新 key。
              </Typography.Text>
            </Space>
          </Card>
        </Col>
        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="HTTPS 证书" bordered={false}>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="证书机构">Let's Encrypt</Descriptions.Item>
              <Descriptions.Item label="有效期">90 天</Descriptions.Item>
              <Descriptions.Item label="自动续期">
                <Badge status="success" text="已启用（到期前自动续期）" />
              </Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              站点 HTTPS 证书由 Let's Encrypt 签发，有效期 90 天，系统已配置在到期前自动续期，无需人工干预。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
      <Modal
        title="取消 Google Authenticator"
        open={disableOpen}
        confirmLoading={totpLoading}
        onOk={confirmDisableTotp}
        onCancel={() => setDisableOpen(false)}
        okText="确认取消"
        okButtonProps={{ danger: true }}
      >
        <Alert type="warning" showIcon message="取消后，该管理员账号登录后台将不再要求动态验证码。" style={{ marginBottom: 16 }} />
        <Form form={disableForm} layout="vertical">
          <Form.Item label="当前验证码" name="code">
            <Input placeholder="6 位验证码" maxLength={6} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
