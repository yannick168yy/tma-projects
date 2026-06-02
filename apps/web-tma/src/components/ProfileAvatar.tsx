export default function ProfileAvatar() {
  return (
    <div
      className="w-10 h-10 rounded-xl overflow-hidden shadow-md"
      style={{ background: 'linear-gradient(145deg, #d97706, #fbbf24)' }}
    >
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle cx="7" cy="10" r="6.5" fill="#92400e" />
        <circle cx="7" cy="10" r="3.8" fill="#c07022" opacity="0.85" />
        <circle cx="33" cy="10" r="6.5" fill="#92400e" />
        <circle cx="33" cy="10" r="3.8" fill="#c07022" opacity="0.85" />
        <circle cx="20" cy="22" r="16" fill="#a16207" />
        <ellipse cx="20" cy="23" rx="12" ry="11" fill="#ca8a04" />
        <circle cx="13" cy="20" r="6.5" fill="white" />
        <circle cx="13" cy="20" r="5" fill="#1e1b4b" />
        <circle cx="13" cy="20" r="3" fill="#0f172a" />
        <circle cx="11" cy="18" r="2.2" fill="white" />
        <circle cx="27" cy="20" r="6.5" fill="white" />
        <circle cx="27" cy="20" r="5" fill="#1e1b4b" />
        <circle cx="27" cy="20" r="3" fill="#0f172a" />
        <circle cx="25" cy="18" r="2.2" fill="white" />
        <ellipse cx="20" cy="26" rx="2" ry="1.4" fill="#78350f" />
        <path d="M17.5 28.5 Q20 30.5 22.5 28.5" stroke="#78350f" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <circle cx="8" cy="27" r="3.5" fill="#f97316" opacity="0.28" />
        <circle cx="32" cy="27" r="3.5" fill="#f97316" opacity="0.28" />
      </svg>
    </div>
  )
}
