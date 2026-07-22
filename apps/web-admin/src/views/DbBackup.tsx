import { useEffect, useState } from 'react'
import { Button, Card, Popconfirm, Space, Table, Tag, Typography, message } from 'antd'
import { CloudDownloadOutlined, DeleteOutlined, DatabaseOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  listDbBackups, createDbBackup, deleteDbBackup, downloadDbBackup,
  type DbBackupItem,
} from '../api'

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const TYPE_LABEL: Record<DbBackupItem['type'], { text: string; color: string }> = {
  daily: { text: '每日自动', color: 'blue' },
  manual: { text: '手动', color: 'green' },
  preclean: { text: '清库前', color: 'orange' },
  preresetseq: { text: '复位发号前', color: 'orange' },
}

export default function DbBackup() {
  const [items, setItems] = useState<DbBackupItem[]>([])
  const [dir, setDir] = useState('')
  const [keep, setKeep] = useState(14)
  const [loading, setLoading] = useState(false)
  const [backing, setBacking] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const r = await listDbBackups()
      setItems(r.items)
      setDir(r.dir)
      setKeep(r.keep)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function onBackup() {
    setBacking(true)
    try {
      const info = await createDbBackup()
      message.success(`备份完成：${info.name}（${humanSize(info.sizeBytes)}）`)
      await refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBacking(false)
    }
  }

  async function onDownload(name: string) {
    setDownloading(name)
    try {
      await downloadDbBackup(name)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDownloading(null)
    }
  }

  async function onDelete(name: string) {
    try {
      await deleteDbBackup(name)
      message.success('已删除')
      await refresh()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const totalSize = items.reduce((s, i) => s + i.sizeBytes, 0)

  return (
    <Card
      title={<Space><DatabaseOutlined />数据库备份</Space>}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
          <Button type="primary" icon={<DatabaseOutlined />} loading={backing} onClick={onBackup}>
            立即备份
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        每日凌晨 4:30（马尼拉时间）自动全库备份，自动保留最近 {keep} 份。
        备份目录：<Typography.Text code>{dir}</Typography.Text>。
        当前共 {items.length} 份，合计 {humanSize(totalSize)}。
      </Typography.Paragraph>
      <Table<DbBackupItem>
        rowKey="name"
        loading={loading}
        dataSource={items}
        pagination={false}
        size="middle"
        columns={[
          {
            title: '类型', dataIndex: 'type', width: 110,
            render: (t: DbBackupItem['type']) => {
              const c = TYPE_LABEL[t] ?? { text: t, color: 'default' }
              return <Tag color={c.color}>{c.text}</Tag>
            },
          },
          { title: '文件名', dataIndex: 'name', ellipsis: true },
          {
            title: '大小', dataIndex: 'sizeBytes', width: 110,
            render: (n: number) => humanSize(n),
          },
          {
            title: '备份时间', dataIndex: 'mtime', width: 190,
            render: (v: string) => new Date(v).toLocaleString('zh-CN'),
          },
          {
            title: '操作', key: 'action', width: 170,
            render: (_: unknown, r: DbBackupItem) => (
              <Space>
                <Button
                  size="small" icon={<CloudDownloadOutlined />}
                  loading={downloading === r.name}
                  onClick={() => onDownload(r.name)}
                >下载</Button>
                <Popconfirm
                  title="删除该备份？"
                  description={r.type === 'preclean' ? '这是清库前的备份，删除后不可恢复' : '删除后不可恢复'}
                  okText="删除" okButtonProps={{ danger: true }} cancelText="取消"
                  onConfirm={() => onDelete(r.name)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  )
}
