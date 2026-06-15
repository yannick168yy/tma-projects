import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import Login from './views/Login'
import Dashboard from './views/Dashboard'
import Users from './views/Users'
import UserDetail from './views/UserDetail'
import Deposits from './views/Deposits'
import Withdrawals from './views/Withdrawals'
import ReviewOverview from './views/review/Overview'
import ReviewProposals from './views/review/Proposals'
import ReviewProposalDetail from './views/review/ProposalDetail'
import ReviewRuleConfig from './views/review/RuleConfig'
import ReviewBlacklist from './views/review/Blacklist'
import ReviewManualQueue from './views/review/ManualQueue'
import AuditLog from './views/AuditLog'
import Games from './views/Games'
import Settings from './views/Settings'
import SmsTest from './views/SmsTest'
import ExchangeRates from './views/ExchangeRates'
import CustomerService from './views/CustomerService'
import CsFaq from './views/CsFaq'
import BetOrders from './views/BetOrders'
import SgSettlement from './views/SgSettlement'
import TeamReferral from './views/TeamReferral'
import TeamReferralConfig from './views/TeamReferralConfig'
import Promotions from './views/Promotions'
import PromotionClaims from './views/PromotionClaims'
import Rebate from './views/Rebate'
import KycList from './views/KycList'
import KycDetail from './views/KycDetail'

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
          <Route path="kyc" element={<KycList />} />
          <Route path="kyc/:userId" element={<KycDetail />} />
          <Route path="deposits" element={<Deposits />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="review" element={<Navigate to="/review/overview" replace />} />
          <Route path="review/overview" element={<ReviewOverview />} />
          <Route path="review/proposals" element={<ReviewProposals />} />
          <Route path="review/proposals/:orderId" element={<ReviewProposalDetail />} />
          <Route path="review/manual" element={<ReviewManualQueue />} />
          <Route path="review/config" element={<ReviewRuleConfig />} />
          <Route path="review/blacklist" element={<ReviewBlacklist />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="games" element={<Games />} />
          <Route path="settings" element={<Settings />} />
          <Route path="sms-test" element={<SmsTest />} />
          <Route path="exchange-rates" element={<ExchangeRates />} />
          <Route path="customer-service" element={<CustomerService />} />
          <Route path="cs-faq" element={<CsFaq />} />
          <Route path="bet-orders" element={<BetOrders />} />
          <Route path="sg-settlement" element={<SgSettlement />} />
          <Route path="team-referral" element={<Navigate to="/team-referral/agents" replace />} />
          <Route path="team-referral/agents" element={<TeamReferral tab="agents" />} />
          <Route path="team-referral/commissions" element={<TeamReferral tab="commissions" />} />

          <Route path="team-referral/config" element={<TeamReferralConfig />} />
          <Route path="promotions" element={<Promotions />} />
          <Route path="promotions/claims" element={<PromotionClaims />} />
          <Route path="rebate" element={<Rebate />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
