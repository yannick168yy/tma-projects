import { Loader2 } from 'lucide-react'
import type { SpinPrize } from '@/api/spin'

const SEGMENT_COLORS = [
  '#6d28d9', '#f59e0b', '#9333ea', '#ec4899',
  '#7c3aed', '#fbbf24', '#a855f7', '#f97316',
] as const

const CX = 200
const CY = 200
const RIM_R = 188
const SEG_R = 158

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function segmentPath(i: number, total: number) {
  const step = 360 / total
  const start = i * step
  const end = (i + 1) * step
  const p1 = polar(CX, CY, SEG_R, end)
  const p2 = polar(CX, CY, SEG_R, start)
  const large = step > 180 ? 1 : 0
  return `M ${CX} ${CY} L ${p1.x} ${p1.y} A ${SEG_R} ${SEG_R} 0 ${large} 0 ${p2.x} ${p2.y} Z`
}

function truncateLabel(name: string, max = 8) {
  const s = name.trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

interface Props {
  prizes: SpinPrize[]
  rotation: number
  spinning: boolean
  disabled: boolean
  spinLabel: string
  onSpin: () => void
}

export default function SpinWheel({ prizes, rotation, spinning, disabled, spinLabel, onSpin }: Props) {
  const n = Math.max(1, prizes.length)
  const step = 360 / n
  const bulbs = 32

  return (
    <div className="relative mx-auto w-full max-w-[360px]">
      <div
        className="pointer-events-none absolute inset-0 rounded-full opacity-75 blur-2xl"
        style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.32) 0%, rgba(236,72,153,0.14) 38%, transparent 68%)' }}
      />

      <div className="relative aspect-square">
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="spin-rim" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fcd34d" />
              <stop offset="45%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
            <linearGradient id="spin-rim-inner" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#4c1d95" />
              <stop offset="100%" stopColor="#1a0533" />
            </linearGradient>
            <filter id="spin-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle cx={CX} cy={CY} r={RIM_R + 6} fill="url(#spin-rim-inner)" />
          <circle cx={CX} cy={CY} r={RIM_R + 4} fill="none" stroke="url(#spin-rim)" strokeWidth="10" />
          <circle cx={CX} cy={CY} r={RIM_R - 2} fill="none" stroke="#e9d5ff" strokeWidth="1.5" opacity="0.3" />

          {Array.from({ length: bulbs }).map((_, i) => {
            const deg = (360 / bulbs) * i
            const p = polar(CX, CY, RIM_R - 1, deg)
            const lit = i % 2 === 0
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={lit ? 5.5 : 4.5}
                fill={lit ? '#fde68a' : '#f472b6'}
                opacity={lit ? 0.95 : 0.7}
                className={lit ? 'animate-pulse' : undefined}
                style={{ animationDelay: `${(i % 4) * 0.35}s`, animationDuration: '1.8s' }}
              />
            )
          })}

          <g filter="url(#spin-glow)">
            <path
              d={`M ${CX} 18 L ${CX + 22} 58 L ${CX} 48 L ${CX - 22} 58 Z`}
              fill="#ec4899"
            />
            <path
              d={`M ${CX} 22 L ${CX + 14} 52 L ${CX} 44 L ${CX - 14} 52 Z`}
              fill="#fbcfe8"
              opacity="0.55"
            />
            <circle cx={CX} cy={58} r="9" fill="#fbbf24" stroke="#fef3c7" strokeWidth="2" />
          </g>
        </svg>

        <div
          className="absolute inset-[9%] transition-transform duration-[2600ms] ease-[cubic-bezier(0.15,0.85,0.25,1)]"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <svg viewBox="0 0 400 400" className="h-full w-full drop-shadow-2xl">
            <circle cx={CX} cy={CY} r={SEG_R + 2} fill="#1a0533" />
            {prizes.map((prize, i) => {
              const mid = i * step + step / 2
              const labelPos = polar(CX, CY, SEG_R * 0.62, mid)
              const dividerEnd = polar(CX, CY, SEG_R, i * step)
              return (
                <g key={prize.id ?? i}>
                  <path d={segmentPath(i, n)} fill={SEGMENT_COLORS[i % SEGMENT_COLORS.length]} />
                  <path
                    d={`M ${CX} ${CY} L ${dividerEnd.x} ${dividerEnd.y}`}
                    stroke="#f3e8ff"
                    strokeWidth="1.2"
                    opacity="0.2"
                  />
                  <text
                    x={labelPos.x}
                    y={labelPos.y}
                    fill="#fff"
                    fontSize="13"
                    fontWeight="900"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${mid}, ${labelPos.x}, ${labelPos.y})`}
                    style={{ paintOrder: 'stroke', stroke: 'rgba(46,16,101,0.65)', strokeWidth: 3 }}
                  >
                    {truncateLabel(prize.name)}
                  </text>
                </g>
              )
            })}
            <circle cx={CX} cy={CY} r={52} fill="#1a0533" stroke="#c084fc" strokeWidth="3" />
            <circle cx={CX} cy={CY} r={46} fill="none" stroke="#e9d5ff" strokeWidth="1" opacity="0.22" />
          </svg>
        </div>

        <button
          type="button"
          disabled={disabled || spinning}
          onClick={onSpin}
          className="absolute left-1/2 top-1/2 z-10 flex h-[88px] w-[88px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-[3px] border-amber-200 bg-gradient-to-br from-amber-300 via-amber-400 to-yellow-500 text-purple-950 shadow-[0_8px_28px_rgba(251,191,36,0.5),inset_0_2px_0_rgba(255,255,255,0.45)] active:scale-95 disabled:opacity-55 transition-transform"
        >
          {spinning ? (
            <Loader2 size={26} className="animate-spin" />
          ) : (
            <>
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-purple-900/65">GO</span>
              <span className="mt-0.5 font-display text-lg font-black leading-none">{spinLabel}</span>
            </>
          )}
        </button>
      </div>

      <div className="relative mx-auto -mt-1 h-5 w-[72%] rounded-b-2xl bg-gradient-to-b from-violet-700 to-purple-900 shadow-lg shadow-purple-900/50" />
      <div className="mx-auto h-2 w-[58%] rounded-b-xl bg-gradient-to-b from-purple-950 to-[#080b14]" />
    </div>
  )
}
