import { useEffect, useState } from 'react'
import { Row, Col, Statistic, Input, Button, Table, Tag, Space, Modal, Tree, Spin, DatePicker, Select, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { SorterResult, SortOrder } from 'antd/es/table/interface'
import dayjs from 'dayjs'
import { getTeamOverview, getTeamAgents, getTeamAgentTree, getTeamRatePlans, setAgentRatePlan, type TeamOverview, type TeamAgent, type TeamTreeMember, type TeamRatePlan } from '../../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../../pagination'

interface TreeNodeItem { key: string; title: React.ReactNode; children?: TreeNodeItem[] }

function fmtTurnoverAmt(betCents: number, currency: string): string {
  const val = betCents / 100
  if (currency === 'PHP') return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const formatted = val % 1 === 0 ? val.toFixed(0) : parseFloat(val.toFixed(6)).toString()
  return `${formatted} ${currency}`
}

function breakdownDisplay(breakdown: { currency: string; betCents: number }[] | null | undefined): string {
  if (!breakdown?.length) return ''
  const sorted = [...breakdown].sort((a, b) => (a.currency === 'PHP' ? -1 : b.currency === 'PHP' ? 1 : 0))
  return sorted.map((b) => fmtTurnoverAmt(b.betCents, b.currency)).join(' + ')
}

function turnoverLabel(m: TeamTreeMember): string | null {
  if (m.currencyBreakdown?.length) return breakdownDisplay(m.currencyBreakdown)
  if (m.turnoverCents !== 0) return `₱${(m.turnoverCents / 100).toFixed(2)}`
  return null
}

function moneyDisplay(cents: number, currency: string) {
  if (currency === 'PHP') return phpDisplay(cents)
  return `Rp${Math.round((cents ?? 0) / 100).toLocaleString('id-ID')}`
}

function buildTreeNode(m: TeamTreeMember, level: 1 | 2 | 3, currency: 'PHP' | 'IDR'): TreeNodeItem {
  const levelColor = level === 1 ? 'gold' : level === 2 ? 'blue' : 'green'
  const turnover = turnoverLabel(m)
  return {
    key: `l${level}-${m.userId}`,
    title: (
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag color={levelColor} style={{ fontSize: 10, padding: '0 4px', margin: 0, lineHeight: '16px' }}>L{level}</Tag>
        <span style={{ fontWeight: 500 }}>{m.displayName}</span>
        <span style={{ color: '#bbb', fontSize: 11 }}>{m.userId}</span>
        {m.isAgent && <Tag color="purple" style={{ fontSize: 10, padding: '0 4px', margin: 0, lineHeight: '16px' }}>代理</Tag>}
        {m.thisMonthCents !== 0 && <span style={{ color: '#1677ff', fontSize: 11 }}>{moneyDisplay(m.thisMonthCents, currency)}</span>}
        {turnover && <span style={{ color: '#999', fontSize: 11 }}>流水 {turnover}</span>}
      </span>
    ),
    children: m.children.length > 0 ? m.children.map((c) => buildTreeNode(c, (level + 1) as 2 | 3, currency)) : undefined,
  }
}

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  return (val < 0 ? '-₱' : '₱') + Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function TeamAgents() {
  const [overview, setOverview] = useState<TeamOverview>({ activeAgents: 0, thisMonthCommissionCents: 0, pendingWithdrawalCount: 0, pendingWithdrawalCents: 0 })
  const [agentSearch, setAgentSearch] = useState('')
  const [agents, setAgents] = useState<TeamAgent[]>([])
  const [agentsTotal, setAgentsTotal] = useState(0)
  const [agentsPage, setAgentsPage] = useState(1)
  const [agentsPageSize, setAgentsPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [agentsLoading, setAgentsLoading] = useState(false)
  // 排序由后端做（列表分页，前端排只会排当前页）
  const [agentSort, setAgentSort] = useState<{ by?: string; order?: 'asc' | 'desc' }>({ by: 'lifetime', order: 'desc' })
  const [treeVisible, setTreeVisible] = useState(false)
  const [treeAgent, setTreeAgent] = useState<TeamAgent | null>(null)
  const [treeData, setTreeData] = useState<{ currency: 'PHP' | 'IDR'; l1Members: TeamTreeMember[] } | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeExpandedKeys, setTreeExpandedKeys] = useState<(string | number)[]>([])
  const [treePeriod, setTreePeriod] = useState(currentPeriod())

  const [ratePlans, setRatePlans] = useState<TeamRatePlan[]>([])
  const [planModalAgent, setPlanModalAgent] = useState<TeamAgent | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null)
  const [planSaving, setPlanSaving] = useState(false)

  useEffect(() => {
    void loadOverview()
    void loadAgents(1)
    getTeamRatePlans().then((d) => setRatePlans(d.items)).catch(() => {})
  }, [])

  async function loadOverview() {
    try { setOverview(await getTeamOverview()) } catch { /* ignore */ }
  }

  async function loadAgents(page = 1, ps = agentsPageSize, sort = agentSort) {
    setAgentsLoading(true)
    try {
      const data = await getTeamAgents({ search: agentSearch, page, pageSize: ps, sortBy: sort.by, sortOrder: sort.order })
      setAgents(data.items); setAgentsTotal(data.total); setAgentsPage(page); setAgentsPageSize(ps); setAgentSort(sort)
    } finally { setAgentsLoading(false) }
  }

  async function loadTreeData(agent: TeamAgent, period: string) {
    setTreeLoading(true); setTreeData(null)
    try {
      const data = await getTeamAgentTree(agent.userId, period)
      setTreeData(data)
      const keys: (string | number)[] = [`root-${agent.userId}`]
      for (const l1 of data.l1Members) {
        keys.push(`l1-${l1.userId}`)
        for (const l2 of l1.children) {
          keys.push(`l2-${l2.userId}`)
          for (const l3 of l2.children) keys.push(`l3-${l3.userId}`)
        }
      }
      setTreeExpandedKeys(keys)
    } catch { message.error('加载团队树失败') }
    finally { setTreeLoading(false) }
  }

  function openPlanModal(agent: TeamAgent) {
    setPlanModalAgent(agent)
    setSelectedPlanId(agent.ratePlanId ?? null)
  }

  async function savePlan() {
    if (!planModalAgent) return
    setPlanSaving(true)
    try {
      await setAgentRatePlan(planModalAgent.userId, selectedPlanId)
      message.success('套餐已更新')
      setPlanModalAgent(null)
      void loadAgents(agentsPage)
    } catch { message.error('操作失败') }
    finally { setPlanSaving(false) }
  }

  function openTree(agent: TeamAgent) {
    setTreeAgent(agent); setTreeVisible(true)
    void loadTreeData(agent, treePeriod)
  }

  function expandAll() {
    if (!treeAgent || !treeData) return
    const keys: (string | number)[] = [`root-${treeAgent.userId}`]
    for (const l1 of treeData.l1Members) {
      keys.push(`l1-${l1.userId}`)
      for (const l2 of l1.children) keys.push(`l2-${l2.userId}`)
    }
    setTreeExpandedKeys(keys)
  }

  const sortOrderOf = (key: string): SortOrder =>
    agentSort.by === key ? (agentSort.order === 'asc' ? 'ascend' : 'descend') : null

  const agentCols: ColumnsType<TeamAgent> = [
    { title: '用户ID', dataIndex: 'userId', key: 'userId', width: 110 },
    { title: '昵称', dataIndex: 'displayName', key: 'name' },
    {
      title: '团队规模（L1+L2+L3）', key: 'teamSize', width: 210,
      sorter: true, sortOrder: sortOrderOf('teamSize'),
      render: (_: unknown, r: TeamAgent) => (
        <Space size={4}>
          <Tag color="gold" style={{ margin: 0 }}>L1 · {r.l1Count}</Tag>
          <Tag color="blue" style={{ margin: 0 }}>L2 · {r.l2Count}</Tag>
          <Tag color="green" style={{ margin: 0 }}>L3 · {r.l3Count}</Tag>
        </Space>
      ),
    },
    {
      title: '本月佣金', key: 'thisMonth', width: 120,
      sorter: true, sortOrder: sortOrderOf('thisMonth'),
      render: (_: unknown, r: TeamAgent) => moneyDisplay(r.thisMonthCommissionCents, r.currency),
    },
    {
      title: '累计收益', key: 'lifetime', width: 120,
      sorter: true, sortOrder: sortOrderOf('lifetime'),
      render: (_: unknown, r: TeamAgent) => moneyDisplay(r.lifetimeEarnedCents, r.currency),
    },
    {
      title: '开启时间', dataIndex: 'optedInAt', key: 'optedInAt', width: 160,
      sorter: true, sortOrder: sortOrderOf('optedInAt'),
    },
    {
      title: '费率套餐', key: 'ratePlan', width: 120,
      render: (_: unknown, r: TeamAgent) => {
        const plan = ratePlans.find((p) => p.id === r.ratePlanId)
        return plan
          ? <Tag color={plan.is_default ? 'blue' : 'purple'}>{plan.name}</Tag>
          : <Tag color="default">默认</Tag>
      },
    },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_: unknown, r: TeamAgent) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openTree(r)}>团队树</Button>
          <Button type="link" size="small" onClick={() => openPlanModal(r)}>套餐</Button>
        </Space>
      ),
    },
  ]

  const agentPagination: TablePaginationConfig = { current: agentsPage, pageSize: agentsPageSize, total: agentsTotal, showTotal: (t) => `共 ${t} 条`, pageSizeOptions: PAGE_SIZE_OPTIONS }

  function onAgentsTableChange(pg: TablePaginationConfig, _f: unknown, sorter: SorterResult<TeamAgent> | SorterResult<TeamAgent>[]) {
    const s = Array.isArray(sorter) ? sorter[0] : sorter
    const sort = s?.order
      ? { by: String(s.columnKey ?? ''), order: (s.order === 'ascend' ? 'asc' : 'desc') as 'asc' | 'desc' }
      : {}
    void loadAgents(pg.current ?? 1, pg.pageSize ?? agentsPageSize, sort)
  }

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 20 }} className="responsive-cols">
        <Col span={6}><Statistic title="活跃代理" value={overview.activeAgents} /></Col>
        <Col span={6}><Statistic title="本月佣金总额（USDT等值）" value={`${(overview.thisMonthCommissionCents / 100).toFixed(2)} USDT`} /></Col>
        <Col span={6}><Statistic title="待审提现笔数" value={overview.pendingWithdrawalCount} /></Col>
        <Col span={6}><Statistic title="待审提现金额（USDT等值）" value={`${(overview.pendingWithdrawalCents / 100).toFixed(2)} USDT`} /></Col>
      </Row>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Input value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="搜索用户ID/昵称" allowClear style={{ width: 200 }} />
        <Button type="primary" onClick={() => loadAgents(1)}>查询</Button>
      </div>
      <Table columns={agentCols} dataSource={agents} loading={agentsLoading} pagination={agentPagination} onChange={onAgentsTableChange} rowKey="userId" size="small" scroll={{ x: 'max-content' }} />

      <Modal
        open={treeVisible}
        onCancel={() => setTreeVisible(false)}
        title={treeAgent ? (
          <Space size={6}>
            <Tag color="gold">代理</Tag>
            <span style={{ fontWeight: 600 }}>{treeAgent.displayName}</span>
            <span style={{ color: '#999', fontSize: 12 }}>{treeAgent.userId}</span>
          </Space>
        ) : '团队树'}
        footer={null}
        width={720}
        destroyOnHidden
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <DatePicker
            picker="month"
            value={dayjs(treePeriod + '-01')}
            allowClear={false}
            style={{ width: 130 }}
            onChange={(val) => {
              if (val && treeAgent) {
                const p = val.format('YYYY-MM')
                setTreePeriod(p)
                void loadTreeData(treeAgent, p)
              }
            }}
          />
          <Button size="small" onClick={expandAll} disabled={treeLoading}>展开全部</Button>
          <Button size="small" onClick={() => treeAgent && setTreeExpandedKeys([`root-${treeAgent.userId}`])} disabled={treeLoading}>折叠</Button>
        </div>
        {treeLoading && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
        {!treeLoading && treeAgent && treeData && (
          treeData.l1Members.length === 0
            ? <div style={{ color: '#999', textAlign: 'center', padding: 40 }}>该代理本月暂无下线</div>
            : <div style={{ maxHeight: 'calc(75vh - 160px)', overflowY: 'auto' }}>
                <Tree
                  showLine={{ showLeafIcon: false }}
                  expandedKeys={treeExpandedKeys}
                  onExpand={(keys) => setTreeExpandedKeys(keys as (string | number)[])}
                  blockNode
                  treeData={[{
                    key: `root-${treeAgent.userId}`,
                    title: (
                      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                        <Tag color="gold" style={{ fontSize: 10, padding: '0 4px', margin: 0, lineHeight: '16px' }}>代理</Tag>
                        <span style={{ fontWeight: 600 }}>{treeAgent.displayName}</span>
                        <span style={{ color: '#999', fontSize: 11 }}>{treeAgent.userId}</span>
                        <span style={{ color: '#aaa', fontSize: 11 }}>L1·{treeAgent.l1Count} L2·{treeAgent.l2Count} L3·{treeAgent.l3Count}</span>
                      </span>
                    ),
                    children: treeData.l1Members.map((m) => buildTreeNode(m, 1, treeData.currency)),
                  }] as TreeNodeItem[]}
                />
              </div>
        )}
      </Modal>

      <Modal
        open={!!planModalAgent}
        title={planModalAgent ? `调整套餐 — ${planModalAgent.displayName}` : ''}
        onCancel={() => setPlanModalAgent(null)}
        onOk={savePlan}
        confirmLoading={planSaving}
        destroyOnHidden
        width={360}
      >
        <div style={{ margin: '16px 0' }}>
          <Select
            style={{ width: '100%' }}
            value={selectedPlanId ?? undefined}
            placeholder="使用默认套餐"
            allowClear
            onClear={() => setSelectedPlanId(null)}
            onChange={(v) => setSelectedPlanId(v ?? null)}
            options={ratePlans.map((p) => ({
              value: p.id,
              label: p.is_default ? `${p.name}（默认）` : p.name,
            }))}
          />
          <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
            留空表示使用默认套餐（C端广告展示的费率）
          </div>
        </div>
      </Modal>
    </div>
  )
}
