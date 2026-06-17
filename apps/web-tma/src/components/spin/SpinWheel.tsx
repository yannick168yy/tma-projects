import type { SpinPrize } from '@/api/spin'
import boxImg from '@/assets/spin/fbm/box.webp'
import wheelImg from '@/assets/spin/fbm/wheel.webp'
import spinButtonImg from '@/assets/spin/fbm/btn-spin.webp'
import prize1Img from '@/assets/spin/fbm/prizes/prize-1.webp'
import prize2Img from '@/assets/spin/fbm/prizes/prize-2.webp'
import prize3Img from '@/assets/spin/fbm/prizes/prize-3.webp'
import prize4Img from '@/assets/spin/fbm/prizes/prize-4.webp'
import prize5Img from '@/assets/spin/fbm/prizes/prize-5.webp'
import prize6Img from '@/assets/spin/fbm/prizes/prize-6.webp'
import prize7Img from '@/assets/spin/fbm/prizes/prize-7.webp'
import prize8Img from '@/assets/spin/fbm/prizes/prize-8.webp'

const PRIZE_IMAGES = [prize1Img, prize2Img, prize3Img, prize4Img, prize5Img, prize6Img, prize7Img, prize8Img]

function fmtPrize(prize: SpinPrize) {
  if (prize.amountPhp >= 1000) return `₱ ${Math.round(prize.amountPhp).toLocaleString('en-PH')}`
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

  return (
    <div className="relative mx-auto w-full max-w-[430px]" style={{ aspectRatio: '760 / 838' }}>
      <img src={boxImg} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />

      <div
          className="spin-wheel-rotor absolute left-[8.3%] top-[10.4%] h-auto w-[83.4%]"
        style={{ aspectRatio: '1 / 1', transform: `rotate(${rotation}deg)`, transitionDuration: spinning ? '5600ms' : '0ms' }}
      >
        <img src={wheelImg} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
        {prizes.map((prize, i) => {
          const angle = i * step
          return (
            <div
              key={`${prize.id ?? 'prize'}-${i}`}
              className="absolute left-1/2 top-1/2 h-[50%] w-[26%] origin-bottom"
              style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)` }}
            >
              <div className="flex h-full origin-bottom flex-col items-center pt-[12%]">
                <img src={PRIZE_IMAGES[i % PRIZE_IMAGES.length]} alt="" draggable={false} className="h-[40%] w-[66%] object-contain" />
                <span className="mt-[-1px] whitespace-nowrap font-display text-[clamp(9px,2.45vw,14px)] font-black leading-none text-[#82382d] drop-shadow-[0_1px_0_rgba(255,246,190,0.95)]">
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
        className="absolute left-1/2 top-[49.7%] z-20 h-[22%] w-[27.5%] active:opacity-90 disabled:opacity-65"
        style={{ transform: 'translate(-50%, -50%)' }}
      >
        <img src={spinButtonImg} alt="" draggable={false} className="spin-center-button-visual absolute inset-0 h-full w-full object-contain" />
        {!spinning && !spinLabel && <span className="sr-only">Spin</span>}
      </button>
    </div>
  )
}
