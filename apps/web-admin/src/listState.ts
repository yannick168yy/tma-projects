// 列表页筛选条件按页面 key 存 sessionStorage：进详情再返回（navigate(-1) 或历史页签切换都会重挂载组件）时恢复，
// 不然筛选条件被重置成默认值，运营每次都要重新选一遍。
const PREFIX = 'admin_list_state:'

export function loadListState<T extends object>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch { /* 存储不可用/脏数据时退回默认筛选 */ }
  return fallback
}

export function saveListState(key: string, state: object): void {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(state)) } catch { /* ignore */ }
}
