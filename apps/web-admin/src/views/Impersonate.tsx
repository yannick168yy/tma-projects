import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Card, Spin } from 'antd'
import { adminImpersonate } from '../api'
import { useAuthStore } from '../stores/auth'

/**
 * impersonate 落地页（P1-6）。平台控制台跳过来，用 URL 上的一次性票据换会话。
 *
 * 票据 60 秒即焚且只能用一次，所以这里必须只兑换一次 ——
 * React 18 StrictMode 在开发环境会把 effect 跑两遍，第二遍会拿着已销毁的票据
 * 换回「票据无效」，把本来成功的登录显示成失败。
 */
export default function Impersonate() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const [error, setError] = useState('')
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const ticket = params.get('ticket')
    if (!ticket) { setError('缺少票据'); return }
    void (async () => {
      try {
        const res = await adminImpersonate(ticket)
        setSession(res.token, res.role)
        // replace：票据已作废，留在历史里只会让人回退时看到一个假的失败页
        nav('/dashboard', { replace: true })
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [params, nav, setSession])

  if (error) {
    return (
      <Card style={{ maxWidth: 420, margin: '80px auto' }}>
        <Alert type="error" showIcon message="无法以租户身份登录" description={error} />
      </Card>
    )
  }
  return (
    <div style={{ textAlign: 'center', marginTop: 120 }}>
      <Spin size="large" tip="正在登录…" />
    </div>
  )
}
