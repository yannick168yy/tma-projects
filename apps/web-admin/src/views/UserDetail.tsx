import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Row, Col, Card, Descriptions, Tag, Space, Select, Input, Button, InputNumber,
  Spin, Tabs, Table, Typography, Divider, message,
} from 'antd'
import { getUserDetail, updateUserStatus, updateUserLabel, adjustBalance, updateUserProfile, SUPPORTED_CURRENCIES } from '../api'

type Detail = Awaited<ReturnType<typeof getUserDetail>>

function statusColor(s: string) {
  return ({ active: 'green', frozen: 'orange', banned: 'red' } as Record<string, string>)[s] ?? 'default'
}
function labelText(l: string) {
  return ({ normal: '普通', arbitrage: '套利客' } as Record<string, string>)[l] ?? l
}
function fmtDate(s: string) { return new Date(s).toLocaleString('zh-CN') }
function ledgerTypeColor(t: string) {
  return ({ deposit: 'green', admin_adjust: 'blue', withdraw: 'orange', bet: 'purple', bonus: 'cyan', red_packet: 'magenta' } as Record<string, string>)[t] ?? 'default'
}
function ledgerTypeText(t: string) {
  return ({ deposit: '存款', withdraw: '取款', bet: '投注', win: '中奖', bonus: '奖励', red_packet: '红包', adjust: '调整', admin_adjust: '后台调整' } as Record<string, string>)[t] ?? t
}

