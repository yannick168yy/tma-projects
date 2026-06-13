import { useEffect, useRef } from 'react'
import type { TelegramWidgetUser } from '@/types/api'

const BOT_USERNAME = 'BetoGoBot'
let seq = 0

interface Props {
  onAuth: (user: TelegramWidgetUser) => void
  size?: 'large' | 'medium' | 'small'
}

/**
 * 嵌入 Telegram 官方 Login Widget（仅普通浏览器可用；Mini App 内用 initData 登录）。
 * 需在 BotFather 给 bot 用 /setdomain 绑定本站域名。
 */
export default function TelegramLoginButton({ onAuth, size = 'large' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onAuth)
  cb.current = onAuth

  useEffect(() => {
    const cbName = `onTgAuth_${++seq}`
    ;(window as unknown as Record<string, unknown>)[cbName] = (user: TelegramWidgetUser) => cb.current(user)

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', BOT_USERNAME)
    script.setAttribute('data-size', size)
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-request-access', 'write')
    script.setAttribute('data-onauth', `${cbName}(user)`)

    const node = ref.current
    node?.appendChild(script)
    return () => {
      if (node) node.innerHTML = ''
      delete (window as unknown as Record<string, unknown>)[cbName]
    }
  }, [size])

  return <div ref={ref} className="flex justify-center" />
}
