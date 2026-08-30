import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import Login from './views/Login'
import Dashboard from './views/Dashboard'
import BiDashboard from './views/BiDashboard'
import BiProviders from './views/BiProviders'
import BiGames from './views/BiGames'
import BiUsers from './views/BiUsers'
import BiAcquisition from './views/BiAcquisition'
import BiChurn from './views/BiChurn'
import BiChannels from './views/BiChannels'
import BiAdSources from './views/BiAdSources'
import Users from './views/Users'
import UserDetail from './views/UserDetail'
import DeviceLookup from './views/DeviceLookup'
import Deposits from './views/Deposits'
import Withdrawals from './views/Withdrawals'
import ReviewOverview from './views/review/Overview'
import ReviewProposals from './views/review/Proposals'
import ReviewProposalDetail from './views/review/ProposalDetail'
import ReviewRuleConfig from './views/review/RuleConfig'
import RiskOverview from './views/risk/Overview'
import RiskUserProfiles from './views/risk/UserProfiles'
import RiskBlacklist from './views/risk/Blacklist'
import RiskPolicies from './views/risk/Policies'
import RiskHitLogs from './views/risk/HitLogs'
import RiskFarmChannels from './views/risk/FarmChannels'
import ReviewManualQueue from './views/review/ManualQueue'
import WithdrawRecords from './views/review/WithdrawRecords'
import AuditLog from './views/AuditLog'
import Games from './views/Games'
import Settings from './views/Settings'
import SystemParams from './views/SystemParams'
import SiteDomains from './views/SiteDomains'
import SmsTest from './views/SmsTest'
import DbBackup from './views/DbBackup'
import ExchangeRates from './views/ExchangeRates'
import CustomerService from './views/CustomerService'
import CsFaq from './views/CsFaq'
import BetOrders from './views/BetOrders'
import TeamReferral from './views/TeamReferral'
import TeamReferralConfig from './views/TeamReferralConfig'
import Promotions from './views/Promotions'
import PromotionClaims from './views/PromotionClaims'
import Checkin from './views/Checkin'
import Rebate from './views/Rebate'
import Vip from './views/Vip'
import GrowthOverview from './views/GrowthOverview'
import Tasks from './views/Tasks'
import RewardsSpin from './views/RewardsSpin'
import KycList from './views/KycList'
import KycDetail from './views/KycDetail'
import PaymentChannels from './views/PaymentChannels'
import PaymentAccounting from './views/PaymentAccounting'
import LedgerRecords from './views/LedgerRecords'
import Agents from './views/Agents'
import AgentDetail from './views/AgentDetail'
import AgentCommissions from './views/AgentCommissions'
import AgentChannels from './views/AgentChannels'
import HomeContentConfig from './views/HomeContentConfig'
import CommunityMarketing from './views/CommunityMarketing'
import TgBroadcast from './views/TgBroadcast'
import HomepageSections from './views/games/HomepageSections'
import CategorySort from './views/games/CategorySort'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('admin_token')
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('admin_token')
  if (token) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// 前端守卫只防误入，真正的权限边界在后端 requireRole 中间件
