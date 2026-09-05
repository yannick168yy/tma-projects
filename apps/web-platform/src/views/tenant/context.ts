import { useOutletContext } from 'react-router-dom'
import type { TenantDetail } from '../../api'

export interface TenantOutletContext {
  d: TenantDetail
  /** 子页改完数据后调用，重新拉详情（域名、市场、状态等都在同一份 payload 里） */
  reload: () => Promise<void>
}

export const useTenant = () => useOutletContext<TenantOutletContext>()

export const STATUS: Record<string, { text: string; color: string }> = {
  trial: { text: '试用', color: 'blue' },
  active: { text: '正常', color: 'green' },
  withdraw_suspended: { text: '停提现', color: 'orange' },
  deposit_suspended: { text: '停充值', color: 'orange' },
  suspended: { text: '停站', color: 'red' },
  closed: { text: '关站', color: 'default' },
}
