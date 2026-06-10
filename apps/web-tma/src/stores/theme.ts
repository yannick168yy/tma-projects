import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'system' | 'dark' | 'light'

interface ThemeStore {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

function applyTheme(mode: ThemeMode) {
  const preferLight = window.matchMedia('(prefers-color-scheme: light)').matches
  const isLight = mode === 'light' || (mode === 'system' && preferLight)
  document.documentElement.classList.toggle('light', isLight)
}

let mqListener: (() => void) | null = null

function bindSystemListener(mode: ThemeMode) {
  if (mqListener) {
    window.matchMedia('(prefers-color-scheme: light)').removeEventListener('change', mqListener)
    mqListener = null
  }
  if (mode === 'system') {
    mqListener = () => applyTheme('system')
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', mqListener)
  }
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: 'dark',
      setMode: (mode) => {
        set({ mode })
        applyTheme(mode)
        bindSystemListener(mode)
      },
    }),
    { name: 'theme-mode' },
  ),
)

export function initTheme() {
  const mode = (useThemeStore.getState().mode ?? 'system') as ThemeMode
  applyTheme(mode)
  bindSystemListener(mode)
}
