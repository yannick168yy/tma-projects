import { Avatar, Card, Descriptions, Tag, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { getUserDetail } from '../../api'

type Detail = Awaited<ReturnType<typeof getUserDetail>>

function statusColor(s: string) {
  return ({ active: 'green', frozen: 'orange', banned: 'red' } as Record<string, string>)[s] ?? 'default'
}
function labelText(l: string) {
  return ({ normal: '普通', arbitrage: '套利客' } as Record<string, string>)[l] ?? l
}
function fmtDate(s: string) { return new Date(s).toLocaleString('zh-CN') }

interface Props { detail: Detail }

export default function UserInfo({ detail }: Props) {
  const u = detail.user as Record<string, unknown>
  const avatarUrl = typeof u.avatarUrl === 'string' ? u.avatarUrl : undefined
  return (
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
        <Descriptions.Item label="ID">{String(u.id ?? '')}</Descriptions.Item>
        <Descriptions.Item label="显示名">{String(u.displayName ?? '')}</Descriptions.Item>
        <Descriptions.Item label="洗码等级">
          <Tag color={detail.level === 6 ? 'gold' : 'blue'}>LV{detail.level}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>累计有效流水 ₱{Number(detail.totalTurnover).toFixed(2)}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Email">{String(u.email ?? '') || '-'}</Descriptions.Item>
        <Descriptions.Item label="Telegram">{String(u.telegramUsername ?? u.telegramUserId ?? '') || '-'}</Descriptions.Item>
        <Descriptions.Item label="Google">{String(u.googleEmail ?? u.email ?? '') || '-'}</Descriptions.Item>
        <Descriptions.Item label="Phone">{String(u.phone ?? '') || '-'}</Descriptions.Item>
        <Descriptions.Item label="Username">{String(u.username ?? '') || '-'}</Descriptions.Item>
        <Descriptions.Item label="状态"><Tag color={statusColor(String(u.status ?? ''))}>{String(u.status ?? '')}</Tag></Descriptions.Item>
        <Descriptions.Item label="标记"><Tag color={String(u.label) === 'arbitrage' ? 'red' : 'default'}>{labelText(String(u.label ?? 'normal'))}</Tag></Descriptions.Item>
        <Descriptions.Item label="注册时间">{fmtDate(String(u.registeredAt ?? ''))}</Descriptions.Item>
        <Descriptions.Item label="注册区域">
          <span>{String(u.registerRegion ?? '') || '-'}</span>
          {!!u.registerIp && <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{String(u.registerIp)}</Typography.Text>}
        </Descriptions.Item>
        <Descriptions.Item label="注册设备">{String(u.registerDeviceId ?? '') || '-'}</Descriptions.Item>
        <Descriptions.Item label="最后登录">{u.lastLoginAt ? fmtDate(String(u.lastLoginAt)) : '-'}</Descriptions.Item>
        <Descriptions.Item label="最后登录区域">
          <span>{String(u.lastLoginRegion ?? '') || '-'}</span>
          {!!u.lastLoginIp && <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{String(u.lastLoginIp)}</Typography.Text>}
        </Descriptions.Item>
        <Descriptions.Item label="余额">₱{Number(detail.wallet.available).toFixed(2)}</Descriptions.Item>
      </Descriptions>
    </Card>
  )
}
