import { useEffect, useState } from 'react'
import { Row, Col, Statistic, Input, Select, Popconfirm, Table, Tag, Modal, message, Tree, Spin, Space, DatePicker, Button } from 'antd'
import type { TablePaginationConfig } from 'antd'
import dayjs from 'dayjs'
import {
  getTeamOverview, getTeamAgents, getTeamCommissions, getTeamWithdrawals,
  approveTeamWithdrawal, rejectTeamWithdrawal, getTeamAgentTree,
  type TeamOverview, type TeamAgent, type TeamCommission, type TeamWithdrawalAdmin, type TeamTreeMember,
} from '../api'

interface TreeNodeItem { key: string; title: React.ReactNode; children?: TreeNodeItem[] }

type GgrBreakdownItem = { currency: string; ggrCents: number }

function fmtGgrAmount(currency: string, cents: number): string {
  const val = cents / 100
  const absStr = Math.abs(val) % 1 === 0
    ? String(Math.abs(val))
    : Math.abs(val).toFixed(2).replace(/\.?0+$/, '')
  if (currency === 'PHP') return (val < 0 ? '-₱' : '₱') + absStr
  return (val < 0 ? '-' : '') + absStr + currency
}

function ggrLabel(ggrCents: number, breakdown: GgrBreakdownItem[]): string {
  const total = phpDisplay(ggrCents)
  if (breakdown.length <= 1) return `GGR ${total}`
  const detail = breakdown.map(b => fmtGgrAmount(b.currency, b.ggrCents)).join(',')
  return `GGR ${total}(${detail})`
}

function buildTreeNode(m: TeamTreeMember, level: 1 | 2 | 3): TreeNodeItem {
  const levelColor = level === 1 ? 'gold' : level === 2 ? 'blue' : 'green'
  const breakdown = (m as TeamTreeMember & { ggrBreakdown?: GgrBreakdownItem[] }).ggrBreakdown ?? []
  return {
    key: `l${level}-${m.userId}`,
    title: (
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag color={levelColor} style={{ fontSize: 10, padding: '0 4px', margin: 0, lineHeight: '16px' }}>L{level}</Tag>
        <span style={{ fontWeight: 500 }}>{m.displayName}</span>
        <span style={{ color: '#bbb', fontSize: 11 }}>{m.userId}</span>
        {m.isAgent && <Tag color="purple" style={{ fontSize: 10, padding: '0 4px', margin: 0, lineHeight: '16px' }}>代理</Tag>}
        {m.thisMonthCents !== 0 && <span style={{ color: m.thisMonthCents < 0 ? '#ff4d4f' : '#1677ff', fontSize: 11 }}>{m.thisMonthCents < 0 ? '-₱' : '₱'}{Math.abs(m.thisMonthCents / 100).toFixed(2)}</span>}
        {m.ggrCents !== 0 && <span style={{ color: m.ggrCents < 0 ? '#ff4d4f' : '#999', fontSize: 11 }}>{ggrLabel(m.ggrCents, breakdown)}</span>}
      </span>
    ),
    children: m.children.length > 0 ? m.children.map((c) => buildTreeNode(c, (level + 1) as 2 | 3)) : undefined,
  }
}

