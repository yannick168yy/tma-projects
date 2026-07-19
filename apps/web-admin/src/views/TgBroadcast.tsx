import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, Card, Form, Input, Modal, Popconfirm, Progress, Select, Space, Table, Tag, Typography, Upload, message,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  tbAudience, tbCancel, tbDelete, tbFails, tbList, tbSave, tbStart, tbTestSend, tbUploadImage,
  type TbButton, type TbFail, type TgBroadcast,
} from '../api'

const STATUS_META: Record<TgBroadcast['status'], { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  sending: { label: '发送中', color: 'processing' },
  done: { label: '已完成', color: 'green' },
  canceled: { label: '已取消', color: 'orange' },
}

const CONTENT_HINT = '支持 Telegram HTML:<b>粗体</b> <i>斜体</i> <a href="链接">文字</a>;带图时全文上限 1024 字符'

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

// ── 编辑 Modal ───────────────────────────────────────────────────────────────

function EditorModal({ open, editing, onClose, onSaved }: {
  open: boolean; editing: TgBroadcast | null; onClose: () => void; onSaved: () => void
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [image, setImage] = useState<{ imageKey: string; imageUrl: string } | null>(null)

  useEffect(() => {
    if (!open) return
    form.setFieldsValue(editing
      ? { title: editing.title, content: editing.content, buttons: editing.buttons ?? [] }
      : { title: '', content: '', buttons: [{ text: '🎰 Play Now', kind: 'webapp', url: 'https://www.188facai.com' }] })
    setImage(editing?.imageKey ? { imageKey: editing.imageKey, imageUrl: editing.imageUrl! } : null)
  }, [open, editing])

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      setImage(await tbUploadImage(await readFileDataUrl(file)))
    } catch (e) { message.error(e instanceof Error ? e.message : '上传失败') }
    finally { setUploading(false) }
    return false
  }

  async function save() {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await tbSave({
        id: editing?.id,
        title: v.title,
        content: v.content,
        imageKey: image?.imageKey ?? null,
        buttons: (v.buttons as TbButton[])?.filter((b) => b?.text && b?.url) ?? [],
      })
      message.success('已保存'); onClose(); onSaved()
    } catch (e) { message.error(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  return (
    <Modal title={editing ? `编辑任务 #${editing.id}` : '新建群发任务'} open={open} onCancel={onClose}
      onOk={() => void save()} confirmLoading={saving} width={680} destroyOnClose>
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item name="title" label="任务名称(仅后台可见)" rules={[{ required: true, message: '必填' }]}>
          <Input placeholder="如:周末大奖喜报 0719" />
        </Form.Item>
        <Form.Item name="content" label="文案" rules={[{ required: true, message: '必填' }]} extra={CONTENT_HINT}>
          <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} maxLength={1024} showCount />
        </Form.Item>
        <Form.Item label="配图(可选)">
          <Space align="start">
            <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={(f) => handleUpload(f)}>
              <Button loading={uploading} icon={<PlusOutlined />}>{image ? '换图' : '上传图片'}</Button>
            </Upload>
            {image && (
              <Space>
                <img src={image.imageUrl} style={{ height: 72, borderRadius: 6, display: 'block' }} />
                <Button size="small" danger onClick={() => setImage(null)}>移除</Button>
              </Space>
            )}
          </Space>
        </Form.Item>
        <Form.List name="buttons">
          {(fields, { add, remove }) => (
            <Form.Item label="内联按钮(每个按钮独占一行)" extra="打开小程序=在 TG 内直接打开 Mini App(如首页/任务中心);外部链接=跳浏览器或 t.me 群">
              {fields.map((field) => (
                <Space key={field.key} style={{ display: 'flex', marginBottom: 4 }} align="baseline">
                  <Form.Item name={[field.name, 'text']} noStyle rules={[{ required: true, message: '按钮文字必填' }]}>
                    <Input placeholder="按钮文字" style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'kind']} noStyle initialValue="url">
                    <Select style={{ width: 120 }} options={[
                      { value: 'webapp', label: '打开小程序' },
                      { value: 'url', label: '外部链接' },
                    ]} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'url']} noStyle rules={[{ required: true, message: '链接必填' }]}>
                    <Input placeholder="https://…" style={{ width: 260 }} />
                  </Form.Item>
                  <Button size="small" danger onClick={() => remove(field.name)}>删</Button>
                </Space>
              ))}
              <Button size="small" onClick={() => add({ text: '', kind: 'url', url: '' })}>+ 加按钮</Button>
            </Form.Item>
          )}
        </Form.List>
      </Form>
    </Modal>
  )
}

