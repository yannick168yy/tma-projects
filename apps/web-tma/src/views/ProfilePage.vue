<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle2, Copy, ChevronDown, ChevronRight, LogOut, Headphones, X } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import type { LoginProvider } from '@/types/api'
import { formatTelegramHandle, getTelegramWebAppUser } from '@/utils/telegramUser'
import { patchProfile } from '@/api/auth'
import ContactBrandIcon from '@/components/profile/ContactBrandIcon.vue'
import ContactMethodRow from '@/components/profile/ContactMethodRow.vue'

const emit = defineEmits<{ logout: []; 'open-cs': [] }>()

const { t } = useI18n()
const auth = useAuthStore()
const loggingOut = ref(false)
const logoutConfirmOpen = ref(false)
const personalSaved = ref(false)
const personalSaving = ref(false)
const personalError = ref('')
const copied = ref(false)
const firstName = ref('')
const lastName = ref('')
const dobMonth = ref('')
const dobDay = ref('')
const dobYear = ref('')
const dobOpen = ref(false)
const gender = ref('')
const phone = ref('')
const emailExtra = ref('')

const USER_ID = computed(() => auth.user?.id ?? '—')
const displayName = computed(() => auth.user?.displayName ?? t('profile.playerAccount'))

const loginProvider = computed<LoginProvider>(
  () => auth.user?.loginProvider ?? (auth.user?.telegramUserId ? 'telegram' : 'google'),
)

const isTelegramLogin = computed(() => loginProvider.value === 'telegram')
const isGoogleLogin = computed(() => loginProvider.value === 'google')

const telegramHandle = computed(() => {
  const fromApi = formatTelegramHandle(auth.user?.telegramUsername)
  if (fromApi) return fromApi
  return formatTelegramHandle(getTelegramWebAppUser()?.username)
})

const telegramSubtitle = computed(() => {
  if (!isTelegramLogin.value) return t('profile.notConnected')
  return telegramHandle.value ?? t('profile.connected')
})

const googleEmail = computed(() => auth.user?.email?.trim() ?? '')

const isGoogleEmailConnected = computed(() => isGoogleLogin.value && Boolean(googleEmail.value))

const emailRowTitle = computed(() =>
  isGoogleLogin.value ? t('profile.google') : t('profile.emailAddress'),
)

const emailRowSubtitle = computed(() => {
  if (isGoogleLogin.value) return googleEmail.value || t('profile.notConnected')
  return emailExtra.value.trim() || t('profile.addEmailOptional')
})

/** Login method row appears first in Contact Information. */
const contactOrder = computed(() =>
  loginProvider.value === 'google'
    ? (['email', 'telegram', 'phone'] as const)
    : (['telegram', 'phone', 'email'] as const),
)

const MONTHS = computed(() =>
  Array.from({ length: 12 }, (_, i) => t(`profile.months.${i + 1}`)),
)

const genderOptions = computed(() => [
  { id: 'Male', label: t('profile.male') },
  { id: 'Female', label: t('profile.female') },
  { id: 'Other', label: t('profile.other') },
])

const CURRENCIES = [
  { symbol: '₱', name: 'PHP', color: 'from-blue-600 to-blue-800' },
  { symbol: '₮', name: 'USDT', color: 'from-teal-500 to-emerald-600' },
  { symbol: '💎', name: 'TON', color: 'from-sky-400 to-blue-600' },
  { symbol: '₿', name: 'BTC', color: 'from-orange-400 to-amber-600' },
  { symbol: 'Ξ', name: 'ETH', color: 'from-purple-500 to-indigo-700' },
  { symbol: '◈', name: 'BNB', color: 'from-yellow-400 to-yellow-600' },
]

