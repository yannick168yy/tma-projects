import { Tabs } from 'antd'
import Withdrawals from '../Withdrawals'
import TeamWithdrawals from '../team/TeamWithdrawals'

export default function WithdrawRecords() {
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>审核记录</h2>
      <Tabs
        defaultActiveKey="user"
        items={[
          { key: 'user', label: '玩家提款', children: <Withdrawals /> },
          { key: 'team', label: '佣金提现', children: <TeamWithdrawals /> },
        ]}
      />
    </div>
  )
}
