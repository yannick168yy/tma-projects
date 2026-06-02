import { CheckCircle2, Lock, Send } from 'lucide-react'
import type { PayMethod } from '@/data/wallet'

interface Props {
  methods: PayMethod[]
  selected: string | null
  onSelect: (id: string) => void
}

function isEnabled(m: PayMethod): boolean {
  return m.enabled !== false
}

export default function PayMethodGrid({ methods, selected, onSelect }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {methods.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all ${
            !isEnabled(m) ? 'opacity-45 cursor-not-allowed border-border bg-secondary' :
            selected === m.id ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20' :
            'border-border bg-secondary hover:border-white/20'
          }`}
          disabled={!isEnabled(m)}
          onClick={() => isEnabled(m) && onSelect(m.id)}
        >
          {m.iconUrl ? (
            <div className="w-11 h-11 rounded-xl overflow-hidden shadow-md flex-shrink-0">
              <img src={m.iconUrl} alt={m.name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md ${m.color}`}>
              {m.iconKind === 'telegram' ? (
                <Send size={22} className="text-white" strokeWidth={2.5} />
              ) : (
                <span className="text-white font-black" style={{ fontSize: m.icon.length > 1 ? '20px' : '22px' }}>
                  {m.icon}
                </span>
              )}
            </div>
          )}
          <p className="text-[10px] font-bold text-foreground text-center leading-tight">{m.name}</p>
          {m.tag && <span className="text-[9px] text-muted-foreground">{m.tag}</span>}
          {selected === m.id && (
            <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
              <CheckCircle2 size={10} className="text-primary-foreground" />
            </div>
          )}
          {!isEnabled(m) && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
              <Lock size={14} className="text-muted-foreground" />
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
