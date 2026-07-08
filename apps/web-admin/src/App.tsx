import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import Login from './views/Login'
import Dashboard from './views/Dashboard'
import Users from './views/Users'
import UserDetail from './views/UserDetail'
import DeviceLookup from './views/DeviceLookup'
import Deposits from './views/Deposits'
import Withdrawals from './views/Withdrawals'
import ReviewOverview from './views/review/Overview'
import ReviewProposals from './views/review/Proposals'
import ReviewProposalDetail from './views/review/ProposalDetail'
import ReviewRuleConfig from './views/review/RuleConfig'
import ReviewBlacklist from './views/review/Blacklist'
import ReviewManualQueue from './views/review/ManualQueue'
import WithdrawRecords from './views/review/WithdrawRecords'
import AuditLog from './views/AuditLog'
import Games from './views/Games'
import Settings from './views/Settings'
import SystemParams from './views/SystemParams'
import SmsTest from './views/SmsTest'
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
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
          <Route path="review/blacklist" element={<ReviewBlacklist />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="games" element={<Games />} />
          <Route path="settings" element={<Settings />} />
          <Route path="system-params" element={<SystemParams />} />
          <Route path="sms-test" element={<SmsTest />} />
          <Route path="exchange-rates" element={<ExchangeRates />} />
          <Route path="customer-service" element={<CustomerService />} />
          <Route path="cs-faq" element={<CsFaq />} />
          <Route path="bet-orders" element={<BetOrders />} />
          <Route path="team-referral" element={<Navigate to="/team-referral/agents" replace />} />
          <Route path="team-referral/agents" element={<TeamReferral tab="agents" />} />
          <Route path="team-referral/commissions" element={<TeamReferral tab="commissions" />} />

          <Route path="team-referral/config" element={<TeamReferralConfig />} />
          <Route path="promotions" element={<Promotions />} />
          <Route path="promotions/claims" element={<PromotionClaims />} />
          <Route path="home-content" element={<HomeContentConfig />} />
          <Route path="homepage-sections" element={<HomepageSections />} />
          <Route path="category-sort" element={<CategorySort />} />
          <Route path="tasks" element={<Navigate to="/tasks/config" replace />} />
          <Route path="tasks/config" element={<Tasks section="config" />} />
          <Route path="tasks/checkin" element={<Checkin />} />
          <Route path="tasks/rewards-spin" element={<RewardsSpin />} />
          <Route path="tasks/social" element={<Tasks section="social" />} />
          <Route path="tasks/reviews" element={<Tasks section="reviews" />} />
          <Route path="growth" element={<Navigate to="/growth/vip-benefits" replace />} />
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
