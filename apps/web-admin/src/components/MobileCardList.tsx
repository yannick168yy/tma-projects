import type { ReactNode } from 'react'
import { Spin, Empty, Pagination } from 'antd'

// 移动端卡片列表骨架：服务端分页(items 为当前页),统一 loading/空态/分页
export function MobileCardList<T>({
  items, loading, page, total, pageSize = 20, onPage, renderItem, empty = '暂无数据',
}: {
  items: T[]
  loading: boolean
  page: number
  total: number
  pageSize?: number
  onPage: (p: number) => void
  renderItem: (item: T, index: number) => ReactNode
  empty?: string
}) {
  return (
    <Spin spinning={loading}>
      {items.map(renderItem)}
      {!loading && items.length === 0 && <Empty description={empty} style={{ marginTop: 32 }} />}
      {total > pageSize && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Pagination simple current={page} pageSize={pageSize} total={total} onChange={onPage} />
        </div>
      )}
    </Spin>
  )
}
