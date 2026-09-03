import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import Login from './views/Login'
import Tenants from './views/Tenants'
import TenantDetail from './views/TenantDetail'
import CreateTenant from './views/CreateTenant'
import { useAuthStore } from './stores/auth'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

// 前端只是少让人点错；真正的权限边界是后端 platformAuthMiddleware('platform_super')
function RequireSuper({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role)
  return role === 'platform_super' ? <>{children}</> : <Navigate to="/tenants" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/tenants" replace />} />
        <Route path="tenants" element={<Tenants />} />
        <Route path="tenants/new" element={<RequireSuper><CreateTenant /></RequireSuper>} />
        <Route path="tenants/:id" element={<TenantDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/tenants" replace />} />
    </Routes>
  )
}
