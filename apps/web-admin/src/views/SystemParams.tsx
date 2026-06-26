import { useEffect, useState } from 'react'
import { Alert, Button, Card, InputNumber, Table, Typography, message } from 'antd'
import { getSystemParams, updateSystemParams } from '../api'
import { useAuthStore } from '../stores/auth'

type ParamKey = 'smsDailyLimitPerUser' | 'smsDailyLimitPerIp' | 'otpLockSeconds'

interface ParamRow {
  key: ParamKey
  name: string
  description: string
  value: number
  max: number
}

export default function SystemParams() {
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'
  const [rows, setRows] = useState<ParamRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const params = await getSystemParams()
      setRows([
        {
          key: 'smsDailyLimitPerUser',
          name: '每人每日验证码上限',
          description: '适用于 KYC 手机验证、找回密码等所有短信验证码发送。默认 30 次/人/天。',
          value: params.smsDailyLimitPerUser,
          max: 1000,
        },
        {
          key: 'smsDailyLimitPerIp',
          name: '每 IP 每日验证码上限',
          description: '限制同一 IP 每天可发送的验证码总数。默认 100 次/IP/天。',
          value: params.smsDailyLimitPerIp,
          max: 10000,
        },
        {
          key: 'otpLockSeconds',
          name: '验证码错误锁定时长',
          description: '验证码连续输错 3 次后锁定验证方式的秒数。默认 60 秒。',
          value: params.otpLockSeconds,
          max: 3600,
        },
      ])
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function updateValue(key: ParamKey, value: number | null) {
    setRows((items) => items.map((item) => (item.key === key ? { ...item, value: Number(value ?? 0) } : item)))
  }

  async function save() {
    const next = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<ParamKey, number>
    for (const row of rows) {
      if (!Number.isInteger(row.value) || row.value < 1 || row.value > row.max) {
        message.warning(`${row.name}必须是 1-${row.max} 的整数`); return
      }
    }
    setSaving(true)
    try {
      const saved = await updateSystemParams(next)
      setRows((items) => items.map((item) => ({ ...item, value: saved[item.key] })))
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
        <Table<ParamRow>
          rowKey="key"
          pagination={false}
          dataSource={rows}
          columns={[
            { title: '参数', dataIndex: 'name', width: 240 },
            { title: '说明', dataIndex: 'description' },
            {
              title: '值',
              dataIndex: 'value',
              width: 220,
              render: (value: number, row) => (
                <InputNumber
                  min={1}
                  max={row.max}
                  precision={0}
                  value={value}
                  disabled={!isSuperAdmin}
                  style={{ width: 160 }}
                  onChange={(next) => updateValue(row.key, next)}
                />
              ),
            },
          ]}
        />
        {isSuperAdmin && <Button type="primary" loading={saving} onClick={save} style={{ marginTop: 16 }}>保存</Button>}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          计数按菲律宾时间自然日重置。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
