import { Layout, Menu, Button, Typography, Space, Tag } from 'antd'
import { ClusterOutlined, LogoutOutlined, PlusCircleOutlined } from '@ant-design/icons'
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
  // /tenants/new 与 /tenants/:id 都要落在各自菜单项高亮，其余归到「租户总览」
  const selectedKey = pathname === '/tenants/new' ? '/tenants/new' : '/tenants'

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
            { key: '/tenants', icon: <ClusterOutlined />, label: '租户总览' },
            // 开站会建库+建管理员账号，与后端 platformAuthMiddleware('platform_super') 的限制一致
            ...(role === 'platform_super' ? [{ key: '/tenants/new', icon: <PlusCircleOutlined />, label: '一键开站' }] : []),
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
