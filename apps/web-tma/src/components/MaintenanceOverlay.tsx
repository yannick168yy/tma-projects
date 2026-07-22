import { useEffect, useState } from 'react'

/** 后端维护模式(503 maintenance)时的全屏遮罩，收到事件后常驻直到用户刷新 */
export default function MaintenanceOverlay() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const show = () => setVisible(true)
    window.addEventListener('betogo:maintenance', show)
    return () => window.removeEventListener('betogo:maintenance', show)
  }, [])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0d1220',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 48 }}>🛠️</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>Under Maintenance</div>
      <div style={{ fontSize: 14, opacity: 0.75, maxWidth: 320 }}>
        We are performing scheduled maintenance. Your funds and account are safe. Please check back shortly.
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8,
          padding: '10px 28px',
          borderRadius: 999,
          border: 'none',
          background: '#f5b301',
          color: '#1a1a1a',
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        Retry
      </button>
    </div>
  )
}