const LINKS = computed(() => [
  { icon: '📢', label: t('profile.links.channel'), sub: t('profile.links.channelSub'), color: 'from-blue-600 to-blue-800' },
  { icon: '💬', label: t('profile.links.community'), sub: t('profile.links.communitySub'), color: 'from-indigo-600 to-violet-700' },
  { icon: '🎰', label: t('profile.links.vip'), sub: t('profile.links.vipSub'), color: 'from-yellow-500 to-amber-600' },
  { icon: '📱', label: t('profile.links.facebook'), sub: t('profile.links.facebookSub'), color: 'from-blue-500 to-blue-700' },
])

const SUPPORT_ITEMS = computed(() => [
  {
    icon: '💬',
    label: t('profile.supportItems.liveChat'),
    sub: t('profile.supportItems.liveChatSub'),
    badge: t('common.online'),
    badgeColor: 'bg-emerald-500/20 text-emerald-400',
  },
  {
    icon: '📩',
    label: t('profile.supportItems.telegram'),
    sub: '@TarsierWin_Support',
    badge: null,
    badgeColor: '',
  },
  {
    icon: '📧',
    label: t('profile.supportItems.email'),
    sub: 'support@tarsierwin.com',
    badge: null,
    badgeColor: '',
  },
])

const DOCS = computed(() => [
  { key: 'terms',        label: t('profile.docs.terms'),        icon: '📋' },
  { key: 'privacy',      label: t('profile.docs.privacy'),      icon: '🔒' },
  { key: 'responsible',  label: t('profile.docs.responsible'),  icon: '🛡️' },
  { key: 'aml',          label: t('profile.docs.aml'),          icon: '⚖️' },
  { key: 'bonusTerms',   label: t('profile.docs.bonusTerms'),   icon: '🎁' },
  { key: 'about',        label: t('profile.docs.about'),        icon: 'ℹ️' },
])

// 复用首页 infoDetails 内容的 doc 键
const HOME_DOC_KEYS = new Set(['terms', 'privacy', 'responsible', 'about'])

const comingSoonToast = ref(false)
let comingSoonTimer: ReturnType<typeof setTimeout> | null = null
function showComingSoon() {
  if (comingSoonTimer) clearTimeout(comingSoonTimer)
  comingSoonToast.value = true
  comingSoonTimer = setTimeout(() => {
    comingSoonToast.value = false
  }, 2200)
}
const docModalKey = ref<string | null>(null)

function openDoc(key: string) { docModalKey.value = key }
function closeDoc() { docModalKey.value = null }

const docTitle = computed(() =>
  docModalKey.value ? t(`profile.docs.${docModalKey.value}`) : '',
)

const parsedDocContent = computed(() => {
  if (!docModalKey.value) return []
  const raw = HOME_DOC_KEYS.has(docModalKey.value)
    ? t(`home.infoDetails.${docModalKey.value}.content`)
    : t(`profile.docDetails.${docModalKey.value}.content`)
  const chunks = raw.split('\n\n').map((c) => c.trim()).filter(Boolean)
  const sections: { heading: string | null; body: string }[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const isHeading = chunk.length <= 60 && !chunk.includes('\n') && !/[.?!,。，！？]$/.test(chunk)
    if (isHeading && i + 1 < chunks.length) {
      sections.push({ heading: chunk, body: chunks[i + 1] })
      i++
    } else {
      sections.push({ heading: null, body: chunk })
    }
  }
  return sections
})

const dobFilled = computed(() => !!(dobMonth.value && dobDay.value && dobYear.value))

const dobDisplay = computed(() => {
  if (!dobFilled.value) return ''
  const m = MONTHS.value[parseInt(dobMonth.value, 10) - 1]
  return `${m} ${parseInt(dobDay.value, 10)}, ${dobYear.value}`
})

const years = computed(() => {
  const currentYear = new Date().getFullYear()
  return Array.from({ length: currentYear - 1924 }, (_, i) => currentYear - 18 - i)
})

const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))

