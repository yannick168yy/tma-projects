import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Layout, Menu, Dropdown, Button, Modal, Form, Input, message,
} from 'antd'
import {
  DashboardOutlined, TeamOutlined, ArrowDownOutlined, ArrowUpOutlined,
  FileTextOutlined, UserOutlined, DownOutlined, AppstoreOutlined, SettingOutlined,
  CustomerServiceOutlined, BookOutlined, SwapOutlined, TransactionOutlined,
  ReconciliationOutlined, ApartmentOutlined, GiftOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/auth'
import { adminChangePassword } from '../api'

const { Sider, Header, Content } = Layout

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '数据概览' },
  { key: '/users', icon: <TeamOutlined />, label: '用户管理' },
  { key: '/deposits', icon: <ArrowDownOutlined />, label: '存款管理' },
  { key: '/withdrawals', icon: <ArrowUpOutlined />, label: '提款审批' },
  { key: '/games', icon: <AppstoreOutlined />, label: '游戏管理' },
  { key: '/bet-orders', icon: <TransactionOutlined />, label: '投注记录' },
  { key: '/sg-settlement', icon: <ReconciliationOutlined />, label: '结算对账' },
  {
    key: '/team-referral',
    icon: <ApartmentOutlined />,
    label: '分销管理',
    children: [
      { key: '/team-referral/agents', label: '代理管理' },
      { key: '/team-referral/commissions', label: '佣金流水' },
      { key: '/team-referral/withdrawals', label: '提现审核' },
      { key: '/team-referral/config', label: '佣金配置' },
    ],
  },
  { key: '/promotions', icon: <GiftOutlined />, label: '活动配置' },
  { key: '/audit-log', icon: <FileTextOutlined />, label: '操作日志' },
  { key: '/customer-service', icon: <CustomerServiceOutlined />, label: '客服工作台' },
  { key: '/cs-faq', icon: <BookOutlined />, label: '知识库管理' },
  { key: '/exchange-rates', icon: <SwapOutlined />, label: '汇率管理' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { role, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)
  const [showPwdModal, setShowPwdModal] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [form] = Form.useForm<{ current: string; newPwd: string; confirm: string }>()

  async function handleChangePwd() {
    const values = form.getFieldsValue()
    if (!values.current || !values.newPwd || !values.confirm) {
      message.warning('请填写所有字段'); return
    }
    if (values.newPwd !== values.confirm) {
      message.warning('两次输入的新密码不一致'); return
    }
    if (values.newPwd.length < 8) {
      message.warning('新密码至少8位'); return
    }
    setPwdLoading(true)
    try {
      await adminChangePassword(values.current, values.newPwd)
      message.success('密码已修改，请重新登录')
      setShowPwdModal(false)
      form.resetFields()
      await logout()
      navigate('/login')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '修改失败')
    } finally {
      setPwdLoading(false)
    }
  }

  async function handleLogout() {
    await logout()
    message.success('已退出')
    navigate('/login')
  }

  const userMenuItems = [
    { key: 'change-pwd', label: '修改密码', onClick: () => setShowPwdModal(true) },
    { type: 'divider' as const },
    { key: 'logout', label: '退出登录', danger: true, onClick: handleLogout },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div style={{
          height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 18, fontWeight: 'bold', background: 'rgba(255,255,255,.1)',
          marginBottom: 4,
        }}>
          {collapsed ? 'BG' : '🎰 BetoGo'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['/team-referral']}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,.1)' }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>BetoGo 管理后台</span>
          <Dropdown menu={{ items: userMenuItems }}>
            <Button type="text">
              <UserOutlined /> {role || 'Admin'} <DownOutlined />
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>

      <Modal
        open={showPwdModal}
        title="修改登录密码"
        footer={null}
        onCancel={() => { setShowPwdModal(false); form.resetFields() }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="当前密码" name="current">
            <Input.Password placeholder="请输入当前密码" />
          </Form.Item>
          <Form.Item label="新密码" name="newPwd">
            <Input.Password placeholder="至少8位" />
          </Form.Item>
          <Form.Item label="确认新密码" name="confirm">
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" loading={pwdLoading} block onClick={handleChangePwd}>确认修改</Button>
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  )
}
