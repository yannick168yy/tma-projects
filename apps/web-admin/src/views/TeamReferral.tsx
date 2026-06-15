import TeamAgents from './team/TeamAgents'
import TeamCommissions from './team/TeamCommissions'

interface Props { tab: 'agents' | 'commissions' }

const titles = { agents: '代理管理', commissions: '佣金流水' }

export default function TeamReferral({ tab }: Props) {
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>三级分销 · {titles[tab]}</h2>
      {tab === 'agents' && <TeamAgents />}
      {tab === 'commissions' && <TeamCommissions />}
    </div>
  )
}
