import { Card, Table, Tag, Progress, Typography } from 'antd'
import type { AdminGrowthState } from '../../api'

function fmtAmount(n: number, currency: string) {
  const digits = currency === 'PHP' ? 2 : 4
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

interface Props { growth: AdminGrowthState[] }

// 成长体系：bg_user_vip_state 的权威数据（每币种独立账号），与前台 VIP/洗码口径一致
export default function UserGrowth({ growth }: Props) {
  const columns = [
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 80 },
    {
      title: '等级', key: 'level', width: 140,
      render: (_: unknown, r: AdminGrowthState) => (
        <span>
          <Tag color={r.currentLevel >= 6 ? 'gold' : 'blue'}>LV{r.currentLevel}</Tag>
          {r.demoted && <Tag color="red">降级前 LV{r.awardedLevel}</Tag>}
        </span>
      ),
    },
    {
      title: '有效流水', key: 'turnover', width: 140, align: 'right' as const,
      render: (_: unknown, r: AdminGrowthState) => fmtAmount(r.turnoverTotal, r.currency),
    },
    {
      title: '任务成长值', key: 'taskGrowth', width: 110, align: 'right' as const,
      render: (_: unknown, r: AdminGrowthState) =>
        r.taskGrowth > 0 ? <span style={{ color: '#52c41a' }}>+{fmtAmount(r.taskGrowth, r.currency)}</span> : '-',
    },
    {
      title: '距下一级', key: 'next', width: 150,
      render: (_: unknown, r: AdminGrowthState) =>
        r.nextThreshold == null
          ? <Tag color="gold">已满级</Tag>
          : <Typography.Text type="secondary">LV{r.nextLevel} 还差 {fmtAmount(Math.max(0, r.nextThreshold - r.growthTotal), r.currency)}</Typography.Text>,
    },
    {
      title: `本季保级`, key: 'retention', width: 180,
      render: (_: unknown, r: AdminGrowthState) => {
        if (r.retentionLine <= 0) return <Typography.Text type="secondary">无保级要求</Typography.Text>
        const pct = Math.min(100, Math.round((r.quarterTurnover / r.retentionLine) * 100))
        return (
          <div>
            <Progress percent={pct} size="small" status={pct >= 100 ? 'success' : 'active'} />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {r.quarterKey ?? ''} {fmtAmount(r.quarterTurnover, r.currency)} / {fmtAmount(r.retentionLine, r.currency)}
            </Typography.Text>
          </div>
        )
      },
    },
  ]
  return (
    <Card title="成长体系" bordered={false} style={{ marginBottom: 16 }}>
      {growth.length ? (
        <Table columns={columns} dataSource={growth} rowKey="currency" pagination={false} size="small" scroll={{ x: 'max-content' }} />
      ) : (
        <Typography.Text type="secondary">暂无成长档案（用户尚未产生有效流水或任务成长值）</Typography.Text>
      )}
    </Card>
  )
}
