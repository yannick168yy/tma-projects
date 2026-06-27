import type { ReactNode } from 'react'
import peryaHero from '@/assets/bingo/perya.webp'

interface Props { children?: ReactNode }

export default function PeryaCarnivalHero({ children }: Props) {
  return (
    <div className="relative overflow-hidden bg-[#12002b]">
      <img
        src={peryaHero}
        alt="Perya and Bingo"
        className="block w-full h-auto"
      />
      {children && (
        <div className="absolute left-[3.6%] bottom-[16.8%] w-[45%] h-[9.6%]">
          {children}
        </div>
      )}
    </div>
  )
}
