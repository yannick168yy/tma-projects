import { Modal, Progress, Spin } from 'antd'

export interface JobModalState {
  visible: boolean
  title: string
  msg: string
  total: number
  percent: number
  closable: boolean
  status: 'active' | 'success' | 'exception'
}

interface Props {
  state: JobModalState
  onClose: () => void
}

export default function GameJobModal({ state, onClose }: Props) {
  return (
    <Modal
      open={state.visible}
      title={state.title}
      footer={null}
      closable={state.closable}
      maskClosable={false}
      width={420}
      onCancel={onClose}
    >
      <p style={{ marginBottom: 12, color: '#666' }}>{state.msg}</p>
      {state.total > 0 ? <Progress percent={state.percent} status={state.status} /> : <Spin />}
    </Modal>
  )
}
