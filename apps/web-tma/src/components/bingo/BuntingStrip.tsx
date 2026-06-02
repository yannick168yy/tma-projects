interface Props { colors: string[] }

export default function BuntingStrip({ colors }: Props) {
  const tripled = [...colors, ...colors, ...colors]
  return (
    <div className="flex items-end justify-start gap-0 overflow-hidden" style={{ height: '18px' }}>
      {tripled.map((c, i) => (
        <svg key={i} width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
          <polygon points="0,0 18,0 9,18" fill={c} opacity="0.85" />
        </svg>
      ))}
    </div>
  )
}
