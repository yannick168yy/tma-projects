interface IconProps {
  className?: string
}

export function MaxRateIcon({ className = 'h-6 w-6' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="cb-max-rate" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9" stroke="url(#cb-max-rate)" strokeWidth="1.75" />
      <path d="M9.5 14.5L14.5 9.5" stroke="url(#cb-max-rate)" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="9.5" cy="9.5" r="1.5" fill="url(#cb-max-rate)" />
      <circle cx="14.5" cy="14.5" r="1.5" fill="url(#cb-max-rate)" />
      <path d="M12 3.5L10 5.5M12 3.5L14 5.5" stroke="url(#cb-max-rate)" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

export function AutoCreditIcon({ className = 'h-6 w-6' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="cb-auto-credit" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path
        d="M4 13C4 12.4477 4.44772 12 5 12H19C19.5523 12 20 12.4477 20 13V18C20 18.5523 19.5523 19 19 19H5C4.44772 19 4 18.5523 4 18V13Z"
        stroke="url(#cb-auto-credit)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path d="M4 15.5H20" stroke="url(#cb-auto-credit)" strokeWidth="1.75" strokeLinecap="round" />
      <path
        d="M4 15.5H20V18C20 18.5523 19.5523 19 19 19H5C4.44772 19 4 18.5523 4 18V15.5Z"
        fill="url(#cb-auto-credit)"
        fillOpacity="0.2"
      />
      <path
        d="M8 8C6.5 6 4 6 4 8C4 10 6 11 8 11C10 11 11 9 11 8C11 6 9.5 5 8 5Z"
        fill="url(#cb-auto-credit)"
        fillOpacity="0.2"
        stroke="url(#cb-auto-credit)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path d="M8 8C6.5 6 4 6 4 8" stroke="url(#cb-auto-credit)" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="17" cy="6" r="2" fill="url(#cb-auto-credit)" />
      <path d="M17 8L12 12" stroke="url(#cb-auto-credit)" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="2 2" />
    </svg>
  )
}

export function EveryBetIcon({ className = 'h-6 w-6' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="cb-every-bet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path
        d="M12 5C8.5 5 5.5 7 4 10C5.5 13 8.5 15 12 15C15.5 15 18.5 13 20 10C18.5 7 15.5 5 12 5Z"
        stroke="url(#cb-every-bet)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="url(#cb-every-bet)"
        fillOpacity="0.12"
      />
      <path d="M8 10H16" stroke="url(#cb-every-bet)" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M12 15V19M9 17H15" stroke="url(#cb-every-bet)" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}
