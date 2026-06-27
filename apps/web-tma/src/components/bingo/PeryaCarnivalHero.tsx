import peryaHero from '@/assets/bingo/perya.webp'

export default function PeryaCarnivalHero() {
  return (
    <div className="relative overflow-hidden bg-[#12002b]">
      <img
        src={peryaHero}
        alt="Perya and Bingo"
        className="block w-full h-auto"
      />
    </div>
  )
}
