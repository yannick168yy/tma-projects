interface Props {
  showBadge?: boolean
  badgeText?: string
}

export default function BetogoLogo({ showBadge = false, badgeText = 'B' }: Props) {
  return (
    <div className="relative flex items-center justify-center" role="img" aria-label="BETOGO.PH Bet. Go. Win">
      <div className="flex flex-col leading-none" style={{ gap: '2.5px' }}>
        <div className="flex items-baseline">
          <span className="font-display text-[1.3rem] font-black leading-none text-foreground">BETO</span>
          <span className="font-display text-[1.3rem] font-black leading-none text-primary">GO</span>
          <span className="font-display text-[0.78rem] font-black leading-none text-primary/80">.PH</span>
        </div>
        <div className="flex items-center gap-px leading-none">
          <span className="text-[0.54rem] font-extrabold text-foreground/45">Bet.</span>
          <span className="text-[0.54rem] font-extrabold text-primary">Go.</span>
          <span className="text-[0.54rem] font-extrabold text-foreground/45">Win</span>
        </div>
      </div>
      {showBadge && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-black text-primary-foreground">
          {badgeText}
        </span>
      )}
    </div>
  )
}
