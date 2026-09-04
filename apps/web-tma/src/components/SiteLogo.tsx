import { getBrand } from '@/config/brand'

interface Props {
  showBadge?: boolean
  /** 不传则用品牌短名 */
  badgeText?: string
}

/**
 * 站点 logo（P1-10/P1-12）。
 *
 * 配了图片就用图片，没配就用文字 logo —— 多数包网客户会给图，
 * 但开站当天往往还没有，文字 logo 让站点立刻就能挂上自己的名字。
 */
export default function SiteLogo({ showBadge = false, badgeText }: Props) {
  const brand = getBrand()
  const logoUrl = brand.logoDarkUrl ?? brand.logoLightUrl
  const badge = badgeText ?? brand.shortName

  return (
    <div
      className="relative flex items-center justify-center"
      role="img"
      aria-label={brand.tagline ? `${brand.siteName} ${brand.tagline}` : brand.siteName}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={brand.siteName} className="h-9 w-auto object-contain" />
      ) : (
        <div className="flex flex-col leading-none" style={{ gap: '2.5px' }}>
          <div className="flex items-baseline">
            <span className="font-display text-[1.3rem] font-black leading-none text-foreground">{brand.logoTextPrimary}</span>
            <span className="font-display text-[1.3rem] font-black leading-none text-primary">{brand.logoTextAccent}</span>
          </div>
          {brand.tagline && (
            <div className="flex items-center gap-px leading-none">
              {brand.tagline.split(' ').map((word, i) => (
                <span
                  key={`${word}-${i}`}
                  className={`text-[0.54rem] font-extrabold ${i === 1 ? 'text-primary' : 'text-foreground/45'}`}
                >
                  {word}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {showBadge && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-black text-primary-foreground">
          {badge}
        </span>
      )}
    </div>
  )
}
