interface Props {
  icon: string
  value: string
  label: string
  index: number
  onClick: () => void
}

// 扁平风格底色：按位置从紫色快速过渡到灰色。
// 第1张=紫，第2张=0.4，第3张=0.8，第4张及以后=纯灰（每张 +0.4，封顶 1）。
const PURPLE = [74, 62, 120]
const GRAY = [71, 70, 80]
function flatCardBg(index: number): string {
  const ratio = Math.min(1, index * 0.4)
  const c = (i: number) => Math.round(PURPLE[i] + (GRAY[i] - PURPLE[i]) * ratio)
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`
}

// 小卡片背景皮肤固定在代码里，未来只换图标(icon)和文字(value/label)。
// 同款皮肤在后台装修预览(web-admin HomeContentConfig)中同步维护。
export default function HomeCategoryShortcut({ icon, value, label, index, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 flex h-[60px] w-[111px] items-center gap-1.5 overflow-hidden rounded-xl px-2 active:scale-[0.98] transition-transform"
      style={{
        background: flatCardBg(index),
        boxShadow: '0 4px 10px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.07)',
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
