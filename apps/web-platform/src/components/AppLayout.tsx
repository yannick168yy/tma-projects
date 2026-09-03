import { Layout, Menu, Button, Typography, Space, Tag } from 'antd'
import { ClusterOutlined, LogoutOutlined } from '@ant-design/icons'
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="dark" width={200}>
        <div style={{ color: '#fff', padding: '16px 20px', fontWeight: 600 }}>平台控制台</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          onClick={({ key }) => nav(key)}
          items={[{ key: '/tenants', icon: <ClusterOutlined />, label: '租户总览' }]}
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