function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  if (localStorage.getItem('admin_role') !== role) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="bi/dashboard" element={<BiDashboard />} />
          <Route path="bi/providers" element={<BiProviders />} />
          <Route path="bi/games" element={<BiGames />} />
          <Route path="bi/users" element={<BiUsers />} />
          <Route path="bi/acquisition" element={<BiAcquisition />} />
          <Route path="bi/ad-sources" element={<BiAdSources />} />
          <Route path="bi/churn" element={<BiChurn />} />
          <Route path="bi/channels" element={<BiChannels />} />
          <Route path="users" element={<Users />} />
          <Route path="users/:id" element={<UserDetail />} />
          <Route path="device-lookup" element={<DeviceLookup />} />
          <Route path="kyc" element={<KycList />} />
          <Route path="kyc/:userId" element={<KycDetail />} />
          <Route path="deposits" element={<Deposits />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="review" element={<Navigate to="/review/overview" replace />} />
          <Route path="review/overview" element={<ReviewOverview />} />
          <Route path="review/proposals" element={<ReviewProposals />} />
          <Route path="review/proposals/:orderId" element={<ReviewProposalDetail />} />
          <Route path="review/manual" element={<ReviewManualQueue />} />
          <Route path="review/records" element={<WithdrawRecords />} />
          <Route path="review/config" element={<ReviewRuleConfig />} />
          <Route path="review/blacklist" element={<Navigate to="/risk/blacklist" replace />} />
          <Route path="risk" element={<Navigate to="/risk/overview" replace />} />
          <Route path="risk/overview" element={<RiskOverview />} />
          <Route path="risk/users" element={<RiskUserProfiles />} />
          <Route path="risk/farm-channels" element={<RiskFarmChannels />} />
          <Route path="risk/blacklist" element={<RiskBlacklist />} />
          <Route path="risk/policies" element={<RequireRole role="super_admin"><RiskPolicies /></RequireRole>} />
          <Route path="risk/hits" element={<RiskHitLogs />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="games" element={<Games />} />
          <Route path="settings" element={<Settings />} />
          <Route path="system-params" element={<SystemParams />} />
          <Route path="site-domains" element={<SiteDomains />} />
          <Route path="sms-test" element={<SmsTest />} />
          <Route path="db-backup" element={<RequireRole role="super_admin"><DbBackup /></RequireRole>} />
          <Route path="exchange-rates" element={<ExchangeRates />} />
          <Route path="customer-service" element={<CustomerService />} />
          <Route path="cs-tickets" element={<CustomerService ticketMode />} />
          <Route path="cs-faq" element={<CsFaq />} />
          <Route path="bet-orders" element={<BetOrders />} />
          <Route path="team-referral" element={<Navigate to="/team-referral/agents" replace />} />
          <Route path="team-referral/agents" element={<TeamReferral tab="agents" />} />
          <Route path="team-referral/commissions" element={<TeamReferral tab="commissions" />} />

          <Route path="team-referral/config" element={<TeamReferralConfig />} />
          <Route path="community" element={<CommunityMarketing />} />
          <Route path="tg-broadcast" element={<TgBroadcast />} />
          <Route path="promotions" element={<Promotions />} />
          <Route path="promotions/claims" element={<PromotionClaims />} />
          <Route path="home-content" element={<HomeContentConfig />} />
          <Route path="homepage-sections" element={<HomepageSections />} />
          <Route path="category-sort" element={<CategorySort />} />
          <Route path="tasks" element={<Navigate to="/tasks/center" replace />} />
          <Route path="tasks/center" element={<Tasks />} />
          {/* 旧路径兼容：三个分散页已合并进任务中心 */}
          <Route path="tasks/config" element={<Navigate to="/tasks/center" replace />} />
          <Route path="tasks/social" element={<Navigate to="/tasks/center" replace />} />
          <Route path="tasks/reviews" element={<Navigate to="/tasks/center" replace />} />
          <Route path="tasks/checkin" element={<Checkin />} />
          <Route path="tasks/rewards-spin" element={<RewardsSpin />} />
          <Route path="growth" element={<Navigate to="/growth/overview" replace />} />
          <Route path="growth/overview" element={<GrowthOverview />} />
          <Route path="growth/vip-benefits" element={<Vip section="benefits" />} />
          <Route path="growth/vip-records" element={<Vip section="records" />} />
          <Route path="growth/rebate-rates" element={<Rebate tab="config" />} />
          <Route path="growth/rebate-featured" element={<Rebate tab="featured" />} />
          <Route path="growth/rebate-records" element={<Rebate tab="records" />} />
          {/* 旧路径重定向 */}
          <Route path="checkin" element={<Navigate to="/tasks/checkin" replace />} />
          <Route path="rewards-spin" element={<Navigate to="/tasks/rewards-spin" replace />} />
          <Route path="growth/task-config" element={<Navigate to="/tasks/config" replace />} />
          <Route path="growth/task-social" element={<Navigate to="/tasks/social" replace />} />
          <Route path="growth/task-reviews" element={<Navigate to="/tasks/reviews" replace />} />
          <Route path="rebate" element={<Navigate to="/growth/rebate-rates" replace />} />
          <Route path="vip" element={<Navigate to="/growth/vip-benefits" replace />} />
          <Route path="payment/channels" element={<PaymentChannels />} />
          <Route path="payment/accounting" element={<PaymentAccounting />} />
          <Route path="wallet-ledger" element={<LedgerRecords />} />
          <Route path="agents" element={<Agents />} />
          <Route path="agents/commissions" element={<AgentCommissions />} />
          <Route path="agent-channels" element={<AgentChannels />} />
          <Route path="agents/:agentId" element={<AgentDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
