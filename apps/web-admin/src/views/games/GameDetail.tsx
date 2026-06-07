import { Modal, Descriptions, Tag, Progress } from 'antd'
import type { AdminGame } from '../../api'

function volatilityColor(v: string) {
  if (v.includes('very')) return 'magenta'
  if (v.includes('high')) return 'red'
  if (v.includes('medium')) return 'orange'
  return 'green'
}
function sortCategoryColor(cat: string) {
  const m: Record<string, string> = { slots: 'purple', fishing: 'cyan', live: 'red', bingo: 'green', crash: 'orange', table: 'blue' }
  return m[cat] ?? 'default'
}
function playerTypeColor(pt: string) {
  if (pt === 'high-roller') return 'red'
  if (pt === 'regular') return 'blue'
  return 'green'
}
function weightColor(w: number) {
  if (w >= 80) return '#52c41a'
  if (w >= 50) return '#faad14'
  return '#1677ff'
}

interface Props {
  game: AdminGame | null
  open: boolean
  onClose: () => void
}

export default function GameDetail({ game, open, onClose }: Props) {
  return (
    <Modal
      open={open}
      title={game?.name}
      footer={null}
      onCancel={onClose}
      width={680}
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '16px 20px' } }}
      destroyOnHidden
    >
      {game && (
        <div>
          {(game.imageHqUrl || game.imageUrl) && (
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <img src={game.imageHqUrl || game.imageUrl || ''} style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 6 }} />
            </div>
          )}
          <Descriptions title="基本信息" column={2} bordered size="small" style={{ marginBottom: 14 }}>
            <Descriptions.Item label="UUID" span={2}><span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{game.uuid}</span></Descriptions.Item>
            <Descriptions.Item label="游戏商">{game.provider}{game.providerId && <span style={{ color: '#999', fontSize: 11 }}> (ID: {game.providerId})</span>}</Descriptions.Item>
            <Descriptions.Item label="子标签">{game.label || '—'}</Descriptions.Item>
            <Descriptions.Item label="技术">{game.technology ? <Tag color={game.technology === 'HTML5' ? 'blue' : 'orange'}>{game.technology}</Tag> : '—'}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={game.isActive ? 'green' : 'red'}>{game.isActive ? '已启用' : '已禁用'}</Tag></Descriptions.Item>
            <Descriptions.Item label="更新时间" span={2}>{game.updatedAt ? new Date(game.updatedAt).toLocaleString('zh-CN') : '—'}</Descriptions.Item>
          </Descriptions>
          <Descriptions title="分类信息" column={2} bordered size="small" style={{ marginBottom: 14 }}>
            <Descriptions.Item label="前端分类">{game.sortCategory ? <Tag color={sortCategoryColor(game.sortCategory)}>{game.sortCategory}</Tag> : '—'}</Descriptions.Item>
            <Descriptions.Item label="游戏类型">{game.type || '—'}</Descriptions.Item>
            <Descriptions.Item label="分类">{game.category || '—'}</Descriptions.Item>
            <Descriptions.Item label="子分类">{game.subCategory || '—'}</Descriptions.Item>
            <Descriptions.Item label="游戏主题">{game.theme || '—'}</Descriptions.Item>
            <Descriptions.Item label="游戏风格">{game.gameStyle || '—'}</Descriptions.Item>
            <Descriptions.Item label="适合玩家" span={2}>{game.playerType ? <Tag color={playerTypeColor(game.playerType)}>{game.playerType}</Tag> : '—'}</Descriptions.Item>
          </Descriptions>
          <Descriptions title="游戏参数" column={2} bordered size="small" style={{ marginBottom: 14 }}>
            <Descriptions.Item label="RTP">{game.rtp != null ? game.rtp + '%' : '—'}</Descriptions.Item>
            <Descriptions.Item label="波动性">{game.volatility ? <Tag color={volatilityColor(game.volatility)}>{game.volatility}</Tag> : '—'}</Descriptions.Item>
            <Descriptions.Item label="转轮数">{game.reelsCount || '—'}</Descriptions.Item>
            <Descriptions.Item label="赔付线">{game.linesCount ?? '—'}</Descriptions.Item>
          </Descriptions>
          <Descriptions title="多语言名称" column={1} bordered size="small" style={{ marginBottom: 14 }}>
            <Descriptions.Item label="英语 (en)">{game.name}</Descriptions.Item>
            <Descriptions.Item label="印尼语 (id)">{game.nameId || <span style={{ color: '#bbb' }}>未翻译</span>}</Descriptions.Item>
            <Descriptions.Item label="越南语 (vi)">{game.nameVi || <span style={{ color: '#bbb' }}>未翻译</span>}</Descriptions.Item>
            <Descriptions.Item label="中文 (zh-CN)">{game.nameZh || <span style={{ color: '#bbb' }}>未翻译</span>}</Descriptions.Item>
          </Descriptions>
          <Descriptions title="AI 富化数据" column={1} bordered size="small" style={{ marginBottom: 14 }}>
            <Descriptions.Item label="热度权重">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Progress type="line" percent={game.weight} strokeWidth={8} strokeColor={weightColor(game.weight)} showInfo={false} style={{ flex: 1, margin: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, width: 30 }}>{game.weight}</span>
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="PH热度(ph_bonus)"><span style={{ fontSize: 13, fontWeight: 500, color: '#1677ff' }}>{game.phBonus}</span><span style={{ fontSize: 11, color: '#999' }}> / 30</span></Descriptions.Item>
            <Descriptions.Item label="推荐首页"><Tag color={game.isFeatured ? 'gold' : 'default'}>{game.isFeatured ? '已推荐' : '未推荐'}</Tag></Descriptions.Item>
            <Descriptions.Item label="中文简介"><span style={{ whiteSpace: 'pre-wrap' }}>{game.descriptionZh || '—'}</span></Descriptions.Item>
            <Descriptions.Item label="英文简介"><span style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{game.descriptionEn || '—'}</span></Descriptions.Item>
            <Descriptions.Item label="搜索关键词"><span style={{ fontSize: 11, wordBreak: 'break-all' }}>{game.searchKeywords || '—'}</span></Descriptions.Item>
            <Descriptions.Item label="权重更新时间">{game.weightUpdatedAt ? new Date(game.weightUpdatedAt).toLocaleString('zh-CN') : '—'}</Descriptions.Item>
          </Descriptions>
          <Descriptions title="功能特性" column={2} bordered size="small" style={{ marginBottom: 14 }}>
            <Descriptions.Item label="支持试玩"><Tag color={game.hasDemo ? 'blue' : 'default'}>{game.hasDemo ? '支持' : '不支持'}</Tag></Descriptions.Item>
            <Descriptions.Item label="手机端"><Tag color={game.isMobile ? 'green' : 'default'}>{game.isMobile ? '支持' : '不支持'}</Tag></Descriptions.Item>
            <Descriptions.Item label="免费旋转"><Tag color={game.hasFreespins ? 'purple' : 'default'}>{game.hasFreespins ? '支持' : '不支持'}</Tag></Descriptions.Item>
            <Descriptions.Item label="大厅模式"><Tag color={game.hasLobby ? 'cyan' : 'default'}>{game.hasLobby ? '支持' : '不支持'}</Tag></Descriptions.Item>
            <Descriptions.Item label="桌台" span={2}><Tag color={game.hasTables ? 'geekblue' : 'default'}>{game.hasTables ? '有' : '无'}</Tag></Descriptions.Item>
            {game.tags?.length > 0 && <Descriptions.Item label="标签" span={2}>{game.tags.map((t) => <Tag key={t} style={{ margin: 2 }}>{t}</Tag>)}</Descriptions.Item>}
          </Descriptions>
          <Descriptions title="图片" column={1} bordered size="small">
            <Descriptions.Item label="标准图">{game.imageUrl ? <a href={game.imageUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, wordBreak: 'break-all' }}>{game.imageUrl}</a> : <span style={{ color: '#ccc' }}>—</span>}</Descriptions.Item>
            <Descriptions.Item label="高清图">{game.imageHqUrl ? <a href={game.imageHqUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, wordBreak: 'break-all' }}>{game.imageHqUrl}</a> : <span style={{ color: '#ccc' }}>—</span>}</Descriptions.Item>
          </Descriptions>
        </div>
      )}
    </Modal>
  )
}
