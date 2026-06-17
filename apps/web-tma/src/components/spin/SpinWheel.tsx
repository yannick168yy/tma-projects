import { Loader2 } from 'lucide-react'
import type { SpinPrize } from '@/api/spin'
import spinButtonImg from '@/assets/spin/decor/spin-button.webp'
import peso17Img from '@/assets/spin/prizes/peso-17.webp'
import peso37Img from '@/assets/spin/prizes/peso-37.webp'
import peso77Img from '@/assets/spin/prizes/peso-77.webp'
import peso777Img from '@/assets/spin/prizes/peso-777.webp'
import peso7777Img from '@/assets/spin/prizes/peso-7777.webp'
import points77777Img from '@/assets/spin/prizes/points-77777.webp'

const CX = 200
const CY = 200
const WHEEL_R = 188
const SEG_R = 165

const PRIZE_IMAGES = [peso77Img, points77777Img, peso17Img, peso37Img, peso777Img, peso7777Img, peso17Img, peso77Img]

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function segmentPath(i: number, total: number) {
  const step = 360 / total
  const start = i * step + 3
  const end = (i + 1) * step - 3
  const p1 = polar(CX, CY, SEG_R, end)
  const p2 = polar(CX, CY, SEG_R, start)
  const large = step > 180 ? 1 : 0
  return `M ${CX} ${CY} L ${p1.x} ${p1.y} A ${SEG_R} ${SEG_R} 0 ${large} 0 ${p2.x} ${p2.y} Z`
}

function fmtPrize(prize: SpinPrize) {
  if (prize.amountPhp >= 1000) return `₱${Math.round(prize.amountPhp).toLocaleString('en-PH')}`
  return `₱${prize.amountPhp.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
  const bulbs = 24

  return (
    <div className="relative mx-auto w-full max-w-[390px]">
      <div className="pointer-events-none absolute -inset-5 rounded-full bg-cyan-300/15 blur-2xl" />
      <div className="relative aspect-square">
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full drop-shadow-[0_18px_28px_rgba(23,18,95,0.55)]" aria-hidden="true">
          <defs>
            <radialGradient id="spin-wheel-rim" cx="50%" cy="44%" r="58%">
              <stop offset="0%" stopColor="#9be8ff" />
              <stop offset="58%" stopColor="#4f7de4" />
              <stop offset="100%" stopColor="#4535aa" />
            </radialGradient>
            <linearGradient id="spin-segment" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff8c7" />
              <stop offset="100%" stopColor="#ffd87a" />
            </linearGradient>
          </defs>
          <path d="M200 18 C302 20 380 98 382 202 C384 308 306 382 200 386 C94 382 16 308 18 202 C20 98 98 20 200 18Z" fill="url(#spin-wheel-rim)" />
          <circle cx={CX} cy={CY} r={WHEEL_R - 22} fill="#6d77dc" opacity="0.68" />
          {Array.from({ length: bulbs }).map((_, i) => {
            const p = polar(CX, CY, WHEEL_R - 16, (360 / bulbs) * i)
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={i % 2 === 0 ? 5.2 : 4}
                fill={i % 2 === 0 ? '#fff4a5' : '#75e9ff'}
                className="spin-bulb"
                style={{ animationDelay: `${i * 0.06}s` }}
              />
            )
          })}
        </svg>

        <div
          className="absolute inset-[8.5%] spin-wheel-rotor"
          style={{ transform: `rotate(${rotation}deg)`, transitionDuration: spinning ? '4200ms' : '0ms' }}
        >
          <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
            <circle cx={CX} cy={CY} r={SEG_R + 8} fill="#324cb8" opacity="0.78" />
            {prizes.map((_, i) => (
              <path
                key={i}
                d={segmentPath(i, n)}
                fill="url(#spin-segment)"
                stroke="#ffba54"
                strokeWidth="5"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {prizes.map((prize, i) => {
            const mid = i * step + step / 2
            return (
              <div
                key={prize.id ?? i}
                className="absolute left-1/2 top-1/2 h-[44%] w-[30%] origin-[50%_100%]"
                style={{ transform: `translate(-50%, -100%) rotate(${mid}deg)` }}
              >
                <div className="flex h-full origin-bottom flex-col items-center justify-start pt-[7%]" style={{ transform: `rotate(${-mid}deg)` }}>
                  <img src={PRIZE_IMAGES[i % PRIZE_IMAGES.length]} alt="" draggable={false} className="h-[56%] w-[92%] object-contain drop-shadow-[0_5px_6px_rgba(120,48,0,0.35)]" />
                  <span className="mt-[-5px] whitespace-nowrap font-display text-[clamp(11px,3.2vw,18px)] font-black leading-none text-[#7a2d25] drop-shadow-[0_1px_0_rgba(255,255,255,0.75)]">
                    {fmtPrize(prize)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          disabled={disabled || spinning}
          onClick={onSpin}
          className="spin-center-button absolute left-1/2 top-1/2 z-20 flex h-[25%] w-[25%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[28%] active:scale-95 disabled:opacity-65"
        >
          <img src={spinButtonImg} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
          {spinning ? (
            <Loader2 size={26} className="relative animate-spin text-white drop-shadow" />
          ) : (
            <span className="relative px-2 text-center font-display text-[clamp(16px,4.4vw,26px)] font-black leading-[0.92] text-[#ff2d70] drop-shadow-[0_2px_0_rgba(255,246,160,0.9)]">
              {spinLabel}<br />WIN
            </span>
          )}
        </button>

        <div className="pointer-events-none absolute left-1/2 top-[6%] z-30 h-[12%] w-[12%] -translate-x-1/2">
          <div className="mx-auto h-full w-[76%] rounded-t-full bg-gradient-to-b from-[#ff6b14] to-[#ffcf39] shadow-[0_4px_12px_rgba(255,92,0,0.45)]" />
        </div>
      </div>
    </div>
  )
}
