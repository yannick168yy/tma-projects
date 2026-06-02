import type { ReactNode } from 'react'
import BuntingStrip from './BuntingStrip'

const lanternXs = [32, 76, 124, 172, 220, 268, 316, 362, 406] as const
const lanternColors = ['#ec4899', '#f97316', '#FFB800', '#34d399', '#60a5fa', '#a855f7', '#ef4444', '#ec4899', '#34d399']
const fireworkTopDegrees = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as const
const fireworkTopStrokeColors = ['#FFB800', '#ec4899', '#f97316', '#a855f7'] as const
const fireworkMidDegrees = [0, 45, 90, 135, 180, 225, 270, 315] as const
const fireworkMidStrokeColors = ['#34d399', '#60a5fa', '#FFB800', '#ec4899'] as const
const sunburstDegrees = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5] as const
const crownPoints = [{ x: 74, y: 52 }, { x: 91, y: 38 }, { x: 109, y: 30 }, { x: 127, y: 38 }, { x: 144, y: 52 }] as const
const columnBandYs = [80, 100, 120, 140] as const
const tasselXs = [8, 18, 28, 38, 48, 58, 68, 78, 88, 98, 108, 118, 128, 138, 148, 158, 168, 178, 188, 198, 208] as const
const tasselStrokeColors = ['#FFB800', '#ec4899', '#fff'] as const
const confettiLeft = [
  { top: 48, left: 12, w: 6, h: 3, color: '#FFB800', rot: 25 },
  { top: 78, left: 28, w: 4, h: 4, color: '#ec4899', rot: -20 },
  { top: 60, left: 68, w: 5, h: 2, color: '#34d399', rot: 45 },
  { top: 110, left: 18, w: 3, h: 6, color: '#60a5fa', rot: 10 },
  { top: 140, left: 8, w: 4, h: 4, color: '#f97316', rot: -35 },
  { top: 165, left: 22, w: 6, h: 3, color: '#a855f7', rot: 15 },
] as const
const buntingColors = ['#ef4444', '#a855f7', '#FFB800', '#34d399', '#ec4899', '#60a5fa', '#f97316', '#FFB800']

function degRad(deg: number) { return (deg * Math.PI) / 180 }
function fwTop(deg: number, i: number) {
  const rad = degRad(deg); const r1 = 8; const r2 = 24 + (i % 3) * 5
  return { x1: 182 + r1 * Math.cos(rad), y1: 18 + r1 * Math.sin(rad), x2: 182 + r2 * Math.cos(rad), y2: 18 + r2 * Math.sin(rad), stroke: fireworkTopStrokeColors[i % 4] }
}
function fwMid(deg: number, i: number) {
  const rad = degRad(deg)
  return { x1: 202 + 5 * Math.cos(rad), y1: 58 + 5 * Math.sin(rad), x2: 202 + 15 * Math.cos(rad), y2: 58 + 15 * Math.sin(rad), stroke: fireworkMidStrokeColors[i % 4] }
}
function sunLine(deg: number, i: number) {
  const rad = degRad(deg); const r1 = 8; const r2 = i % 2 === 0 ? 22 : 15
  return { x1: 109 + r1 * Math.cos(rad), y1: 26 + r1 * Math.sin(rad), x2: 109 + r2 * Math.cos(rad), y2: 26 + r2 * Math.sin(rad), stroke: i % 2 === 0 ? '#FFB800' : '#f97316' }
}

interface Props { children?: ReactNode }

