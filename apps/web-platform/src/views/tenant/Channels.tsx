import { Card, Space, Table, Tag } from 'antd'
import { useTenant } from './context'

export default function Channels() {
  const { d } = useTenant()
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="聚合商子代理" size="small">
        <Table rowKey="provider" size="small" pagination={false} dataSource={d.providers}
          locale={{ emptyText: '未配置（一键开站时自动创建）' }}
          columns={[
            { title: '聚合商', dataIndex: 'provider' },
            { title: '子代理账号', dataIndex: 'agentAccount' },
            { title: '状态', dataIndex: 'status' },
          ]} />
      </Card>

      <Card title="支付通道" size="small">
        <Table rowKey="channelCode" size="small" pagination={false} dataSource={d.channels}
          locale={{ emptyText: '未配置' }}
          columns={[
            { title: '通道', dataIndex: 'channelCode' },
            { title: '归属', dataIndex: 'owner', render: (v: string) => v === 'platform' ? <Tag color="gold">平台代收</Tag> : <Tag color="blue">租户自带</Tag> },
            { title: '商户号', dataIndex: 'merchantNo', render: (v: string | null) => v ?? '-' },
            { title: '启用', dataIndex: 'enabled', render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
          ]} />
      </Card>
    </Space>
  )
}
