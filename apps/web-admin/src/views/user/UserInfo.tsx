import { useState } from 'react'
import { Avatar, Card, Descriptions, Tag, Typography, Button, Modal, Form, Input, Space, message } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getUserDetail, resetUserPassword } from '../../api'

type Detail = Awaited<ReturnType<typeof getUserDetail>>

function statusColor(s: string) {
  return ({ active: 'green', frozen: 'orange', banned: 'red' } as Record<string, string>)[s] ?? 'default'
}
function labelText(l: string) {
  return ({ normal: '普通', arbitrage: '套利客' } as Record<string, string>)[l] ?? l
}
function fmtDate(s: string) { return new Date(s).toLocaleString('zh-CN') }
function fmtBalance(n: number, currency: string) {
  const digits = currency === 'PHP' ? 2 : 6
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

interface Props { detail: Detail; onSuccess?: () => void }

export default function UserInfo({ detail, onSuccess }: Props) {
  const navigate = useNavigate()
  const [resetTarget, setResetTarget] = useState<{ provider: 'phone' | 'account'; label: string } | null>(null)
  const [resetLoading, setResetLoading] = useState(false)
  const [form] = Form.useForm<{ password: string; confirm: string; opPassword: string }>()
  const lookup = (field: 'ip' | 'deviceId' | 'fpVisitor', v: unknown) => {
    const s = v ? String(v) : ''
    return s ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/device-lookup?field=${field}&value=${encodeURIComponent(s)}`)}>{s}</Button> : '-'
  }
  const u = detail.user as Record<string, unknown>
  const avatarUrl = typeof u.avatarUrl === 'string' ? u.avatarUrl : undefined
  const userId = String(u.id ?? '')
  const phone = String(u.phone ?? '')
  const username = String(u.username ?? '')
  const walletBalances = detail.walletBalances?.length
    ? detail.walletBalances
    : [{ currency: 'PHP', available: detail.wallet.available, frozen: detail.wallet.frozen }]

  async function submitResetPassword() {
    if (!resetTarget || !userId) return
    const values = form.getFieldsValue()
    if (!values.password || !values.confirm || !values.opPassword) {
      message.warning('请填写所有字段'); return
    }
    if (values.password.length < 8) {
      message.warning('新密码至少8位'); return
    }
    if (values.password !== values.confirm) {
      message.warning('两次输入的新密码不一致'); return
    }
    setResetLoading(true)
    try {
      await resetUserPassword(userId, resetTarget.provider, values.password, values.opPassword)
      message.success('用户密码已重置')
      setResetTarget(null)
      form.resetFields()
      onSuccess?.()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重置失败')
    } finally {
      setResetLoading(false)
    }
  }

  const passwordIdentity = (provider: 'phone' | 'account', value: string) => value ? (
    <Space>
      <span>{value}</span>
      <Button
        size="small"
        onClick={() => setResetTarget({ provider, label: provider === 'phone' ? 'Phone' : 'Username' })}
      >
        重置密码
      </Button>
    </Space>
  ) : '-'

  return (
    <>
      <Card
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Avatar size={40} src={avatarUrl} icon={<UserOutlined />} />
            基本信息
          </span>
        }
        bordered={false}
        style={{ marginBottom: 16 }}
      >
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="ID">{userId}</Descriptions.Item>
          <Descriptions.Item label="显示名">{String(u.displayName ?? '')}</Descriptions.Item>
          <Descriptions.Item label="洗码等级">
            <Tag color={detail.level === 6 ? 'gold' : 'blue'}>LV{detail.level}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>累计有效流水 ₱{Number(detail.totalTurnover).toFixed(2)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="Email">{String(u.email ?? '') || '-'}</Descriptions.Item>
          <Descriptions.Item label="Telegram">{String(u.telegramUsername ?? u.telegramUserId ?? '') || '-'}</Descriptions.Item>
          <Descriptions.Item label="Google">{String(u.googleEmail ?? u.email ?? '') || '-'}</Descriptions.Item>
          <Descriptions.Item label="Phone">{passwordIdentity('phone', phone)}</Descriptions.Item>
          <Descriptions.Item label="Username">{passwordIdentity('account', username)}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={statusColor(String(u.status ?? ''))}>{String(u.status ?? '')}</Tag></Descriptions.Item>
          <Descriptions.Item label="标记"><Tag color={String(u.label) === 'arbitrage' ? 'red' : 'default'}>{labelText(String(u.label ?? 'normal'))}</Tag></Descriptions.Item>
          <Descriptions.Item label="注册时间">{fmtDate(String(u.registeredAt ?? ''))}</Descriptions.Item>
          <Descriptions.Item label="注册区域">
            <span>{String(u.registerRegion ?? '') || '-'}</span>
            {!!u.registerIp && <span style={{ marginLeft: 6 }}>{lookup('ip', u.registerIp)}</span>}
          </Descriptions.Item>
          <Descriptions.Item label="注册网址/TMA">{String(u.registerEntrySource ?? '') || '-'}</Descriptions.Item>
          <Descriptions.Item label="注册设备">{lookup('deviceId', u.registerDeviceId)}</Descriptions.Item>
          <Descriptions.Item label="最后登录">{u.lastLoginAt ? fmtDate(String(u.lastLoginAt)) : '-'}</Descriptions.Item>
          <Descriptions.Item label="最后登录区域">
            <span>{String(u.lastLoginRegion ?? '') || '-'}</span>
            {!!u.lastLoginIp && <span style={{ marginLeft: 6 }}>{lookup('ip', u.lastLoginIp)}</span>}
          </Descriptions.Item>
          <Descriptions.Item label="余额">
            <Space direction="vertical" size={2}>
              {walletBalances.map((w) => (
                <span key={w.currency}>
                  <Typography.Text strong>{w.currency}</Typography.Text>
                  <span> 可用 {fmtBalance(w.available, w.currency)}</span>
                  {Number(w.frozen) !== 0 && <Typography.Text type="secondary">，冻结 {fmtBalance(w.frozen, w.currency)}</Typography.Text>}
                </span>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Modal
        open={Boolean(resetTarget)}
        title={`重置${resetTarget?.label ?? ''}登录密码`}
        okText="确认重置"
        cancelText="取消"
        confirmLoading={resetLoading}
        onOk={() => void submitResetPassword()}
        onCancel={() => { setResetTarget(null); form.resetFields() }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="新密码" name="password">
            <Input.Password placeholder="至少8位" />
          </Form.Item>
          <Form.Item label="确认新密码" name="confirm">
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
          <Form.Item label="操作密码" name="opPassword">
            <Input.Password placeholder="请输入操作密码" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
