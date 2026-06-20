interface Props {
  icon: string
  value: string
  label: string
  onClick: () => void
}

// 小卡片背景皮肤固定在代码里，未来只换图标(icon)和文字(value/label)。
// 同款皮肤在后台装修预览(web-admin HomeContentConfig)中同步维护。
export default function HomeCategoryShortcut({ icon, value, label, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 flex h-[60px] w-[120px] items-center gap-1.5 overflow-hidden rounded-xl px-2 active:scale-[0.98] transition-transform"
      style={{
        background: 'radial-gradient(120% 120% at 0% 0%, #5b3fa0 0%, #382a6b 45%, #271d52 100%)',
        boxShadow: '0 6px 14px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {icon && (
        <img src={icon} alt="" draggable={false} className="h-8 w-8 flex-shrink-0 object-contain" />
      )}
      <div className="flex min-w-0 flex-col items-start leading-tight">
        <span
          className="w-full truncate text-[13px] font-black text-amber-300"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
        >
          {value}
        </span>
        <span className="w-full truncate text-[11px] font-semibold text-white/85">{label}</span>
      </div>
    </button>
  )
}
