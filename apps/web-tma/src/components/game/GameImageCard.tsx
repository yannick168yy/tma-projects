import { useState, useMemo, type CSSProperties, type ReactNode } from 'react'

interface Props {
  imageUrl: string | null
  fallbackBg: [string, string]
  name: string
  provider: string
  tag?: string
  tagBg?: string
  tagFg?: string
  variant?: 'mirror' | 'split'
  children?: ReactNode
}

const NAME_FONT_SIZE = 14
const nameStyle: CSSProperties = {
  fontSize: `${NAME_FONT_SIZE}px`,
  lineHeight: '1.25',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export default function GameImageCard({
  imageUrl, fallbackBg, name, provider, tag, tagBg, tagFg, variant, children,
}: Props) {
  const [extractedColor, setExtractedColor] = useState<string | null>(null)

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    if (variant === 'mirror') return
    const img = e.target as HTMLImageElement
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 16; canvas.height = 16
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, 16, 16)
      const data = ctx.getImageData(0, 12, 16, 4)
      let r = 0, g = 0, b = 0
      const n = data.data.length / 4
      for (let i = 0; i < data.data.length; i += 4) {
        r += data.data[i]; g += data.data[i + 1]; b += data.data[i + 2]
      }
      const d = 0.55
      setExtractedColor(`rgb(${Math.round(r/n*d)},${Math.round(g/n*d)},${Math.round(b/n*d)})`)
    } catch { /* CORS 失败静默回退 */ }
  }

  const barGradient = useMemo(() => {
    const from = extractedColor ?? fallbackBg[0]
    return `linear-gradient(to bottom, ${from}, #07090f)`
  }, [extractedColor, fallbackBg])

  const mirrorBgStyle: CSSProperties = {
    inset: '-10px',
    backgroundImage: imageUrl ? `url("${imageUrl}")` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center bottom',
    filter: 'blur(14px) brightness(0.48) saturate(1.4)',
  }

  const tagStyle: CSSProperties = tagBg
    ? { background: tagBg, color: tagFg ?? '#fff' }
    : { background: 'rgba(255,255,255,0.2)', color: '#fff' }

  if (variant === 'mirror') {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <div
          className="relative flex-1 overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }}
        >
          {imageUrl && <img src={imageUrl} className="absolute inset-0 w-full h-full object-cover" />}
          {children}
        </div>
        <div className="flex-shrink-0 relative overflow-hidden px-2.5 pt-2 pb-2.5">
          {imageUrl ? <div className="absolute" style={mirrorBgStyle} /> : <div className="absolute inset-0" style={{ background: fallbackBg[0] }} />}
          <div className="relative z-10 min-w-0">
            {tag && <span className="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" style={tagStyle}>{tag}</span>}
            <p className="text-white font-black font-display min-w-0" style={nameStyle}>{name}</p>
            <p className="text-white/60 text-[10px] mt-0.5">{provider}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div
        className="relative flex-1 overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            crossOrigin="anonymous"
            className="absolute inset-0 w-full h-full object-cover"
            onLoad={onImageLoad}
          />
        )}
        {children}
      </div>
      <div className="flex-shrink-0 px-2 pt-1.5 pb-2 min-w-0" style={{ background: barGradient }}>
        {tag && <span className="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1" style={tagStyle}>{tag}</span>}
        <p className="text-white font-black font-display min-w-0" style={nameStyle}>{name}</p>
        <p className="text-white/50 text-[9px] mt-px">{provider}</p>
      </div>
    </div>
  )
}
