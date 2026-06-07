import { useEffect, useState } from 'react'
import { Card, Row, Col, Input, Select, Button, message } from 'antd'
import { updateUserProfile } from '../../api'

interface Props {
  userId: string
  profile: Record<string, string>
  onSuccess: () => void
}

export default function UserProfile({ userId, profile, onSuccess }: Props) {
  const [form, setForm] = useState({ firstName: '', lastName: '', gender: '', dobMonth: '', dobDay: '', dobYear: '', phone: '', email: '' })
  const [opLoading, setOpLoading] = useState(false)

  useEffect(() => {
    setForm({
      firstName: profile.firstName ?? '', lastName: profile.lastName ?? '', gender: profile.gender ?? '',
      dobMonth: profile.dobMonth ?? '', dobDay: profile.dobDay ?? '', dobYear: profile.dobYear ?? '',
      phone: profile.phone ?? '', email: profile.email ?? '',
    })
  }, [profile])

  async function doSave() {
    setOpLoading(true)
    try {
      await updateUserProfile(userId, form)
      message.success('个人信息已更新'); onSuccess()
    } catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setOpLoading(false) }
  }

  return (
    <Card title="个人信息编辑" bordered={false} style={{ marginBottom: 16 }}>
      <Row gutter={12}>
        {[
          { label: '名字', key: 'firstName', placeholder: 'First Name', span: 6 },
          { label: '姓氏', key: 'lastName', placeholder: 'Last Name', span: 6 },
        ].map(({ label, key, placeholder, span }) => (
          <Col key={key} span={span}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>{label}</div>
              <Input value={form[key as keyof typeof form]} onChange={(e) => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} />
            </div>
          </Col>
        ))}
        <Col span={4}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>性别</div>
            <Select value={form.gender} style={{ width: '100%' }} onChange={(v) => setForm(p => ({ ...p, gender: v }))} options={[{ value: '', label: '未填' }, { value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '其他' }]} />
          </div>
        </Col>
        {[
          { label: '出生年份', key: 'dobYear', placeholder: 'YYYY', span: 4 },
          { label: '月', key: 'dobMonth', placeholder: 'MM', span: 2 },
          { label: '日', key: 'dobDay', placeholder: 'DD', span: 2 },
          { label: '手机', key: 'phone', placeholder: 'Phone', span: 6 },
          { label: '邮箱', key: 'email', placeholder: 'Email', span: 6 },
        ].map(({ label, key, placeholder, span }) => (
          <Col key={key} span={span}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>{label}</div>
              <Input value={form[key as keyof typeof form]} onChange={(e) => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} />
            </div>
          </Col>
        ))}
      </Row>
      <Button type="primary" loading={opLoading} onClick={doSave}>保存个人信息</Button>
    </Card>
  )
}
