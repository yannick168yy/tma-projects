const localizedImages = import.meta.glob('../assets/localized/**/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export function localizedImage(defaultUrl: string, locale: string, assetName: string): string {
  const language = locale.toLowerCase().startsWith('id') ? 'id'
    : locale.toLowerCase().startsWith('vi') ? 'vi'
      : locale.toLowerCase().startsWith('zh') ? 'zh-CN'
        : 'en'
  return localizedImages[`../assets/localized/${language}/${assetName}`] ?? defaultUrl
}
