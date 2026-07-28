import { Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { pickAnnouncementText, type AnnouncementContents } from '@/api/announcements'

interface Props {
  contents?: AnnouncementContents
  tone: 'emergency' | 'general'
}

export default function AnnouncementBar({ contents, tone }: Props) {
  const { i18n } = useTranslation()
  const text = pickAnnouncementText(contents, i18n.language).trim()
  if (!text) return null

  const emergency = tone === 'emergency'
  return (
    <div className={`flex items-center gap-2 overflow-hidden ${emergency ? 'border-y border-amber-400/30 bg-black py-1.5' : 'rounded-xl border border-primary/20 bg-primary/8 py-2'}`}>
      <span className={`flex-shrink-0 ${emergency ? 'pl-3 text-amber-400' : 'pl-3 text-primary'}`}>
        <Megaphone size={13} />
      </span>
      <div className="relative flex-1 overflow-hidden">
        <div className="announcement-marquee-track">
          <span className={`px-6 text-xs font-semibold ${emergency ? 'text-amber-200' : 'text-foreground'}`}>{text}</span>
          <span className={`px-6 text-xs font-semibold ${emergency ? 'text-amber-200' : 'text-foreground'}`} aria-hidden="true">{text}</span>
        </div>
      </div>
    </div>
  )
}
