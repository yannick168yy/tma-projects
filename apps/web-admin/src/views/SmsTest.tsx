import { useCallback, useEffect, useState } from 'react'
import { Card, Alert, Typography, message, Switch, Table, Tag, Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { getSmsSettings, updateSmsSettings, getSmsSendLogs, type SmsSendLogEntry } from '../api'
import { useAuthStore } from '../stores/auth'

const SCENE_LABELS: Record<string, string> = {
  kyc_otp: 'KYC 手机验证',
}

export default function SmsTest() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [smsTestMode, setSmsTestMode] = useState(false)
  const [smsToggling, setSmsToggling] = useState(false)
  const [smsLogs, setSmsLogs] = useState<SmsSendLogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  const loadSms = useCallback(async () => {
    setLogsLoading(true)
    try {
      const [settings, logs] = await Promise.all([getSmsSettings(), getSmsSendLogs()])
      setSmsTestMode(settings.testMode)
      setSmsLogs(logs)
    } catch { /* ignore */ }
    finally { setLogsLoading(false) }
  }, [])

  useEffect(() => {
    void loadSms()
    const id = setInterval(() => { void loadSms() }, 10_000)
    return () => clearInterval(id)
  }, [loadSms])

  async function onSmsTestModeChange(checked: boolean) {
    setSmsToggling(true)
    try {
      const res = await updateSmsSettings(checked)
      setSmsTestMode(res.testMode)
      message.success(checked ? '已开启短信测试模式' : '已关闭短信测试模式')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally { setSmsToggling(false) }
  }

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16 }}>
        <h2 style={{ margin: 0 }}>短信测试</h2>
      </div>
      <Card
        title="测试模式"
        bordered={false}
        extra={
          <Switch
            checked={smsTestMode}
            checkedChildren="测试"
            unCheckedChildren="正式"
            loading={smsToggling}
            disabled={!isSuperAdmin}
            onChange={(v) => void onSmsTestModeChange(v)}
          />
        }
      >
        {!isSuperAdmin && (
          <Alert message="仅 super_admin 可切换短信测试模式" type="warning" showIcon style={{ marginBottom: 16 }} />
        )}
        {smsTestMode && (
          <Alert
            message="当前不会真实发送短信，验证码仅在下方记录中可见"
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          开启后全局跳过短信网关（TeleSMS），OTP 仍写入 Redis，用户验证流程不变。适用于测试环境调试 KYC 等短信场景。
        </Typography.Paragraph>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Typography.Text strong>最近发送记录</Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} loading={logsLoading} onClick={() => void loadSms()}>
            刷新
          </Button>
        </div>
        <Table<SmsSendLogEntry>
          size="small"
          rowKey="id"
          loading={logsLoading}
          dataSource={smsLogs}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 170,
              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
            },
            {
              title: '场景',
              dataIndex: 'scene',
              width: 120,
              render: (v: string) => SCENE_LABELS[v] ?? v,
            },
            { title: '用户', dataIndex: 'userId', width: 100 },
            { title: '手机号', dataIndex: 'phone', width: 140 },
            {
              title: '验证码',
              dataIndex: 'code',
              width: 90,
              render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
            },
            {
              title: '短信内容',
              dataIndex: 'text',
              ellipsis: true,
            },
            {
              title: '状态',
              dataIndex: 'mocked',
              width: 100,
              render: (mocked: boolean) => (
                mocked
                  ? <Tag color="orange">测试跳过</Tag>
                  : <Tag color="green">真实发送</Tag>
              ),
            },
          ]}
          locale={{ emptyText: '暂无发送记录' }}
        />
      </Card>
    </div>
  )
}