function copyId() {
  const id = auth.user?.id
  if (!id) return
  navigator.clipboard?.writeText(id).catch(() => {})
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function requestLogout() {
  logoutConfirmOpen.value = true
}

function cancelLogout() {
  logoutConfirmOpen.value = false
}

async function confirmLogout() {
  loggingOut.value = true
  try {
    await auth.logout()
    logoutConfirmOpen.value = false
    emit('logout')
  } finally {
    loggingOut.value = false
  }
}

onMounted(() => {
  const p = auth.user?.profile
  if (p) {
    firstName.value = p.firstName ?? ''
    lastName.value = p.lastName ?? ''
    gender.value = p.gender ?? ''
    dobMonth.value = p.dobMonth ?? ''
    dobDay.value = p.dobDay ?? ''
    dobYear.value = p.dobYear ?? ''
  }
})

watch(docModalKey, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

onUnmounted(() => {
  document.body.style.overflow = ''
  if (comingSoonTimer) clearTimeout(comingSoonTimer)
})

async function savePersonal() {
  if (!firstName.value || !lastName.value || !dobFilled.value || !gender.value) return
  personalSaving.value = true
  personalError.value = ''
  try {
    const saved = await patchProfile({
      firstName: firstName.value,
      lastName: lastName.value,
      gender: gender.value as 'male' | 'female' | 'other' | '',
      dobMonth: dobMonth.value,
      dobDay: dobDay.value,
      dobYear: dobYear.value,
    })
    if (auth.user) auth.user = { ...auth.user, profile: saved }
    personalSaved.value = true
    dobOpen.value = false
  } catch (e) {
    personalError.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    personalSaving.value = false
  }
}
</script>

<template>
  <div class="min-h-full pb-24">
    <div class="flex items-center gap-4 border-b border-border bg-card px-5 py-4">
      <div class="h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">
        <svg viewBox="0 0 40 40" width="48" height="48" class="h-full w-full" aria-hidden="true">
          <ellipse cx="20" cy="26" rx="11" ry="9" fill="#92400e" />
          <ellipse cx="20" cy="19" rx="13" ry="13" fill="#a16207" />
          <ellipse cx="20" cy="20" rx="9" ry="9" fill="#b45309" />
          <circle cx="14" cy="17" r="6" fill="white" />
          <circle cx="26" cy="17" r="6" fill="white" />
          <circle cx="14" cy="17" r="4.2" fill="#1e293b" />
          <circle cx="26" cy="17" r="4.2" fill="#1e293b" />
          <circle cx="15.5" cy="15.5" r="1.4" fill="white" />
          <circle cx="27.5" cy="15.5" r="1.4" fill="white" />
          <ellipse cx="20" cy="22" rx="1.8" ry="1.2" fill="#7c2d12" />
          <ellipse cx="8" cy="12" rx="4" ry="5" fill="#92400e" />
          <ellipse cx="32" cy="12" rx="4" ry="5" fill="#92400e" />
          <ellipse cx="8" cy="12" rx="2.2" ry="3.2" fill="#b45309" />
          <ellipse cx="32" cy="12" rx="2.2" ry="3.2" fill="#b45309" />
        </svg>
      </div>
      <div class="min-w-0 flex-1">
        <p class="mb-1 text-sm font-black leading-none text-foreground">{{ displayName }}</p>
        <button type="button" class="flex items-center gap-1.5 transition-opacity hover:opacity-80" @click="copyId">
          <span class="text-xs text-muted-foreground">ID: </span>
          <span class="text-xs font-bold text-primary">{{ USER_ID }}</span>
          <CheckCircle2 v-if="copied" :size="11" class="text-emerald-400" />
          <Copy v-else :size="11" class="text-muted-foreground" />
        </button>
        <p v-if="copied" class="mt-0.5 text-[10px] font-semibold text-emerald-400">{{ t('common.copied') }}</p>
      </div>
    </div>

    <div class="mt-4 space-y-4 px-5">
      <section>
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-display text-sm font-black text-foreground">{{ t('profile.personalInfo') }}</h3>
          <span v-if="personalSaved" class="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 :size="11" /> {{ t('common.verified') }}
          </span>
        </div>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <div class="border-b border-border px-4 py-3">
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{ t('profile.firstName') }}</label>
            <input
              v-model="firstName"
              type="text"
              :placeholder="t('profile.firstNamePh')"
              :readonly="personalSaved"
              class="w-full bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
          <div class="border-b border-border px-4 py-3">
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{ t('profile.lastName') }}</label>
            <input
              v-model="lastName"
              type="text"
              :placeholder="t('profile.lastNamePh')"
              :readonly="personalSaved"
              class="w-full bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
          <div
            class="cursor-pointer border-b border-border px-4 py-3"
            @click="!personalSaved && (dobOpen = !dobOpen)"
          >
            <label class="mb-1 block cursor-pointer text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {{ t('profile.dateOfBirth') }}
            </label>
            <template v-if="personalSaved">
              <p class="text-sm font-semibold text-foreground">{{ dobDisplay || '—' }}</p>
            </template>
            <template v-else>
              <div class="flex items-center justify-between">
                <span
                  class="text-sm font-semibold"
                  :class="dobFilled ? 'text-foreground' : 'text-muted-foreground/50'"
                >
                  {{ dobFilled ? dobDisplay : t('profile.selectDob') }}
                </span>
                <ChevronDown
                  :size="14"
                  class="text-muted-foreground transition-transform duration-200"
                  :class="dobOpen ? 'rotate-180' : ''"
                />
              </div>
              <div v-if="dobOpen" class="mt-3 grid grid-cols-3 gap-2" @click.stop>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-bold uppercase text-muted-foreground">{{ t('profile.month') }}</span>
                  <select
                    v-model="dobMonth"
                    class="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">{{ t('profile.month') }}</option>
                    <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1).padStart(2, '0')">{{ m }}</option>
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-bold uppercase text-muted-foreground">{{ t('profile.day') }}</span>
                  <select
                    v-model="dobDay"
                    class="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">{{ t('profile.day') }}</option>
                    <option v-for="d in days" :key="d" :value="d">{{ parseInt(d, 10) }}</option>
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-bold uppercase text-muted-foreground">{{ t('profile.year') }}</span>
                  <select
                    v-model="dobYear"
                    class="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">{{ t('profile.year') }}</option>
                    <option v-for="y in years" :key="y" :value="String(y)">{{ y }}</option>
                  </select>
                </div>
                <button
                  v-if="dobFilled"
                  type="button"
                  class="col-span-3 mt-1 rounded-lg bg-primary/20 py-1.5 text-xs font-black text-primary transition-colors hover:bg-primary/30"
                  @click="dobOpen = false"
                >
                  {{ t('profile.confirmDob', { date: dobDisplay }) }}
                </button>
              </div>
            </template>
          </div>
          <div class="px-4 py-3">
            <label class="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{ t('profile.gender') }}</label>
            <div class="flex gap-2">
              <button
                v-for="g in genderOptions"
                :key="g.id"
                type="button"
                :disabled="personalSaved"
                class="flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors"
                :class="[
                  gender === g.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                  personalSaved ? 'cursor-default opacity-60' : 'hover:text-foreground',
                ]"
                @click="!personalSaved && (gender = g.id)"
              >
                {{ g.label }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="personalError" class="mt-1 text-center text-xs font-bold text-red-400">{{ personalError }}</p>
        <button
          v-if="!personalSaved"
          type="button"
          class="mt-2.5 w-full rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground shadow shadow-amber-500/20 transition-colors hover:bg-yellow-400 disabled:opacity-50"
          :disabled="personalSaving"
          @click="savePersonal"
        >
          {{ personalSaving ? '保存中…' : t('profile.saveLock') }}
        </button>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">{{ t('profile.contactInfo') }}</h3>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <template v-for="(block, idx) in contactOrder" :key="block">
            <div :class="idx < contactOrder.length - 1 ? 'border-b border-border' : ''">
              <ContactMethodRow
                v-if="block === 'telegram'"
                :title="t('profile.telegram')"
                :subtitle="telegramSubtitle"
                :connected="isTelegramLogin"
                :subtitle-connected="isTelegramLogin"
              >
                <template #icon>
                  <ContactBrandIcon brand="telegram" />
                </template>
              </ContactMethodRow>

              <ContactMethodRow
                v-else-if="block === 'email'"
                :title="emailRowTitle"
                :subtitle="emailRowSubtitle"
                :connected="isGoogleEmailConnected"
                :subtitle-connected="isGoogleEmailConnected"
              >
                <template #icon>
                  <ContactBrandIcon :brand="isGoogleLogin ? 'google' : 'email'" />
                </template>
                <template v-if="!isGoogleLogin" #subtitle>
                  <input
                    v-model="emailExtra"
                    type="email"
                    placeholder="your@email.com"
                    class="w-full bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                  />
                </template>
              </ContactMethodRow>

              <ContactMethodRow
                v-else-if="block === 'phone'"
                :title="t('profile.phoneNumber')"
                :subtitle="t('profile.addPhoneOptional')"
              >
                <template #icon>
                  <ContactBrandIcon brand="phone" />
                </template>
                <template #subtitle>
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs text-muted-foreground">🇵🇭 +63</span>
                    <input
                      v-model="phone"
                      type="tel"
                      placeholder="9XX XXX XXXX"
                      class="min-w-0 flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                    />
                  </div>
                </template>
              </ContactMethodRow>
            </div>
          </template>
        </div>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">{{ t('profile.customerSupportSection') }}</h3>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <button
            v-for="(item, i) in SUPPORT_ITEMS"
            :key="item.label"
            type="button"
            class="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/50"
            :class="i < SUPPORT_ITEMS.length - 1 ? 'border-b border-border' : ''"
            @click="i === 0 ? emit('open-cs') : (showComingSoon())"
          >
            <div class="flex items-center gap-3">
              <span class="text-xl">{{ item.icon }}</span>
              <div class="text-left">
                <p class="text-sm font-bold text-foreground">{{ item.label }}</p>
                <p class="text-xs text-muted-foreground">{{ item.sub }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="item.badge" class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="item.badgeColor">{{ item.badge }}</span>
              <ChevronRight :size="14" class="text-muted-foreground" />
            </div>
          </button>
        </div>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">{{ t('profile.communityMedia') }}</h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="l in LINKS"
            :key="l.label"
            type="button"
            class="relative rounded-2xl bg-gradient-to-br p-4 text-left transition-opacity hover:opacity-90"
            :class="l.color"
            @click.stop="showComingSoon()"
          >
            <span class="mb-2 block text-2xl">{{ l.icon }}</span>
            <p class="text-xs font-black leading-tight text-white">{{ l.label }}</p>
            <p class="mt-0.5 text-[10px] text-white/60">{{ l.sub }}</p>
            <ChevronRight :size="12" class="absolute right-3 top-3 text-white/50" />
          </button>
        </div>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">{{ t('profile.supportedCurrencies') }}</h3>
        <div class="grid grid-cols-6 gap-2">
          <div v-for="c in CURRENCIES" :key="c.name" class="flex flex-col items-center gap-1">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-md" :class="c.color">
              <span class="text-sm font-black text-white">{{ c.symbol }}</span>
            </div>
            <span class="text-[10px] font-bold text-muted-foreground">{{ c.name }}</span>
          </div>
        </div>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">{{ t('profile.legalPolicies') }}</h3>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <button
            v-for="(d, i) in DOCS"
            :key="d.key"
            type="button"
            class="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/50"
            :class="i < DOCS.length - 1 ? 'border-b border-border' : ''"
            @click.stop="openDoc(d.key)"
          >
            <div class="flex items-center gap-3">
              <span class="text-base">{{ d.icon }}</span>
              <span class="text-sm font-semibold text-foreground">{{ d.label }}</span>
            </div>
            <ChevronRight :size="14" class="text-muted-foreground" />
          </button>
        </div>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">{{ t('profile.account') }}</h3>
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 py-3 text-sm font-black text-primary transition-colors hover:bg-primary/20 mb-3"
          @click="emit('open-cs')"
        >
          <Headphones :size="16" />
          联系客服
        </button>
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 py-3 text-sm font-black text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-60"
          :disabled="loggingOut"
          @click="requestLogout"
        >
          <LogOut :size="16" />
          {{ t('profile.logout') }}
        </button>
      </section>

      <Teleport to="#app">
        <Transition name="toast-up">
          <div
            v-if="comingSoonToast"
            class="profile-toast fixed left-1/2 z-[200] flex max-w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <span class="text-xl leading-none">🚀</span>
            <div class="min-w-0">
              <p class="text-sm font-black leading-tight text-foreground">{{ t('profile.comingSoon') }}</p>
              <p class="mt-0.5 text-xs leading-snug text-muted-foreground">{{ t('profile.comingSoonSub') }}</p>
            </div>
          </div>
        </Transition>
      </Teleport>

      <Teleport to="#app">
        <div
          v-if="docModalKey"
          class="fixed inset-0 z-[200] flex justify-center"
          role="dialog"
          aria-modal="true"
        >
          <div class="relative flex h-full w-full max-w-[430px] flex-col justify-end">
            <div class="absolute inset-0 bg-black/60" aria-hidden="true" @click="closeDoc()" />
            <div class="relative z-10 flex max-h-[82vh] flex-col rounded-t-2xl bg-card shadow-2xl">
              <div class="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
                <h2 class="font-display text-base font-black text-foreground">{{ docTitle }}</h2>
                <button type="button" class="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" @click="closeDoc()">
                  <X :size="15" class="text-muted-foreground" />
                </button>
              </div>
              <div class="overflow-y-auto px-5 py-5 space-y-4">
                <div v-for="(s, i) in parsedDocContent" :key="i">
                  <p v-if="s.heading" class="mb-1.5 border-l-2 border-primary pl-2.5 font-display text-[11px] font-black uppercase tracking-widest text-primary">
                    {{ s.heading }}
                  </p>
                  <p class="whitespace-pre-line text-[13px] leading-relaxed text-foreground/70">{{ s.body }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <Teleport to="#app">
        <div
          v-if="logoutConfirmOpen"
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
        >
          <div class="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h3 id="logout-confirm-title" class="text-base font-black text-foreground">{{ t('profile.logoutConfirmTitle') }}</h3>
            <p class="mt-2 text-sm text-muted-foreground">{{ t('profile.logoutConfirmBody2') }}</p>
            <div class="mt-5 flex gap-2">
              <button
                type="button"
                class="flex-1 rounded-xl bg-secondary py-2.5 text-sm font-bold text-foreground"
                :disabled="loggingOut"
                @click="cancelLogout"
              >
                {{ t('profile.cancel') }}
              </button>
              <button
                type="button"
                class="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-black text-white disabled:opacity-60"
                :disabled="loggingOut"
                @click="confirmLogout"
              >
                {{ loggingOut ? t('profile.signingOut') : t('profile.confirmLogout') }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <div class="space-y-1 py-4 text-center">
        <p class="text-xs text-muted-foreground">{{ t('profile.footerVersion') }}</p>
        <p class="text-xs text-muted-foreground">{{ t('profile.footerCopyright') }}</p>
        <p class="mt-2 px-4 text-[10px] leading-relaxed text-muted-foreground">{{ t('profile.footerLegal') }}</p>
      </div>
    </div>
  </div>
</template>
