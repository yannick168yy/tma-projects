import { useMemo, useState, useEffect, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Layout, Menu, Dropdown, Button, Modal, Form, Input, message, Badge, Drawer, Grid,
} from 'antd'
import {
  DashboardOutlined, TeamOutlined, UserOutlined, DownOutlined,
  AppstoreOutlined, SettingOutlined, CustomerServiceOutlined,
  TransactionOutlined, ApartmentOutlined, GiftOutlined,
  SafetyCertificateOutlined, MenuOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/auth'
import { adminChangePassword, getAdminBadges, type AdminBadges } from '../api'
import './admin-menu.css'

const { Sider, Header, Content } = Layout

function MenuBadgeLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="admin-menu-badge-label">
      <span>{text}</span>
      {count > 0 && (
        <Badge count={count} size="small" overflowCount={99} />
      )}
    </span>
  )
}

function buildMenuItems(badges: AdminBadges) {
  return [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '数据看板' },
    {
      key: 'user-center',
      icon: <TeamOutlined />,
      label: <MenuBadgeLabel text="用户中心" count={badges.rejectedKyc} />,
      children: [
        { key: '/users', label: '用户列表' },
        { key: '/kyc', label: <MenuBadgeLabel text="实名认证" count={badges.rejectedKyc} /> },
        { key: '/review/blacklist', label: '风控名单' },
      ],
    },
    {
      key: 'finance',
      icon: <TransactionOutlined />,
      label: '财务中心',
      children: [
        { key: '/deposits', label: '存款记录' },
        { key: '/wallet-ledger', label: '账变流水' },
        { key: '/payment/channels', label: '支付渠道' },
        { key: '/payment/accounting', label: '服务商余额' },
        { key: '/exchange-rates', label: '汇率管理' },
      ],
    },
    {
      key: 'review',
      icon: <SafetyCertificateOutlined />,
      label: <MenuBadgeLabel text="取款审核" count={badges.manualWithdrawals} />,
      children: [
        { key: '/review/overview', label: '审核总览' },
        {
          key: '/review/manual',
          label: <MenuBadgeLabel text="待审队列" count={badges.manualWithdrawals} />,
        },
        { key: '/review/records', label: '审核记录' },
        { key: '/review/config', label: '审核策略' },
      ],
    },
    {
      key: 'game',
      icon: <AppstoreOutlined />,
      label: '游戏中心',
      children: [
        { key: '/games', label: '游戏管理' },
        { key: '/bet-orders', label: '投注记录' },
      ],
    },
    {
      key: 'marketing',
      icon: <GiftOutlined />,
      label: '营销运营',
      children: [
        { key: '/promotions', label: '活动配置' },
        { key: '/promotions/claims', label: '参与记录' },
        { key: '/rewards-spin', label: '转盘抽奖' },
        { key: '/rebate', label: '洗码返水' },
        { key: '/home-content', label: '首页装修' },
        { key: '/homepage-sections', label: '首页板块配置' },
      ],
    },
    {
      key: 'team',
      icon: <ApartmentOutlined />,
      label: '分销裂变',
      children: [
        { key: '/team-referral/agents', label: '分销网体' },
        { key: '/team-referral/commissions', label: '佣金流水' },
        { key: '/team-referral/config', label: '佣金配置' },
      ],
    },
    {
      key: 'agent',
      icon: <ApartmentOutlined />,
      label: '渠道代理',
      children: [
        { key: '/agents', label: '渠道代理' },
        { key: '/agent-channels', label: '推广渠道' },
        { key: '/agents/commissions', label: '分成报表' },
      ],
    },
    {
      key: 'cs',
      icon: <CustomerServiceOutlined />,
      label: <MenuBadgeLabel text="客服中心" count={badges.pendingCs} />,
      children: [
        {
          key: '/customer-service',
          label: <MenuBadgeLabel text="客服工作台" count={badges.pendingCs} />,
        },
        { key: '/cs-faq', label: '知识库管理' },
      ],
    },
    {
      key: 'system',
      icon: <SettingOutlined />,
      label: '系统设置',
      children: [
        { key: '/settings', label: '管理员与权限' },
        { key: '/system-params', label: '系统参数' },
        { key: '/audit-log', label: '操作日志' },
        { key: '/sms-test', label: '短信测试' },
      ],
    },
  ]
}

