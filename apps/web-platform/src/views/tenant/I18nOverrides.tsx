import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography, message } from 'antd'
import {
  deleteTenantI18n, listTenantI18n, searchI18nKeys, setTenantI18n,
  type I18nCatalogEntry, type I18nOverrideRow,
} from '../../api'
import { useTenant } from './context'

/**
 * 文案覆盖编辑器。
 *
 * 左边按 key 或默认文案搜平台词表（1300+ 条），点一条就带着默认值进编辑框；
 * 右边是这个租户已覆盖的条目。不给「浏览全部 key」的入口 —— 1300 条翻不动，
 * 搜索才是实际用法。
 */
export default function I18nOverrides() {
  const { d } = useTenant()
  const tenantId = d.id
  const [data, setData] = useState<{ locales: string[]; rows: I18nOverrideRow[]; total: number; max: number } | null>(null)
  const [locale, setLocale] = useState('en')
  const [filter, setFilter] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalog, setCatalog] = useState<I18nCatalogEntry[]>([])
  const [catalogErr, setCatalogErr] = useState('')
  const [editing, setEditing] = useState<{ keyPath: string; value: string; hint: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    try { setData(await listTenantI18n(tenantId, locale, filter || undefined)) }
    catch (e) { message.error((e as Error).message) }
  }
  useEffect(() => { void load() }, [tenantId, locale, filter])

  async function search(q: string) {
    setCatalogQuery(q)
    if (!q.trim()) { setCatalog([]); setCatalogErr(''); return }
    try {
      setCatalogErr('')
      setCatalog((await searchI18nKeys(q)).entries)
    } catch (e) {
      // 目录没生成时给出可执行的提示，而不是让搜索框静默无结果
      setCatalogErr((e as Error).message)
      setCatalog([])
    }
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await setTenantI18n(tenantId, locale, editing.keyPath, editing.value)
      setEditing(null)
      await load()
      message.success('已保存，前台缓存已刷新')
    } catch (e) { message.error((e as Error).message) } finally { setSaving(false) }
  }

  async function remove(row: I18nOverrideRow) {
    try {
      await deleteTenantI18n(tenantId, row.locale, row.keyPath)
      await load()
      message.success('已删除，该条回落平台默认文案')
    } catch (e) { message.error((e as Error).message) }
  }

  if (!data) return <Card size="small" loading />

  return (
    <Card title="文案覆盖" size="small"
      extra={<Typography.Text type={data.total >= data.max ? 'danger' : 'secondary'}>
        已覆盖 {data.total} / {data.max} 条
      </Typography.Text>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select<string> size="small" style={{ width: 110 }} value={locale} onChange={setLocale}
          options={data.locales.map((l) => ({ value: l, label: l }))} />
        <Input.Search size="small" style={{ width: 260 }} allowClear
          placeholder="搜平台词表（key 或文案）"
          value={catalogQuery} onChange={(e) => void search(e.target.value)} />
        <Input.Search size="small" style={{ width: 220 }} allowClear
          placeholder="筛选已覆盖条目" onSearch={setFilter} />
      </Space>

      {catalogErr && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={catalogErr} />}

      {catalog.length > 0 && (
        <Table rowKey="key" size="small" style={{ marginBottom: 12 }}
          pagination={{ pageSize: 5, size: 'small' }}
          dataSource={catalog}
          columns={[
            { title: 'key', dataIndex: 'key', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
            { title: '平台默认文案', dataIndex: 'defaultValue', ellipsis: true },
            {
              title: '', width: 80,
              render: (_: unknown, r: I18nCatalogEntry) => (
                <Button size="small" type="link"
                  onClick={() => setEditing({ keyPath: r.key, value: r.defaultValue, hint: r.defaultValue })}>
                  覆盖
                </Button>
              ),
            },
          ]} />
      )}

      <Table rowKey={(r) => `${r.locale}:${r.keyPath}`} size="small" pagination={false}
        locale={{ emptyText: `${locale} 尚无覆盖，前台用平台默认文案` }}
        dataSource={data.rows}
        columns={[
          { title: 'key', dataIndex: 'keyPath', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
          { title: '租户文案', dataIndex: 'value', ellipsis: true },
          {
            title: '操作', width: 130,
            render: (_: unknown, r: I18nOverrideRow) => (
              <Space size={4}>
                <Button size="small" type="link"
                  onClick={() => setEditing({ keyPath: r.keyPath, value: r.value, hint: '' })}>改</Button>
                <Popconfirm title="删除后该条回落平台默认文案" onConfirm={() => void remove(r)}>
                  <Button size="small" type="link" danger>删</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />

      <Modal open={editing !== null} title={`覆盖文案 · ${locale}`} confirmLoading={saving}
        onCancel={() => setEditing(null)} onOk={() => void save()}>
        <Form layout="vertical" size="small">
          <Form.Item label="key">
            <Input value={editing?.keyPath ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, keyPath: e.target.value })} />
          </Form.Item>
          {editing?.hint && (
            <Form.Item label="平台默认文案">
              <Typography.Text type="secondary">{editing.hint}</Typography.Text>
            </Form.Item>
          )}
          <Form.Item label="租户文案" help="{{变量}} 要原样保留，删掉会让该处显示空白">
            <Input.TextArea rows={3} maxLength={2000} value={editing?.value ?? ''}
              onChange={(e) => setEditing((s) => s && { ...s, value: e.target.value })} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
