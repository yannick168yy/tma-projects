import BetogoLogo from '@/components/BetogoLogo'

interface Props {
  error?: string | null
}

export default function SplashPage({ error }: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#040609]">
      <div className="mb-8" style={{ animation: 'splash-pulse 1.6s ease-in-out infinite' }}>
        <BetogoLogo />
      </div>
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block rounded-full bg-amber-400"
            style={{
              width: 8, height: 8,
              animation: 'splash-bounce 0.9s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
      {error && <p className="mt-6 max-w-[260px] text-center text-sm text-red-400">{error}</p>}
      <style>{`
        @keyframes splash-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(0.97); }
        }
        @keyframes splash-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
