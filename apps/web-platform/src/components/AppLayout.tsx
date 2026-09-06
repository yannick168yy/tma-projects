import { Layout, Menu, Button, Typography, Space, Tag } from 'antd'
import {
  AppstoreOutlined, ClusterOutlined, DashboardOutlined, DollarOutlined, FileTextOutlined,
  GiftOutlined, LockOutlined, LogoutOutlined, PlusCircleOutlined, SafetyCertificateOutlined,
  SwapOutlined, WalletOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'

const ROLE_LABEL: Record<string, string> = {
  platform_super: '平台超管',
  platform_ops: '平台运营',
  platform_finance: '平台财务',
}

export default function AppLayout() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { username, role, signOut } = useAuthStore()
  // /tenants/new 单独高亮；/tenants/:id/* 的各个页签都归到「租户总览」
  const selectedKey = pathname.startsWith('/overview') ? '/overview'
    : pathname === '/tenants/new' ? '/tenants/new'
    : pathname.startsWith('/plans') ? '/plans'
    : pathname.startsWith('/billing/') ? pathname
    : pathname.startsWith('/risk') ? '/risk'
    : pathname.startsWith('/promo-templates') ? '/promo-templates'
    : pathname.startsWith('/security') ? '/security'
    : '/tenants'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="dark" width={200}>
        <div style={{ color: '#fff', padding: '16px 20px', fontWeight: 600 }}>平台控制台</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => nav(key)}
          items={[
            { key: '/overview', icon: <DashboardOutlined />, label: '平台总览' },
            { key: '/tenants', icon: <ClusterOutlined />, label: '租户列表' },
            // 开站会建库+建管理员账号，与后端 platformAuthMiddleware('platform_super') 的限制一致
            ...(role === 'platform_super' ? [{ key: '/tenants/new', icon: <PlusCircleOutlined />, label: '一键开站' }] : []),
            { key: '/plans', icon: <AppstoreOutlined />, label: '套餐管理' },
            { key: '/billing/plans', icon: <DollarOutlined />, label: '分成方案' },
            { key: '/billing/invoices', icon: <FileTextOutlined />, label: '账单' },
            { key: '/billing/accounts', icon: <WalletOutlined />, label: '额度与队列' },
            { key: '/billing/reconcile', icon: <SwapOutlined />, label: '资金模式对账' },
            { key: '/risk', icon: <SafetyCertificateOutlined />, label: '风控联防' },
            { key: '/promo-templates', icon: <GiftOutlined />, label: '活动模板' },
            { key: '/security', icon: <LockOutlined />, label: '两步验证' },
          ]}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          <Space>
            <Typography.Text>{username}</Typography.Text>
            <Tag color="blue">{ROLE_LABEL[role ?? ''] ?? role}</Tag>
            <Button icon={<LogoutOutlined />} onClick={() => { signOut(); nav('/login', { replace: true }) }}>退出</Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 16 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
