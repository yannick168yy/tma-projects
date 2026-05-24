import { defineStore } from 'pinia'
import type { UserProfile } from '@/types/api'

const STORAGE_KEY = 'betogo_profile'

export const useUserStore = defineStore('user', {
  state: (): { profile: UserProfile } => ({
    profile: loadProfile(),
  }),

  getters: {
    profileComplete: (s) =>
      Boolean(s.profile.firstName && s.profile.lastName && s.profile.gender && s.profile.dobYear),
  },

  actions: {
    saveProfile(profile: UserProfile) {
      this.profile = profile
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
    },
  },
})

function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as UserProfile
  } catch {
    /* ignore */
  }
  return { firstName: '', lastName: '', gender: '', dobMonth: '', dobDay: '', dobYear: '' }
}
