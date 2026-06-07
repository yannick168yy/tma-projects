import TeamAgents from './team/TeamAgents'
import TeamCommissions from './team/TeamCommissions'
import TeamWithdrawals from './team/TeamWithdrawals'

interface Props { tab: 'agents' | 'commissions' | 'withdrawals' }

const titles = { agents: '代理管理', commissions: '佣金流水', withdrawals: '提现审核' }

export default function TeamReferral({ tab }: Props) {
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>三级分销 · {titles[tab]}</h2>
      {tab === 'agents' && <TeamAgents />}
      {tab === 'commissions' && <TeamCommissions />}
      {tab === 'withdrawals' && <TeamWithdrawals />}
    </div>
  )
}
