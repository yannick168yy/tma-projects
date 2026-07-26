import { useEffect, useState } from 'react'
import { Card, Space, Select, Input, Button, InputNumber, Divider, Typography, message } from 'antd'
import { updateUserStatus, updateUserLabel, adjustBalance, SUPPORTED_CURRENCIES } from '../../api'

interface Props {
  userId: string
  currentStatus: string
  currentLabel: string
  onSuccess: () => void
}

export default function UserActions({ userId, currentStatus, currentLabel, onSuccess }: Props) {
  const [newStatus, setNewStatus] = useState(currentStatus)
  const [statusReason, setStatusReason] = useState('')
  const [newLabel, setNewLabel] = useState(currentLabel)
  const [adjustAmount, setAdjustAmount] = useState(0)
  const [adjustCurrency, setAdjustCurrency] = useState('PHP')
  const [adjustNote, setAdjustNote] = useState('')
  const [adjustOpPwd, setAdjustOpPwd] = useState('')
  const [opLoading, setOpLoading] = useState(false)

  useEffect(() => { setNewStatus(currentStatus) }, [currentStatus])
  useEffect(() => { setNewLabel(currentLabel) }, [currentLabel])

  async function doUpdateStatus() {
    setOpLoading(true)
    try {
      await updateUserStatus(userId, newStatus, statusReason || undefined)
      message.success('状态已更新'); onSuccess()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doUpdateLabel() {
    setOpLoading(true)
    try {
      await updateUserLabel(userId, newLabel)
      message.success('标记已更新'); onSuccess()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doAdjust() {
    if (!adjustAmount) { message.warning('请填写调整金额'); return }
    if (!adjustOpPwd) { message.warning('请输入操作密码'); return }
    setOpLoading(true)
    try {
      const res = await adjustBalance(userId, adjustAmount, adjustOpPwd, adjustCurrency, adjustNote || undefined)
      message.success(`余额已调整，订单: ${res.orderId}，当前 ${adjustCurrency} 余额: ${Number(res.available).toFixed(adjustCurrency === 'PHP' ? 2 : 6)}`)
      setAdjustOpPwd(''); setAdjustAmount(0); setAdjustNote('')
      onSuccess()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  return (
    <Card title="管理操作" bordered={false} style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>修改状态</div>
          <Space>
            <Select value={newStatus} style={{ width: 120 }} onChange={setNewStatus} options={[{ value: 'active', label: '活跃' }, { value: 'frozen', label: '冻结' }, { value: 'banned', label: '封禁' }]} />
            <Input value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="原因（可选）" style={{ width: 200 }} />
            <Button type="primary" loading={opLoading} onClick={doUpdateStatus}>确认</Button>
          </Space>
        </div>
        <Divider />
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>用户标记</div>
          <Space>
            <Select value={newLabel} style={{ width: 150 }} onChange={setNewLabel} options={[{ value: 'normal', label: '普通' }, { value: 'arbitrage', label: '套利客' }, { value: 'test', label: '测试' }]} />
            <Button loading={opLoading} onClick={doUpdateLabel}>确认</Button>
          </Space>
        </div>
        <Divider />
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>调整余额（正加负减）</div>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
              <Select
                value={adjustCurrency}
                style={{ width: 160 }}
                onChange={setAdjustCurrency}
                options={SUPPORTED_CURRENCIES.map((c) => ({
                  value: c,
                  label: c === 'TRX_TESTNET' ? <span>TRX <sup style={{ color: '#faad14', fontSize: 10, fontWeight: 700 }}>TEST</sup></span> : c,
                }))}
              />
              <InputNumber value={adjustAmount} onChange={(v) => setAdjustAmount(v ?? 0)} step={adjustCurrency === 'PHP' ? 1 : 0.000001} precision={adjustCurrency === 'PHP' ? 2 : 6} style={{ width: 160 }} placeholder="金额" />
              <Input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="备注" style={{ width: 200 }} />
            </Space>
            <Space>
              <Input.Password value={adjustOpPwd} onChange={(e) => setAdjustOpPwd(e.target.value)} placeholder="操作密码" style={{ width: 180 }} />
              <Button type="primary" loading={opLoading} onClick={doAdjust}>确认调整</Button>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>操作密码由 super_admin 在「系统设置」中管理</Typography.Text>
          </Space>
        </div>
      </Space>
    </Card>
  )
}