function getDefaultOpenKeys(pathname: string): string[] {
  if (pathname.startsWith('/review/blacklist')) return ['user-center']
  if (pathname.startsWith('/review') || pathname.startsWith('/withdrawals')) return ['review']
  if (['/users', '/kyc'].some((p) => pathname.startsWith(p))) return ['user-center']
  if (['/deposits', '/payment', '/wallet-ledger', '/exchange-rates'].some((p) => pathname.startsWith(p))) return ['finance']
  if (['/games', '/bet-orders'].some((p) => pathname.startsWith(p))) return ['game']
  if (['/promotions', '/rewards-spin', '/rebate', '/home-content', '/homepage-sections'].some((p) => pathname.startsWith(p))) return ['marketing']
  if (pathname.startsWith('/team-referral')) return ['team']
  if (pathname.startsWith('/agents') || pathname.startsWith('/agent-')) return ['agent']
  if (['/customer-service', '/cs-faq'].some((p) => pathname.startsWith(p))) return ['cs']
  if (['/audit-log', '/settings', '/system-params', '/sms-test'].some((p) => pathname.startsWith(p))) return ['system']
  return []
}

function useAdminBadges(): AdminBadges {
  const [badges, setBadges] = useState<AdminBadges>({ manualWithdrawals: 0, pendingCs: 0, rejectedKyc: 0 })

  const refresh = useCallback(async () => {
    try {
      setBadges(await getAdminBadges())
    } catch {
      /* 静默忽略，保留上次数值 */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const poll = window.setInterval(() => void refresh(), 30_000)

    const token = localStorage.getItem('admin_token') ?? ''
    const base = (import.meta.env.VITE_ADMIN_API_BASE_URL as string | undefined) || '/api/v1'
    const url = `${base}/admin/dashboard/badges/stream?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try { setBadges(JSON.parse(e.data) as AdminBadges) } catch { /* ignore */ }
    }
    es.onerror = () => {
      es.close()
      void refresh()
    }

    return () => {
      window.clearInterval(poll)
      es.close()
    }
  }, [refresh])

  return badges
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { role, logout } = useAuthStore()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showPwdModal, setShowPwdModal] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [form] = Form.useForm<{ current: string; newPwd: string; confirm: string }>()
  const badges = useAdminBadges()
  const defaultOpenKeys = useMemo(() => getDefaultOpenKeys(location.pathname), [])

  const menuItems = useMemo(() => buildMenuItems(badges), [badges])

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

  const logo = (mini: boolean) => (
    <div style={{
      height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: 18, fontWeight: 'bold', background: 'rgba(255,255,255,.1)',
      marginBottom: 4,
    }}>
      {mini ? 'BG' : '🎰 BetoGo'}
    </div>
  )

  const sideMenu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[location.pathname]}
      defaultOpenKeys={defaultOpenKeys}
      items={menuItems}
      onClick={({ key }) => { navigate(key); if (isMobile) setDrawerOpen(false) }}
    />
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={220}
          closable={false}
          styles={{ body: { padding: 0, background: '#001529' }, header: { display: 'none' } }}
        >
          {logo(false)}
          {sideMenu}
        </Drawer>
      ) : (
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
          {logo(collapsed)}
          {sideMenu}
        </Sider>
      )}

      <Layout>
        <Header className="admin-mobile-header" style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,.1)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 16 }}>
            {isMobile && (
              <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />
            )}
            {isMobile ? 'BetoGo' : 'BetoGo 管理后台'}
          </span>
          <Dropdown menu={{ items: userMenuItems }}>
            <Button type="text">
              <UserOutlined /> {role || 'Admin'} <DownOutlined />
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ margin: isMobile ? 8 : 16 }}>
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