// ── 失败明细 Modal ───────────────────────────────────────────────────────────

function FailsModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [items, setItems] = useState<TbFail[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (id == null) return
    setLoading(true)
    tbFails(id).then((r) => setItems(r.items)).catch(() => message.error('加载失败')).finally(() => setLoading(false))
  }, [id])

  return (
    <Modal title={`任务 #${id} 失败明细(最多展示 200 条)`} open={id != null} onCancel={onClose} footer={null} width={640}>
      <Table<TbFail> rowKey="id" dataSource={items} loading={loading} size="small" pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: 'TG ID', dataIndex: 'tgId', width: 120 },
          { title: '用户', dataIndex: 'userId', width: 140, render: (v: string | null) => v ?? '-' },
          { title: '类型', dataIndex: 'blocked', width: 90, render: (v: boolean) => (v ? <Tag color="orange">拉黑/未start</Tag> : <Tag color="red">失败</Tag>) },
          { title: '错误', dataIndex: 'error', ellipsis: true, render: (v: string | null) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text> },
        ]} />
    </Modal>
  )
}

// ── 页面 ─────────────────────────────────────────────────────────────────────

export default function TgBroadcast() {
  const [items, setItems] = useState<TgBroadcast[]>([])
  const [loading, setLoading] = useState(false)
  const [audience, setAudience] = useState<number | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<TgBroadcast | null>(null)
  const [failsId, setFailsId] = useState<number | null>(null)
  const [testTarget, setTestTarget] = useState<TgBroadcast | null>(null)
  const [testTgId, setTestTgId] = useState('')
  const [testing, setTesting] = useState(false)
  const [actingId, setActingId] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try { setItems((await tbList()).items) }
    catch (e) { if (!silent) message.error(e instanceof Error ? e.message : '加载失败') }
    finally { if (!silent) setLoading(false) }
  }

  useEffect(() => {
    void load()
    tbAudience().then((r) => setAudience(r.count)).catch(() => {})
  }, [])

  // 有发送中任务时 3s 轮询进度
  const hasSending = useMemo(() => items.some((i) => i.status === 'sending'), [items])
  useEffect(() => {
    if (hasSending && !timerRef.current) {
      timerRef.current = setInterval(() => void load(true), 3000)
    } else if (!hasSending && timerRef.current) {
      clearInterval(timerRef.current); timerRef.current = null
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [hasSending])

  async function act(id: number, fn: () => Promise<unknown>, okMsg: string) {
    setActingId(id)
    try { await fn(); message.success(okMsg); void load() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setActingId(null) }
  }

  async function doTestSend() {
    if (!testTarget) return
    if (!/^\d{5,15}$/.test(testTgId.trim())) { message.warning('请输入数字 Telegram 用户 ID'); return }
    setTesting(true)
    try {
      await tbTestSend(testTarget.id, testTgId.trim())
      message.success('测试消息已发出,请到 Telegram 查看效果')
      setTestTarget(null)
    } catch (e) { message.error(e instanceof Error ? e.message : '发送失败') }
    finally { setTesting(false) }
  }

  return (
    <Card title="TG 群发" bodyStyle={{ paddingTop: 12 }}
      extra={<Typography.Text type="secondary">bot 私聊推送给全部 TG 登录用户{audience != null ? `,当前受众约 ${audience} 人` : ''}</Typography.Text>}>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => { setEditing(null); setEditorOpen(true) }}>新建群发任务</Button>
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table<TgBroadcast> rowKey="id" dataSource={items} loading={loading} size="middle" scroll={{ x: 1000 }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 56 },
          { title: '名称', dataIndex: 'title', width: 170, render: (v: string, r) => (
            <>
              {v}
              {r.imageUrl && <img src={r.imageUrl} style={{ display: 'block', height: 36, borderRadius: 4, marginTop: 4 }} />}
            </>
          ) },
          { title: '文案', dataIndex: 'content', render: (v: string) => (
            <Typography.Paragraph style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}>{v}</Typography.Paragraph>
          ) },
          { title: '按钮', dataIndex: 'buttons', width: 64, render: (v: TbButton[] | null) => v?.length ?? 0 },
          { title: '状态', dataIndex: 'status', width: 90, render: (v: TgBroadcast['status']) => <Tag color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag> },
          { title: '进度', width: 190, render: (_, r) => r.status === 'draft' ? '-' : (
            <>
              <Progress size="small" percent={r.total ? Math.round(((r.sentCount + r.failedCount + r.blockedCount) / r.total) * 100) : 0}
                status={r.status === 'sending' ? 'active' : r.status === 'canceled' ? 'exception' : undefined} />
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                成功 {r.sentCount} / 拉黑 {r.blockedCount} / 失败 {r.failedCount} / 共 {r.total}
              </Typography.Text>
            </>
          ) },
          { title: '创建', width: 150, render: (_, r) => (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.createdBy ?? '-'}<br />{new Date(r.createdAt).toLocaleString()}</Typography.Text>
          ) },
          { title: '操作', width: 230, render: (_, r) => (
            <Space wrap size={4}>
              {r.status === 'draft' && (
                <>
                  <Button size="small" onClick={() => { setEditing(r); setEditorOpen(true) }}>编辑</Button>
                  <Button size="small" onClick={() => { setTestTarget(r); setTestTgId('') }}>测试发送</Button>
                  <Popconfirm title={`确认群发给全部 ${audience ?? '?'} 名 TG 用户?`} description="开始后不能修改内容,只能取消未发送部分"
                    onConfirm={() => void act(r.id, () => tbStart(r.id), '已开始群发')}>
                    <Button size="small" type="primary" loading={actingId === r.id}>开始群发</Button>
                  </Popconfirm>
                </>
              )}
              {r.status === 'sending' && (
                <Popconfirm title="取消剩余发送?" onConfirm={() => void act(r.id, () => tbCancel(r.id), '已取消')}>
                  <Button size="small" danger loading={actingId === r.id}>取消</Button>
                </Popconfirm>
              )}
              {(r.failedCount > 0 || r.blockedCount > 0) && (
                <Button size="small" onClick={() => setFailsId(r.id)}>失败明细</Button>
              )}
              {r.status !== 'sending' && (
                <Popconfirm title="删除该任务?" onConfirm={() => void act(r.id, () => tbDelete(r.id), '已删除')}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              )}
            </Space>
          ) },
        ]} />

      <EditorModal open={editorOpen} editing={editing} onClose={() => setEditorOpen(false)} onSaved={() => void load()} />
      <FailsModal id={failsId} onClose={() => setFailsId(null)} />
      <Modal title={`测试发送:${testTarget?.title ?? ''}`} open={testTarget != null} onCancel={() => setTestTarget(null)}
        onOk={() => void doTestSend()} confirmLoading={testing} okText="发送">
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          发到指定 Telegram 用户(通常是你自己)预览效果。对方必须 start 过 bot;
          你的数字 ID 可向 @userinfobot 发消息获取。
        </Typography.Paragraph>
        <Input placeholder="Telegram 数字用户 ID,如 123456789" value={testTgId} onChange={(e) => setTestTgId(e.target.value)} />
      </Modal>
    </Card>
  )
}