export default function PeryaCarnivalHero({ children }: Props) {
  return (
    <div className="relative overflow-hidden" style={{ background: 'linear-gradient(155deg, #12003a 0%, #4a0a80 22%, #8c1a00 58%, #1a0800 100%)', minHeight: '240px' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 85% 90%, rgba(255, 150, 0, 0.32) 0%, transparent 50%), radial-gradient(ellipse at 10% 20%, rgba(168, 85, 247, 0.22) 0%, transparent 48%)' }} />
      <svg className="absolute top-0 left-0 w-full" height="42" viewBox="0 0 430 42" preserveAspectRatio="none" style={{ opacity: 0.82 }}>
        <path d="M0 8 Q54 22 108 8 Q162 -6 216 8 Q270 22 324 8 Q378 -6 430 8" stroke="#FFB800" strokeWidth="0.8" fill="none" opacity="0.35" />
        {lanternXs.map((x, i) => (
          <g key={`lantern-${i}`}>
            <ellipse cx={x} cy={22 + (i % 2 === 0 ? -4 : 4)} rx="8" ry="10" fill={lanternColors[i % lanternColors.length]} />
            <ellipse cx={x} cy={22 + (i % 2 === 0 ? -4 : 4) - 3} rx="3.5" ry="4" fill="rgba(255,255,255,0.18)" />
            <rect x={x - 1} y={22 + (i % 2 === 0 ? -4 : 4) - 10} width="2" height="5" fill="#FFB800" opacity="0.55" />
          </g>
        ))}
      </svg>
      <svg className="absolute right-0 bottom-0" width="218" height="238" viewBox="0 0 218 238" fill="none">
        {fireworkTopDegrees.map((deg, i) => { const l = fwTop(deg, i); return <line key={`fw-top-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.stroke} strokeWidth="2" strokeLinecap="round" opacity="0.88" /> })}
        <circle cx="182" cy="18" r="6" fill="#FFB800" />
        {fireworkMidDegrees.map((deg, i) => { const l = fwMid(deg, i); return <line key={`fw-mid-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.72" /> })}
        <circle cx="202" cy="58" r="4" fill="#34d399" />
        <circle cx="20" cy="52" r="12" fill="#ec4899" opacity="0.88" /><ellipse cx="17" cy="46" rx="3.5" ry="4" fill="rgba(255,255,255,0.2)" /><path d="M20 64 Q18 73 20 79" stroke="#ec4899" strokeWidth="1.2" fill="none" opacity="0.55" />
        <circle cx="42" cy="40" r="11" fill="#FFB800" opacity="0.9" /><ellipse cx="39" cy="34" rx="3" ry="3.5" fill="rgba(255,255,255,0.2)" /><path d="M42 51 Q40 60 42 66" stroke="#FFB800" strokeWidth="1.2" fill="none" opacity="0.55" />
        <circle cx="62" cy="48" r="10" fill="#a855f7" opacity="0.85" /><ellipse cx="59" cy="43" rx="3" ry="3.5" fill="rgba(255,255,255,0.2)" /><path d="M62 58 Q60 66 62 72" stroke="#a855f7" strokeWidth="1.2" fill="none" opacity="0.55" />
        {sunburstDegrees.map((deg, i) => { const l = sunLine(deg, i); return <line key={`sun-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.stroke} strokeWidth="2.5" opacity="0.92" /> })}
        <circle cx="109" cy="26" r="9" fill="#FFB800" /><circle cx="109" cy="26" r="5" fill="#fff" opacity="0.6" />
        <path d="M66 62 Q88 30 109 22 Q130 30 152 62" stroke="#ec4899" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M66 62 Q88 30 109 22 Q130 30 152 62" stroke="#FFB800" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="5 4" />
        {crownPoints.map((p, i) => <polygon key={`crown-${i}`} points={`${p.x - 4},${p.y + 10} ${p.x},${p.y} ${p.x + 4},${p.y + 10}`} fill={i % 2 === 0 ? '#FFB800' : '#ec4899'} />)}
        <circle cx="66" cy="62" r="9" fill="#ec4899" /><circle cx="66" cy="62" r="4.5" fill="#FFB800" />
        <circle cx="152" cy="62" r="9" fill="#ec4899" /><circle cx="152" cy="62" r="4.5" fill="#FFB800" />
        <rect x="62" y="62" width="10" height="100" rx="3" fill="#d4870a" /><rect x="64" y="62" width="3" height="100" fill="rgba(255,228,80,0.28)" />
        {columnBandYs.map((y) => <rect key={`col-l-${y}`} x="60" y={y} width="14" height="5" rx="2" fill="#FFB800" />)}
        <rect x="146" y="62" width="10" height="100" rx="3" fill="#d4870a" /><rect x="148" y="62" width="3" height="100" fill="rgba(255,228,80,0.28)" />
        {columnBandYs.map((y) => <rect key={`col-r-${y}`} x="144" y={y} width="14" height="5" rx="2" fill="#FFB800" />)}
        <path d="M72 68 Q90 96 109 80 Q128 96 146 68" stroke="#ec4899" strokeWidth="2.5" fill="none" opacity="0.92" />
        <circle cx="109" cy="80" r="5.5" fill="#ec4899" /><circle cx="109" cy="80" r="2.5" fill="#FFB800" />
        <circle cx="90" cy="88" r="3" fill="#f97316" opacity="0.8" /><circle cx="128" cy="88" r="3" fill="#f97316" opacity="0.8" />
        <path d="M72 86 Q90 116 109 98 Q128 116 146 86" stroke="#34d399" strokeWidth="2" fill="none" opacity="0.82" />
        <circle cx="109" cy="98" r="5" fill="#34d399" /><circle cx="109" cy="98" r="2.5" fill="#FFB800" />
        <path d="M72 106 Q90 134 109 116 Q128 134 146 106" stroke="#60a5fa" strokeWidth="1.8" fill="none" opacity="0.72" />
        <circle cx="109" cy="116" r="4" fill="#60a5fa" /><circle cx="109" cy="116" r="2" fill="#fff" opacity="0.7" />
        <polygon points="72,68 86,74 72,80" fill="#ec4899" opacity="0.92" /><polygon points="72,80 86,86 72,92" fill="#f97316" opacity="0.85" />
        <polygon points="146,68 132,74 146,80" fill="#a855f7" opacity="0.92" /><polygon points="146,80 132,86 146,92" fill="#FFB800" opacity="0.85" />
        <path d="M4 163 Q17 148 30 163 Q43 148 56 163 Q69 148 82 163 Q95 148 108 163 Q121 148 134 163 Q147 148 160 163 Q173 148 186 163 Q199 148 212 163" stroke="#ec4899" strokeWidth="4" fill="none" />
        <path d="M4 163 Q17 148 30 163 Q43 148 56 163 Q69 148 82 163 Q95 148 108 163 Q121 148 134 163 Q147 148 160 163 Q173 148 186 163 Q199 148 212 163" fill="#ec4899" opacity="0.22" />
        <rect x="4" y="163" width="210" height="38" rx="8" fill="#FFB800" />
        <rect x="11" y="169" width="36" height="26" rx="4" fill="#ec4899" opacity="0.88" />
        <rect x="54" y="169" width="36" height="26" rx="4" fill="#a855f7" opacity="0.88" />
        <rect x="97" y="169" width="20" height="26" rx="4" fill="#f97316" opacity="0.8" />
        <rect x="122" y="169" width="20" height="26" rx="4" fill="#f97316" opacity="0.8" />
        <rect x="148" y="169" width="36" height="26" rx="4" fill="#a855f7" opacity="0.88" />
        <rect x="190" y="169" width="20" height="26" rx="4" fill="#ec4899" opacity="0.88" />
        <text x="15" y="187" fontSize="14" fill="#fff" opacity="0.95">★</text>
        <text x="60" y="187" fontSize="14" fill="#FFB800">★</text>
        <text x="153" y="187" fontSize="14" fill="#FFB800">★</text>
        <text x="194" y="187" fontSize="14" fill="#fff">★</text>
        {tasselXs.map((x, i) => <line key={`tassel-${i}`} x1={x} y1="163" x2={x} y2={169 + (i % 3) * 3} stroke={tasselStrokeColors[i % 3]} strokeWidth="2" opacity="0.72" />)}
        <rect x="18" y="199" width="182" height="10" rx="3" fill="#c07000" />
        <circle cx="42" cy="215" r="19" fill="#1a0040" stroke="#FFB800" strokeWidth="3.5" /><circle cx="42" cy="215" r="9" fill="#FFB800" />
        <line x1="42" y1="196" x2="42" y2="234" stroke="#c07000" strokeWidth="2.5" /><line x1="23" y1="215" x2="61" y2="215" stroke="#c07000" strokeWidth="2.5" />
        <circle cx="176" cy="215" r="19" fill="#1a0040" stroke="#FFB800" strokeWidth="3.5" /><circle cx="176" cy="215" r="9" fill="#FFB800" />
        <line x1="176" y1="196" x2="176" y2="234" stroke="#c07000" strokeWidth="2.5" /><line x1="157" y1="215" x2="195" y2="215" stroke="#c07000" strokeWidth="2.5" />
        <ellipse cx="12" cy="150" rx="2" ry="6" fill="#ec4899" opacity="0.9" transform="rotate(-16 12 150)" /><ellipse cx="14" cy="148" rx="2" ry="7" fill="#FFB800" opacity="0.95" /><ellipse cx="16" cy="150" rx="2" ry="6" fill="#f97316" opacity="0.9" transform="rotate(16 16 150)" />
        <circle cx="14" cy="158" r="6.5" fill="#f5c5a3" />
        <path d="M8 164 Q14 160 20 164 L21 174 Q14 177 7 174Z" fill="#ec4899" />
        <path d="M7 174 Q2 185 3 196 L25 196 Q26 185 21 174 Q14 176 7 174Z" fill="#f97316" />
        <line x1="8" y1="167" x2="1" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="20" y1="167" x2="27" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse cx="42" cy="148" rx="2" ry="6" fill="#a855f7" opacity="0.9" transform="rotate(-12 42 148)" /><ellipse cx="44" cy="146" rx="2" ry="7" fill="#FFB800" opacity="0.95" /><ellipse cx="46" cy="148" rx="2" ry="6" fill="#ec4899" opacity="0.9" transform="rotate(12 46 148)" />
        <circle cx="44" cy="157" r="6.5" fill="#f5c5a3" />
        <path d="M38 163 Q44 159 50 163 L51 173 Q44 176 37 173Z" fill="#a855f7" />
        <path d="M37 173 Q32 184 33 195 L55 195 Q56 184 51 173 Q44 175 37 173Z" fill="#ec4899" />
        <line x1="38" y1="166" x2="30" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="50" y1="166" x2="58" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse cx="172" cy="148" rx="2" ry="6" fill="#34d399" opacity="0.9" transform="rotate(-12 172 148)" /><ellipse cx="174" cy="146" rx="2" ry="7" fill="#FFB800" opacity="0.95" /><ellipse cx="176" cy="148" rx="2" ry="6" fill="#f97316" opacity="0.9" transform="rotate(12 176 148)" />
        <circle cx="174" cy="157" r="6.5" fill="#f5c5a3" />
        <path d="M168 163 Q174 159 180 163 L181 173 Q174 176 167 173Z" fill="#34d399" />
        <path d="M167 173 Q162 184 163 195 L185 195 Q186 184 181 173 Q174 175 167 173Z" fill="#FFB800" />
        <line x1="168" y1="166" x2="160" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="180" y1="166" x2="188" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse cx="202" cy="150" rx="2" ry="6" fill="#60a5fa" opacity="0.9" transform="rotate(-16 202 150)" /><ellipse cx="204" cy="148" rx="2" ry="7" fill="#FFB800" opacity="0.95" /><ellipse cx="206" cy="150" rx="2" ry="6" fill="#a855f7" opacity="0.9" transform="rotate(16 206 150)" />
        <circle cx="204" cy="158" r="6.5" fill="#f5c5a3" />
        <path d="M198 164 Q204 160 210 164 L211 174 Q204 177 197 174Z" fill="#60a5fa" />
        <path d="M197 174 Q192 185 193 196 L215 196 Q216 185 211 174 Q204 176 197 174Z" fill="#a855f7" />
        <line x1="198" y1="167" x2="191" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="210" y1="167" x2="217" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round" />
        <rect x="6" y="138" width="5" height="3" rx="1" fill="#FFB800" opacity="0.72" transform="rotate(30 6 138)" />
        <rect x="58" y="130" width="4" height="4" rx="1" fill="#ec4899" opacity="0.65" transform="rotate(-20 58 130)" />
        <rect x="153" y="128" width="5" height="3" rx="1" fill="#34d399" opacity="0.62" transform="rotate(48 153 128)" />
        <rect x="158" y="146" width="4" height="4" rx="1" fill="#60a5fa" opacity="0.65" transform="rotate(15 158 146)" />
        <rect x="96" y="148" width="5" height="3" rx="1" fill="#f97316" opacity="0.6" transform="rotate(-35 96 148)" />
      </svg>
      {confettiLeft.map((s, i) => (
        <div
          key={`confetti-${i}`}
          className="absolute rounded-sm opacity-55 pointer-events-none"
          style={{ top: s.top, left: s.left, width: s.w, height: s.h, background: s.color, transform: `rotate(${s.rot}deg)` }}
        />
      ))}
      <div className="px-4 pt-12 pb-5 relative" style={{ maxWidth: '50%' }}>{children}</div>
      <div style={{ transform: 'rotate(180deg)' }}><BuntingStrip colors={buntingColors} /></div>
    </div>
  )
}
