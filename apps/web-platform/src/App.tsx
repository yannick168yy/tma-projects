import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import Login from './views/Login'
import Tenants from './views/Tenants'
import PlatformOverview from './views/Overview'
import CreateTenant from './views/CreateTenant'
import Plans from './views/Plans'
import BillingPlans from './views/BillingPlans'
import Invoices from './views/Invoices'
import Accounts from './views/Accounts'
import Reconcile from './views/Reconcile'
import TenantLayout from './views/tenant/TenantLayout'
import Overview from './views/tenant/Overview'
import Plan from './views/tenant/Plan'
import Brand from './views/tenant/Brand'
import I18nOverrides from './views/tenant/I18nOverrides'
import Domains from './views/tenant/Domains'
import Channels from './views/tenant/Channels'
import Billing from './views/tenant/Billing'
import AppBuild from './views/tenant/AppBuild'
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
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<PlatformOverview />} />
        <Route path="tenants" element={<Tenants />} />
        <Route path="tenants/new" element={<RequireSuper><CreateTenant /></RequireSuper>} />
        <Route path="plans" element={<Plans />} />
        <Route path="billing/plans" element={<BillingPlans />} />
        <Route path="billing/invoices" element={<Invoices />} />
        <Route path="billing/accounts" element={<Accounts />} />
        <Route path="billing/reconcile" element={<Reconcile />} />
        <Route path="tenants/:id" element={<TenantLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="plan" element={<Plan />} />
          <Route path="brand" element={<Brand />} />
          <Route path="i18n" element={<I18nOverrides />} />
          <Route path="domains" element={<Domains />} />
          <Route path="channels" element={<Channels />} />
          <Route path="billing" element={<Billing />} />
          <Route path="app" element={<AppBuild />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  )
}
