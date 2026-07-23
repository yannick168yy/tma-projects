/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BFF_BASE_URL: string
  readonly VITE_USE_MOCK_API: string
  readonly VITE_GOOGLE_CLIENT_ID: string
  readonly VITE_GOOGLE_REDIRECT_URI: string
  readonly VITE_TELEGRAM_OIDC_CLIENT_ID: string
  readonly VITE_TELEGRAM_BOT_USERNAME: string
  readonly VITE_GA_MEASUREMENT_ID: string
  readonly VITE_GA_DEBUG_MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