export default function UserDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [opLoading, setOpLoading] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [newStatus, setNewStatus] = useState('active')
  const [statusReason, setStatusReason] = useState('')
  const [newLabel, setNewLabel] = useState('normal')
  const [adjustAmount, setAdjustAmount] = useState(0)
  const [adjustCurrency, setAdjustCurrency] = useState('PHP')
  const [adjustNote, setAdjustNote] = useState('')
  const [adjustOpPwd, setAdjustOpPwd] = useState('')
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', gender: '', dobMonth: '', dobDay: '', dobYear: '', phone: '', email: '' })

  async function loadDetail() {
    if (!id) return
    setLoading(true)
    try {
      const data = await getUserDetail(id)
      setDetail(data)
      setNewStatus(String(data.user.status ?? 'active'))
      setNewLabel(String(data.user.label ?? 'normal'))
      const p = (data.user as Record<string, unknown>).profile as Record<string, string> ?? {}
      setProfileForm({
        firstName: p.firstName ?? '', lastName: p.lastName ?? '', gender: p.gender ?? '',
        dobMonth: p.dobMonth ?? '', dobDay: p.dobDay ?? '', dobYear: p.dobYear ?? '',
        phone: p.phone ?? '', email: p.email ?? '',
      })
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadDetail() }, [id])

  async function doUpdateStatus() {
    if (!id) return
    setOpLoading(true)
    try {
      await updateUserStatus(id, newStatus, statusReason || undefined)
      message.success('状态已更新'); await loadDetail()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doUpdateLabel() {
    if (!id) return
    setOpLoading(true)
    try {
      await updateUserLabel(id, newLabel)
      message.success('标记已更新'); await loadDetail()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doAdjust() {
    if (!id) return
    if (!adjustAmount) { message.warning('请填写调整金额'); return }
    if (!adjustOpPwd) { message.warning('请输入操作密码'); return }
    setOpLoading(true)
    try {
      const res = await adjustBalance(id, adjustAmount, adjustOpPwd, adjustCurrency, adjustNote || undefined)
      message.success(`余额已调整，订单: ${res.orderId}，当前 ${adjustCurrency} 余额: ${Number(res.available).toFixed(adjustCurrency === 'PHP' ? 2 : 6)}`)
      setAdjustOpPwd(''); setAdjustAmount(0); setAdjustNote('')
      await loadDetail()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doSaveProfile() {
    if (!id) return
    setOpLoading(true)
    try {
      await updateUserProfile(id, profileForm)
      message.success('个人信息已更新'); await loadDetail()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  const ledgerCols = [
    { title: '类型', dataIndex: 'type', key: 'type', width: 110, render: (t: string) => <Tag color={ledgerTypeColor(t)}>{ledgerTypeText(t)}</Tag> },
    { title: '金额(元)', dataIndex: 'amount', key: 'amount', width: 100, render: (v: number) => <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f' }}>{v > 0 ? '+' : ''}{v}</span> },
    { title: '余额(元)', dataIndex: 'balanceAfter', key: 'balanceAfter', width: 100 },
    { title: '描述', dataIndex: 'description', key: 'desc' },
    { title: '时间', dataIndex: 'createdAt', key: 'at', width: 160, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]
  const loginCols = [
    { title: '登录方式', dataIndex: 'authMethod', key: 'method', width: 90 },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 120, render: (v: string | null) => v || '-' },
    { title: '区域', dataIndex: 'region', key: 'region', width: 130, render: (v: string | null) => v || '-' },
    { title: 'User-Agent', dataIndex: 'userAgent', key: 'ua', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', key: 'at', width: 160, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]
  const betCols = [
    { title: '类型', dataIndex: 'betType', key: 'type', width: 80 },
    { title: '金额(元)', dataIndex: 'amount', key: 'amt', width: 100 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80 },
    { title: 'Round ID', dataIndex: 'roundId', key: 'round', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', key: 'at', width: 160, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ]

  const u = detail?.user as Record<string, unknown> | undefined

  return (
    <div>
      <div style={{ background: '#fff', marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={() => navigate(-1)}>返回</Button>
        <span style={{ fontWeight: 600, fontSize: 16 }}>用户详情</span>
      </div>
      <Spin spinning={loading}>
        {detail && (
          <Row gutter={16}>
            <Col span={12}>
              <Card title="基本信息" bordered={false} style={{ marginBottom: 16 }}>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="ID">{String(u?.id ?? '')}</Descriptions.Item>
                  <Descriptions.Item label="显示名">{String(u?.displayName ?? '')}</Descriptions.Item>
                  <Descriptions.Item label="Email">{String(u?.email ?? '') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="TG用户名">{String(u?.telegramUsername ?? '') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="状态"><Tag color={statusColor(String(u?.status ?? ''))}>{String(u?.status ?? '')}</Tag></Descriptions.Item>
                  <Descriptions.Item label="标记"><Tag color={String(u?.label) === 'arbitrage' ? 'red' : 'default'}>{labelText(String(u?.label ?? 'normal'))}</Tag></Descriptions.Item>
                  <Descriptions.Item label="注册时间">{fmtDate(String(u?.registeredAt ?? ''))}</Descriptions.Item>
                  <Descriptions.Item label="注册区域">
                    <span>{String(u?.registerRegion ?? '') || '-'}</span>
                    {!!u?.registerIp && <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{String(u.registerIp)}</Typography.Text>}
                  </Descriptions.Item>
                  <Descriptions.Item label="最后登录">{u?.lastLoginAt ? fmtDate(String(u.lastLoginAt)) : '-'}</Descriptions.Item>
                  <Descriptions.Item label="最后登录区域">
                    <span>{String(u?.lastLoginRegion ?? '') || '-'}</span>
                    {!!u?.lastLoginIp && <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{String(u.lastLoginIp)}</Typography.Text>}
                  </Descriptions.Item>
                  <Descriptions.Item label="余额">₱{Number(detail.wallet.available).toFixed(2)}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="管理操作" bordered={false} style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>修改状态</div>
                    <Space>
                      <Select value={newStatus} style={{ width: 120 }} onChange={setNewStatus} options={[
                        { value: 'active', label: '活跃' },
                        { value: 'frozen', label: '冻结' },
                        { value: 'banned', label: '封禁' },
                      ]} />
                      <Input value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="原因（可选）" style={{ width: 200 }} />
                      <Button type="primary" loading={opLoading} onClick={doUpdateStatus}>确认</Button>
                    </Space>
                  </div>
                  <Divider />
                  <div>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>用户标记</div>
                    <Space>
                      <Select value={newLabel} style={{ width: 150 }} onChange={setNewLabel} options={[
                        { value: 'normal', label: '普通' },
                        { value: 'arbitrage', label: '套利客' },
                      ]} />
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
                            label: c === 'TRX_TESTNET'
                              ? <span>TRX <sup style={{ color: '#faad14', fontSize: 10, fontWeight: 700 }}>TEST</sup></span>
                              : c,
                          }))}
                        />
                        <InputNumber
                          value={adjustAmount}
                          onChange={(v) => setAdjustAmount(v ?? 0)}
                          step={adjustCurrency === 'PHP' ? 1 : 0.000001}
                          precision={adjustCurrency === 'PHP' ? 2 : 6}
                          style={{ width: 160 }}
                          placeholder="金额"
                        />
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
            </Col>

            <Col span={24}>
              <Card title="个人信息编辑" bordered={false} style={{ marginBottom: 16 }}>
                <Row gutter={12}>
                  {[
                    { label: '名字', key: 'firstName', placeholder: 'First Name', span: 6 },
                    { label: '姓氏', key: 'lastName', placeholder: 'Last Name', span: 6 },
                  ].map(({ label, key, placeholder, span }) => (
                    <Col key={key} span={span}>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>{label}</div>
                        <Input value={profileForm[key as keyof typeof profileForm]} onChange={(e) => setProfileForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} />
                      </div>
                    </Col>
                  ))}
                  <Col span={4}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>性别</div>
                      <Select value={profileForm.gender} style={{ width: '100%' }} onChange={(v) => setProfileForm(p => ({ ...p, gender: v }))} options={[
                        { value: '', label: '未填' }, { value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '其他' },
                      ]} />
                    </div>
                  </Col>
                  {[
                    { label: '出生年份', key: 'dobYear', placeholder: 'YYYY', span: 4 },
                    { label: '月', key: 'dobMonth', placeholder: 'MM', span: 2 },
                    { label: '日', key: 'dobDay', placeholder: 'DD', span: 2 },
                    { label: '手机', key: 'phone', placeholder: 'Phone', span: 6 },
                    { label: '邮箱', key: 'email', placeholder: 'Email', span: 6 },
                  ].map(({ label, key, placeholder, span }) => (
                    <Col key={key} span={span}>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>{label}</div>
                        <Input value={profileForm[key as keyof typeof profileForm]} onChange={(e) => setProfileForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} />
                      </div>
                    </Col>
                  ))}
                </Row>
                <Button type="primary" loading={opLoading} onClick={doSaveProfile}>保存个人信息</Button>
              </Card>
            </Col>

            <Col span={24}>
              <Card bordered={false} style={{ marginBottom: 16 }}>
                <Tabs items={[
                  { key: 'ledger', label: '账变记录', children: <Table columns={ledgerCols} dataSource={detail.ledger as object[]} rowKey="id" pagination={false} size="small" /> },
                  { key: 'login', label: `登录记录 (${detail.loginLogs.length})`, children: <Table columns={loginCols} dataSource={detail.loginLogs} rowKey="id" pagination={false} size="small" /> },
                  { key: 'bets', label: `游戏记录 (${detail.betOrders.length})`, children: <Table columns={betCols} dataSource={detail.betOrders} rowKey="id" pagination={false} size="small" /> },
                ]} />
              </Card>
            </Col>
          </Row>
        )}
      </Spin>
    </div>
  )
}