function phpDisplay(cents: number): string {
  const val = (cents ?? 0) / 100
  return (val < 0 ? '-₱' : '₱') + Math.abs(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function phpCell(cents: number) {
  const val = (cents ?? 0) / 100
  return <span style={{ color: val < 0 ? '#ff4d4f' : undefined }}>{phpDisplay(cents)}</span>
}

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function wdColor(s: string) {
  return s === 'approved' ? 'green' : s === 'pending' ? 'orange' : s === 'rejected' ? 'red' : 'default'
}

interface Props { tab: 'agents' | 'commissions' | 'withdrawals' }

export default function TeamReferral({ tab }: Props) {
  const [overview, setOverview] = useState<TeamOverview>({ activeAgents: 0, thisMonthCommissionCents: 0, pendingWithdrawalCount: 0, pendingWithdrawalCents: 0 })

  const [agentSearch, setAgentSearch] = useState('')
  const [agents, setAgents] = useState<TeamAgent[]>([])
  const [agentsTotal, setAgentsTotal] = useState(0)
  const [agentsPage, setAgentsPage] = useState(1)
  const [agentsLoading, setAgentsLoading] = useState(false)

  const [commFilter, setCommFilter] = useState({ period: '', beneficiaryId: '', status: undefined as string | undefined })
  const [commissions, setCommissions] = useState<TeamCommission[]>([])
  const [commissionsTotal, setCommissionsTotal] = useState(0)
  const [commissionsPage, setCommissionsPage] = useState(1)
  const [commissionsLoading, setCommissionsLoading] = useState(false)

  const [wdStatusFilter, setWdStatusFilter] = useState<string | undefined>()
  const [withdrawals, setWithdrawals] = useState<TeamWithdrawalAdmin[]>([])
  const [withdrawalsTotal, setWithdrawalsTotal] = useState(0)
  const [withdrawalsPage, setWithdrawalsPage] = useState(1)
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false)
  const [opLoading, setOpLoading] = useState(false)
  const [rejectModal, setRejectModal] = useState({ visible: false, id: 0, reason: '' })

  const [treeVisible, setTreeVisible] = useState(false)
  const [treeAgent, setTreeAgent] = useState<TeamAgent | null>(null)
  const [treeData, setTreeData] = useState<{ l1Members: TeamTreeMember[] } | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeExpandedKeys, setTreeExpandedKeys] = useState<(string | number)[]>([])
  const [treePeriod, setTreePeriod] = useState(currentPeriod())

  async function loadOverview() {
    const data = await getTeamOverview()
    setOverview(data)
  }

  async function loadTreeData(agent: TeamAgent, period: string) {
    setTreeLoading(true)
    setTreeData(null)
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

  function openTree(agent: TeamAgent) {
    setTreeAgent(agent)
    setTreeVisible(true)
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

  async function loadAgents(page = 1) {
    setAgentsLoading(true)
    try {
      const data = await getTeamAgents({ search: agentSearch, page, pageSize: 20 })
      setAgents(data.items); setAgentsTotal(data.total); setAgentsPage(page)
    } finally { setAgentsLoading(false) }
  }

  async function loadCommissions(page = 1) {
    setCommissionsLoading(true)
    try {
      const data = await getTeamCommissions({ ...commFilter, page })
      setCommissions(data.items); setCommissionsTotal(data.total); setCommissionsPage(page)
    } finally { setCommissionsLoading(false) }
  }

  async function loadWithdrawals(page = 1) {
    setWithdrawalsLoading(true)
    try {
      const data = await getTeamWithdrawals({ status: wdStatusFilter, page })
      setWithdrawals(data.items); setWithdrawalsTotal(data.total); setWithdrawalsPage(page)
    } finally { setWithdrawalsLoading(false) }
  }

  async function doApprove(id: number) {
    setOpLoading(true)
    try {
      await approveTeamWithdrawal(id)
      message.success('已批准')
      await Promise.all([loadWithdrawals(withdrawalsPage), loadOverview()])
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  async function doReject() {
    setOpLoading(true)
    try {
      await rejectTeamWithdrawal(rejectModal.id, rejectModal.reason)
      setRejectModal((m) => ({ ...m, visible: false }))
      message.success('已驳回')
      await loadWithdrawals(withdrawalsPage)
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  useEffect(() => {
    void loadOverview()
    if (tab === 'agents') void loadAgents(1)
    if (tab === 'commissions') void loadCommissions(1)
    if (tab === 'withdrawals') void loadWithdrawals(1)
  }, [tab])

  const agentCols = [
    { title: '用户ID', dataIndex: 'userId', key: 'userId', width: 110 },
    { title: '昵称', dataIndex: 'displayName', key: 'name' },
    {
      title: '团队规模', key: 'team', width: 200,
      render: (_: unknown, r: TeamAgent) => (
        <Space size={4}>
          <Tag color="gold" style={{ margin: 0 }}>L1 · {r.l1Count}</Tag>
          <Tag color="blue" style={{ margin: 0 }}>L2 · {r.l2Count}</Tag>
          <Tag color="green" style={{ margin: 0 }}>L3 · {r.l3Count}</Tag>
        </Space>
      ),
    },
    { title: '本月佣金', key: 'thisMonth', width: 120, render: (_: unknown, r: TeamAgent) => phpDisplay(r.thisMonthCommissionCents) },
    { title: '累计收益', key: 'lifetime', width: 120, render: (_: unknown, r: TeamAgent) => phpDisplay(r.lifetimeEarnedCents) },
    { title: '开启时间', dataIndex: 'optedInAt', key: 'optedInAt', width: 160 },
    {
      title: '操作', key: 'actions', width: 90,
      render: (_: unknown, r: TeamAgent) => (
        <Button type="link" size="small" onClick={() => openTree(r)}>团队树</Button>
      ),
    },
  ]

  const commCols = [
    { title: '月份', dataIndex: 'period', key: 'period', width: 90 },
    { title: '收益人', dataIndex: 'beneficiary_name', key: 'beneficiary' },
    { title: '下线', dataIndex: 'from_name', key: 'from' },
    { title: '层级', dataIndex: 'level', key: 'level', width: 60 },
    { title: '货币', dataIndex: 'currency', key: 'currency', width: 70 },
    { title: 'GGR', key: 'ggr', width: 120, render: (_: unknown, r: TeamCommission) => phpCell(r.ggr_cents) },
    { title: '费率', dataIndex: 'rate_pct', key: 'rate', width: 70 },
    { title: '佣金', key: 'commission', width: 120, render: (_: unknown, r: TeamCommission) => phpCell(r.commission_cents) },
    { title: '状态', key: 'status', width: 90, render: (_: unknown, r: TeamCommission) => <Tag color={r.status === 'paid' ? 'green' : r.status === 'pending' ? 'orange' : 'default'}>{r.status}</Tag> },
  ]

  const wdCols = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '用户', dataIndex: 'display_name', key: 'user' },
    { title: '用户ID', dataIndex: 'user_id', key: 'userId', width: 110 },
    { title: '金额', key: 'amount', width: 110, render: (_: unknown, r: TeamWithdrawalAdmin) => phpDisplay(r.amount_cents) },
    { title: '状态', key: 'status', width: 90, render: (_: unknown, r: TeamWithdrawalAdmin) => <Tag color={wdColor(r.status)}>{r.status}</Tag> },
    { title: '申请时间', dataIndex: 'created_at', key: 'createdAt', width: 160 },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: unknown, r: TeamWithdrawalAdmin) => r.status === 'pending' ? (
        <>
          <Popconfirm title="确认批准此提现？" onConfirm={() => doApprove(r.id)}>
            <Button type="link" size="small" style={{ color: '#52c41a' }}>批准</Button>
          </Popconfirm>
          <Button type="link" size="small" danger onClick={() => setRejectModal({ visible: true, id: r.id, reason: '' })}>驳回</Button>
        </>
      ) : <span>-</span>,
    },
  ]

  const agentPagination: TablePaginationConfig = { current: agentsPage, pageSize: 20, total: agentsTotal, showTotal: (t) => `共 ${t} 条`, onChange: (p) => loadAgents(p) }
  const commPagination: TablePaginationConfig = { current: commissionsPage, pageSize: 50, total: commissionsTotal, showTotal: (t) => `共 ${t} 条`, onChange: (p) => loadCommissions(p) }
  const wdPagination: TablePaginationConfig = { current: withdrawalsPage, pageSize: 20, total: withdrawalsTotal, showTotal: (t) => `共 ${t} 条`, onChange: (p) => loadWithdrawals(p) }

  const pageTitle = tab === 'agents' ? '代理管理' : tab === 'commissions' ? '佣金流水' : '提现审核'

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>三级分销 · {pageTitle}</h2>

      {tab === 'agents' && (
        <Row gutter={16} style={{ marginBottom: 20 }}>
          <Col span={6}><Statistic title="活跃代理" value={overview.activeAgents} /></Col>
          <Col span={6}><Statistic title="本月佣金总额" value={phpDisplay(overview.thisMonthCommissionCents)} /></Col>
          <Col span={6}><Statistic title="待审提现笔数" value={overview.pendingWithdrawalCount} /></Col>
          <Col span={6}><Statistic title="待审提现金额" value={phpDisplay(overview.pendingWithdrawalCents)} /></Col>
        </Row>
      )}

      {tab === 'agents' && (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <Input value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="搜索用户ID/昵称" allowClear style={{ width: 200 }} />
            <Button type="primary" onClick={() => loadAgents(1)}>查询</Button>
          </div>
          <Table columns={agentCols} dataSource={agents} loading={agentsLoading} pagination={agentPagination} rowKey="userId" size="small" />
        </div>
      )}

      {tab === 'commissions' && (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <Input value={commFilter.period} onChange={(e) => setCommFilter((f) => ({ ...f, period: e.target.value }))} placeholder="月份 YYYY-MM" allowClear style={{ width: 130 }} />
            <Input value={commFilter.beneficiaryId} onChange={(e) => setCommFilter((f) => ({ ...f, beneficiaryId: e.target.value }))} placeholder="收益人ID" allowClear style={{ width: 150 }} />
            <Select value={commFilter.status} placeholder="状态" allowClear style={{ width: 110 }} onChange={(v) => setCommFilter((f) => ({ ...f, status: v }))} options={[{ value: 'pending', label: 'pending' }, { value: 'paid', label: 'paid' }, { value: 'voided', label: 'voided' }]} />
            <Button type="primary" onClick={() => loadCommissions(1)}>查询</Button>
          </div>
          <Table columns={commCols} dataSource={commissions} loading={commissionsLoading} pagination={commPagination} rowKey="id" size="small" />
        </div>
      )}

      {tab === 'withdrawals' && (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <Select value={wdStatusFilter} placeholder="状态" allowClear style={{ width: 130 }} onChange={setWdStatusFilter} options={[{ value: 'pending', label: 'pending' }, { value: 'approved', label: 'approved' }, { value: 'rejected', label: 'rejected' }]} />
            <Button type="primary" onClick={() => loadWithdrawals(1)}>查询</Button>
          </div>
          <Table columns={wdCols} dataSource={withdrawals} loading={withdrawalsLoading} pagination={wdPagination} rowKey="id" size="small" />
        </div>
      )}

      <Modal open={rejectModal.visible} title="驳回原因" onOk={doReject} confirmLoading={opLoading} onCancel={() => setRejectModal((m) => ({ ...m, visible: false }))}>
        <Input value={rejectModal.reason} onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))} placeholder="请输入驳回原因" />
      </Modal>

      <Modal
        open={treeVisible}
        onCancel={() => setTreeVisible(false)}
        title={
          treeAgent ? (
            <Space size={6}>
              <Tag color="gold">代理</Tag>
              <span style={{ fontWeight: 600 }}>{treeAgent.displayName}</span>
              <span style={{ color: '#999', fontSize: 12 }}>{treeAgent.userId}</span>
            </Space>
          ) : '团队树'
        }
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
                    children: treeData.l1Members.map((m) => buildTreeNode(m, 1)),
                  }] as TreeNodeItem[]}
                />
              </div>
        )}
      </Modal>
    </div>
  )
}
