import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  connected?: boolean
  subtitleConnected?: boolean
  icon?: ReactNode
  subtitleSlot?: ReactNode
}

export default function ContactMethodRow({
  title, subtitle = '', connected = false, subtitleConnected = false, icon, subtitleSlot,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight text-foreground">{title}</p>
          {subtitleSlot ? (
            <div className="mt-0.5">{subtitleSlot}</div>
          ) : (
            <p className={`mt-0.5 truncate text-xs leading-snug ${subtitleConnected ? 'font-semibold text-emerald-400' : 'text-muted-foreground'}`}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {connected ? (
        <span className="flex-shrink-0 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-black text-emerald-400">Connected</span>
      ) : (
        <span className="flex-shrink-0 rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground">—</span>
      )}
    </div>
  )
}
