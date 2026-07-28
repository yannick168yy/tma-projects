import { apiRequest } from './client'

export type AnnouncementPlacement = 'top_marquee' | 'home_banner_top'

export interface AnnouncementContents {
  en: string
  zh: string
  id: string
  vi: string
}

export type PublicAnnouncements = Partial<Record<AnnouncementPlacement, { contents: AnnouncementContents }>>

export const fetchAnnouncements = () => apiRequest<PublicAnnouncements>('/announcements')

export function pickAnnouncementText(contents: AnnouncementContents | undefined, language: string): string {
  if (!contents) return ''
  const lang = language.toLowerCase()
  const preferred = lang.startsWith('zh') ? contents.zh
    : lang.startsWith('id') ? contents.id
      : lang.startsWith('vi') ? contents.vi
        : contents.en
  return preferred || contents.en || contents.zh || contents.id || contents.vi || ''
}
