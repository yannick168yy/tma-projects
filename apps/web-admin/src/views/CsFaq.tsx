import { useEffect, useState } from 'react'
import { Table, Space, Input, Select, Button, Tag, Switch, Modal, Form, Row, Col, InputNumber, Popconfirm, Typography, Card, message } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { getFaqList, createFaq, updateFaq, deleteFaq, getCsWelcome, saveCsWelcome, type FaqItem } from '../api'
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../pagination'

const CATEGORIES = [
  { value: 'deposit', label: '充值', color: 'blue' },
  { value: 'withdraw', label: '提款', color: 'orange' },
  { value: 'account', label: '账号', color: 'purple' },
  { value: 'kyc', label: 'KYC', color: 'cyan' },
  { value: 'game', label: '游戏', color: 'green' },
  { value: 'bonus', label: '奖金', color: 'gold' },
  { value: 'other', label: '其他', color: 'default' },
]

function categoryLabel(val: string) { return CATEGORIES.find((c) => c.value === val)?.label ?? val }
function categoryColor(val: string) { return CATEGORIES.find((c) => c.value === val)?.color ?? 'default' }

function WelcomeConfig() {
  const [welcome, setWelcome] = useState('')
  const [placeholder, setPlaceholder] = useState('')
  const [savingWelcome, setSavingWelcome] = useState(false)

  useEffect(() => {
    getCsWelcome()
      .then((res) => { setWelcome(res.welcome); setPlaceholder(res.defaultWelcome) })
      .catch(() => {})
  }, [])

  async function save() {
    setSavingWelcome(true)
    try { await saveCsWelcome(welcome); message.success('欢迎语已保存') }
    catch { message.error('保存失败') }
    finally { setSavingWelcome(false) }
  }

  return (
    <Card size="small" title="客服欢迎语（留空使用默认英文欢迎语；{agent} 会替换成本次接线的客服名）" style={{ marginBottom: 16 }}>
      <Input.TextArea
        value={welcome}
        autoSize={{ minRows: 2, maxRows: 4 }}
        maxLength={1000}
        placeholder={placeholder}
        onChange={(e) => setWelcome(e.target.value)}
      />
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <Button type="primary" loading={savingWelcome} onClick={() => void save()}>保存</Button>
      </div>
    </Card>
  )
}

export default function CsFaq() {
  const [keyword, setKeyword] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<FaqItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm<{ category: string; question: string; answer: string; lang: string; sort_order: number }>()

  async function load(p = 1, ps = pageSize) {
    setPage(p); setPageSize(ps); setLoading(true)
    try {
      const res = await getFaqList({ page: p, pageSize: ps, keyword: keyword || undefined, category: categoryFilter })
      setItems(res.items); setTotal(res.total)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function onToggle(record: FaqItem, val: boolean) {
    setTogglingId(record.id)
    try {
      await updateFaq(record.id, { is_active: val ? 1 : 0 })
      setItems((prev) => prev.map((f) => f.id === record.id ? { ...f, is_active: val ? 1 : 0 } : f))
      message.success(val ? '已启用' : '已禁用')
    } catch { message.error('操作失败') }
    finally { setTogglingId(null) }
  }

  async function onDelete(id: number) {
    try { await deleteFaq(id); message.success('已删除'); void load(page) }
    catch { message.error('删除失败') }
  }

  function openCreate() {
    setEditingId(null)
    form.setFieldsValue({ category: 'deposit', question: '', answer: '', lang: 'en', sort_order: 0 })
    setModalOpen(true)
  }

  function openEdit(record: FaqItem) {
    setEditingId(record.id)
    form.setFieldsValue({ category: record.category, question: record.question, answer: record.answer, lang: record.lang, sort_order: record.sort_order })
    setModalOpen(true)
  }

  async function handleSave() {
    const values = form.getFieldsValue()
    if (!values.category || !values.question?.trim() || !values.answer?.trim()) {
      message.warning('分类、问题、答案均为必填'); return
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateFaq(editingId, values)
        message.success('已保存')
      } else {
        await createFaq(values)
        message.success('已新增')
      }
      setModalOpen(false)
      void load(editingId ? page : 1)
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  const columns = [
    { title: '分类', key: 'category', width: 100, render: (_: unknown, r: FaqItem) => <Tag color={categoryColor(r.category)}>{categoryLabel(r.category)}</Tag> },
    { title: '问题', dataIndex: 'question', key: 'question', ellipsis: true },
    { title: '答案', key: 'answer', render: (_: unknown, r: FaqItem) => <Typography.Text ellipsis={{ tooltip: r.answer }} style={{ maxWidth: 320 }}>{r.answer}</Typography.Text> },
    { title: '语言', dataIndex: 'lang', key: 'lang', width: 70 },
    { title: '排序', dataIndex: 'sort_order', key: 'sort_order', width: 70 },
    { title: '启用', key: 'is_active', width: 80, render: (_: unknown, r: FaqItem) => <Switch checked={r.is_active === 1} loading={togglingId === r.id} onChange={(val) => onToggle(r, val)} /> },
    {
      title: '操作', key: 'actions', width: 130,
      render: (_: unknown, r: FaqItem) => (
        <Space>
          <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除此条 FAQ？" okText="删除" okType="danger" onConfirm={() => onDelete(r.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize, total, pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p, ps) => load(p, ps),
  }

  return (
    <div>
      <h2>知识库管理</h2>
      <WelcomeConfig />
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          value={keyword}
          placeholder="搜索问题/答案"
          style={{ width: 220 }}
          allowClear
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => load(1)}
        />
        <Select
          value={categoryFilter}
          placeholder="全部分类"
          allowClear
          style={{ width: 140 }}
          onChange={(v) => { setCategoryFilter(v); void load(1) }}
          options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        />
        <Button type="primary" onClick={openCreate}>+ 新增 FAQ</Button>
      </Space>
      <Table columns={columns} dataSource={items} loading={loading} pagination={pagination} rowKey="id" size="small" />

      <Modal
        open={modalOpen}
        title={editingId ? '编辑 FAQ' : '新增 FAQ'}
        confirmLoading={saving}
        okText="保存"
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={640}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="分类" name="category" required>
                <Select options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} placeholder="请选择分类" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="语言" name="lang">
                <Select options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'tl', label: 'Filipino' }]} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="排序" name="sort_order">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="问题" name="question" required>
            <Input placeholder="用户可能问的问题" maxLength={512} showCount />
          </Form.Item>
          <Form.Item label="答案" name="answer" required>
            <Input.TextArea rows={5} placeholder="AI 将根据此答案回复用户" maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
