import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Popconfirm, Space, Tabs, Tag, message } from 'antd'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { getTenantDetail, impersonateTenant, type TenantDetail } from '../../api'
import { STATUS, type TenantOutletContext } from './context'

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'plan', label: '套餐与开关' },
  { key: 'brand', label: '品牌' },
  { key: 'i18n', label: '文案' },
  { key: 'domains', label: '域名' },
  { key: 'channels', label: '通道与聚合商' },
  { key: 'billing', label: '计费与账单' },
]

/**
 * 租户详情外层：只负责「这是哪个租户」+ 页签导航 + 一份共享的详情数据。
 * 每个页签是独立路由，URL 能直达也能刷新 —— 之前一屏堆 8 张卡片，
 * 改一个功能开关要滚三屏，也没法把某一块甩给同事看。
 */
export default function TenantLayout() {
  const { id } = useParams()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [d, setD] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [impersonating, setImpersonating] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try { setD(await getTenantDetail(Number(id))) }
    catch (e) { message.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { void reload() }, [reload])

  async function doImpersonate() {
    if (!d) return
    setImpersonating(true)
    try {
      const { url } = await impersonateTenant(d.id)
      // 新标签打开：平台控制台的会话要留着，否则跳过去就回不来了
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setImpersonating(false)
    }
  }

  if (!d) return <Card loading={loading} title="租户详情" />

  const active = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'overview'
  const ctx: TenantOutletContext = { d, reload }

  return (
    <Card
      title={<Space>
        <span>{d.name}</span>
        <Tag>{d.code}</Tag>
        <Tag color={STATUS[d.status]?.color}>{STATUS[d.status]?.text ?? d.status}</Tag>
        {d.selfOperated && <Tag color="gold">自营</Tag>}
      </Space>}
      extra={<Space>
        <Popconfirm
          title="以该租户身份登录"
          description="将在新标签打开客户的业务后台。全程留痕，客户在自己的操作日志里能看到。"
          onConfirm={() => void doImpersonate()}
        >
          <Button loading={impersonating} disabled={d.status === 'closed'}>以租户身份登录</Button>
        </Popconfirm>
        <Button onClick={() => nav('/tenants')}>返回列表</Button>
      </Space>}
    >
      <Tabs
        activeKey={active}
        items={TABS.map((t) => ({ key: t.key, label: t.label }))}
        onChange={(k) => nav(`/tenants/${d.id}/${k}`)}
      />
      <Outlet context={ctx} />
    </Card>
  )
}
