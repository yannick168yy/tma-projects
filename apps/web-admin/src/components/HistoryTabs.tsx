import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs, Dropdown } from 'antd'
import type { MenuProps } from 'antd'

// 路由 → 页签标题。与 AppLayout 菜单叶子节点保持一致。
const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': '工作台',
  '/bi/dashboard': '运营驾驶舱',
  '/bi/providers': '游戏商分析',
  '/bi/games': '游戏分析',
  '/bi/users': '用户分析',
  '/bi/acquisition': '渠道拉新',
  '/bi/churn': '流失挽回',
  '/bi/channels': '支付通道监控',
  '/bi/ad-sources': '投放渠道(买量)',
  '/users': '用户列表',
  '/device-lookup': '指纹/IP 查询',
  '/kyc': '实名认证',
  '/deposits': '存款记录',
  '/wallet-ledger': '账变流水',
  '/payment/channels': '支付渠道',
  '/payment/accounting': '服务商余额',
  '/exchange-rates': '汇率管理',
  '/review/overview': '审核总览',
  '/review/proposals': '审核建议',
  '/review/manual': '待审队列',
  '/review/records': '审核记录',
  '/review/config': '审核策略',
  '/team-referral/agents': '分销网体',
  '/team-referral/commissions': '佣金流水',
  '/team-referral/config': '佣金配置',
  '/agents': '渠道代理',
  '/agent-channels': '推广渠道',
  '/agents/commissions': '分成报表',
  '/games': '游戏管理',
  '/bet-orders': '投注记录',
  '/home-content': '首页装修',
  '/homepage-sections': '首页板块配置',
  '/homepage-layout': '首页布局',
  '/category-sort': '分类列表排序',
  '/promotions': '活动配置',
  '/promotions/claims': '参与记录',
  '/community': '社区营销',
  '/tg-broadcast': 'TG 群发',
  '/growth/vip-benefits': 'VIP 权益配置',
  '/growth/vip-records': 'VIP 礼金记录',
  '/growth/rebate-rates': '洗码费率',
  '/growth/rebate-featured': 'Cashback Games',
  '/growth/rebate-records': '洗码派发记录',
  '/tasks/center': '任务中心',
  '/tasks/checkin': '每日签到',
  '/tasks/rewards-spin': '转盘抽奖',
  '/risk/overview': '风险总览',
  '/risk/farm-channels': '套利渠道',
  '/risk/users': '用户画像',
  '/risk/blacklist': '风控名单',
  '/risk/policies': '规则与策略',
  '/risk/hits': '命中日志',
  '/customer-service': '客服工作台',
  '/cs-faq': '知识库管理',
  '/settings': '管理员与权限',
  '/system-params': '系统参数',
  '/site-domains': '站点域名映射',
  '/platform-billing': '平台账单',
  '/bottom-nav': '底部导航',
  '/audit-log': '操作日志',
  '/sms-test': '短信测试',
  '/db-backup': '数据库备份',
}

function resolveTitle(pathname: string): string {
  const fixed = ROUTE_TITLES[pathname]
  if (fixed) return fixed
  let m: RegExpMatchArray | null
  if ((m = pathname.match(/^\/users\/([^/]+)$/))) return `用户#${m[1]}`
  if ((m = pathname.match(/^\/kyc\/([^/]+)$/))) return `实名详情#${m[1]}`
  if ((m = pathname.match(/^\/agents\/([^/]+)$/))) return `代理详情#${m[1]}`
  if ((m = pathname.match(/^\/review\/proposals\/([^/]+)$/))) return `审核详情#${m[1]}`
  return pathname
}

interface TabItem { path: string; title: string }

const STORAGE_KEY = 'admin_history_tabs'

function loadTabs(): TabItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as TabItem[]
  } catch { /* ignore */ }
  return []
}

export default function HistoryTabs() {
  const location = useLocation()
  const navigate = useNavigate()
  const [tabs, setTabs] = useState<TabItem[]>(loadTabs)
  const active = location.pathname

  useEffect(() => {
    setTabs((prev) => (prev.some((t) => t.path === active)
      ? prev
      : [...prev, { path: active, title: resolveTitle(active) }]))
  }, [active])

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)) } catch { /* ignore */ }
  }, [tabs])

  function remove(path: string) {
    const idx = tabs.findIndex((t) => t.path === path)
    if (idx < 0) return
    const next = tabs.filter((t) => t.path !== path)
    setTabs(next)
    if (path === active) {
      const fallback = next[idx] ?? next[idx - 1]
      navigate(fallback ? fallback.path : '/dashboard')
    }
  }

  // 关闭右侧：保留 path 及其左侧；关闭其他：只保留 path。均切换到 path 页避免停在已关闭页。
  function closeRight(path: string) {
    const idx = tabs.findIndex((t) => t.path === path)
    if (idx < 0) return
    setTabs(tabs.slice(0, idx + 1))
    navigate(path)
  }
  function closeOthers(path: string) {
    const target = tabs.find((t) => t.path === path)
    if (!target) return
    setTabs([target])
    navigate(path)
  }

  function menuFor(path: string): MenuProps {
    const idx = tabs.findIndex((t) => t.path === path)
    return {
      items: [
        { key: 'close', label: '关闭', disabled: tabs.length <= 1 },
        { key: 'closeOthers', label: '关闭其他', disabled: tabs.length <= 1 },
        { key: 'closeRight', label: '关闭右侧', disabled: idx >= tabs.length - 1 },
      ],
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation()
        if (key === 'close') remove(path)
        else if (key === 'closeOthers') closeOthers(path)
        else if (key === 'closeRight') closeRight(path)
      },
    }
  }

  if (tabs.length === 0) return null

  return (
    <div style={{ background: '#fff', padding: '6px 12px 0', borderBottom: '1px solid #f0f0f0' }}>
      <Tabs
        hideAdd
        type="editable-card"
        size="small"
        activeKey={active}
        onChange={(key) => navigate(key)}
        onEdit={(key, action) => { if (action === 'remove') remove(key as string) }}
        tabBarStyle={{ margin: 0 }}
        items={tabs.map((t) => ({
          key: t.path,
          label: (
            <Dropdown menu={menuFor(t.path)} trigger={['contextMenu']}>
              <span>{t.title}</span>
            </Dropdown>
          ),
          closable: tabs.length > 1,
        }))}
      />
    </div>
  )
}
