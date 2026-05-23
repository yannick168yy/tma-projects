<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCircle2, Copy, ChevronDown, ChevronRight } from 'lucide-vue-next'

const personalSaved = ref(false)
const copied = ref(false)
const firstName = ref('')
const lastName = ref('')
const dobMonth = ref('')
const dobDay = ref('')
const dobYear = ref('')
const dobOpen = ref(false)
const gender = ref('')
const telegramLinked = ref(false)
const phone = ref('')
const email = ref('')

const USER_ID = 'TW-8842916'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const CURRENCIES = [
  { symbol: '₱', name: 'PHP', color: 'from-blue-600 to-blue-800' },
  { symbol: '₮', name: 'USDT', color: 'from-teal-500 to-emerald-600' },
  { symbol: '💎', name: 'TON', color: 'from-sky-400 to-blue-600' },
  { symbol: '₿', name: 'BTC', color: 'from-orange-400 to-amber-600' },
  { symbol: 'Ξ', name: 'ETH', color: 'from-purple-500 to-indigo-700' },
  { symbol: '◈', name: 'BNB', color: 'from-yellow-400 to-yellow-600' },
]

const LINKS = [
  { icon: '📢', label: 'Official Channel', sub: 'News & announcements', color: 'from-blue-600 to-blue-800' },
  { icon: '💬', label: 'Community Group', sub: 'Chat with players', color: 'from-indigo-600 to-violet-700' },
  { icon: '🎰', label: 'VIP Club', sub: 'Exclusive member perks', color: 'from-yellow-500 to-amber-600' },
  { icon: '📱', label: 'Facebook Page', sub: 'Follow for promotions', color: 'from-blue-500 to-blue-700' },
]

const SUPPORT_ITEMS = [
  { icon: '💬', label: 'Live Chat', sub: 'Available 24/7', badge: 'Online', badgeColor: 'bg-emerald-500/20 text-emerald-400' },
  { icon: '📩', label: 'Telegram Support', sub: '@TarsierWin_Support', badge: null, badgeColor: '' },
  { icon: '📧', label: 'Email Support', sub: 'support@tarsierwin.com', badge: null, badgeColor: '' },
]

const DOCS = [
  { label: 'Terms & Conditions', icon: '📋' },
  { label: 'Privacy Policy', icon: '🔒' },
  { label: 'Responsible Gaming', icon: '🛡️' },
  { label: 'AML Policy', icon: '⚖️' },
  { label: 'Bonus Terms', icon: '🎁' },
  { label: 'About TarsierWin', icon: 'ℹ️' },
]

const dobFilled = computed(() => !!(dobMonth.value && dobDay.value && dobYear.value))

const dobDisplay = computed(() => {
  if (!dobFilled.value) return ''
  const m = MONTHS[parseInt(dobMonth.value, 10) - 1]
  return `${m} ${parseInt(dobDay.value, 10)}, ${dobYear.value}`
})

const years = computed(() => {
  const currentYear = new Date().getFullYear()
  return Array.from({ length: currentYear - 1924 }, (_, i) => currentYear - 18 - i)
})

const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))

function copyId() {
  navigator.clipboard?.writeText(USER_ID).catch(() => {})
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function savePersonal() {
  if (firstName.value && lastName.value && dobFilled.value && gender.value) {
    personalSaved.value = true
    dobOpen.value = false
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto pb-24 hide-scrollbar">
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
        <p class="mb-1 text-sm font-black leading-none text-foreground">Player Account</p>
        <button type="button" class="flex items-center gap-1.5 transition-opacity hover:opacity-80" @click="copyId">
          <span class="text-xs text-muted-foreground">ID: </span>
          <span class="text-xs font-bold text-primary">{{ USER_ID }}</span>
          <CheckCircle2 v-if="copied" :size="11" class="text-emerald-400" />
          <Copy v-else :size="11" class="text-muted-foreground" />
        </button>
        <p v-if="copied" class="mt-0.5 text-[10px] font-semibold text-emerald-400">Copied!</p>
      </div>
    </div>

    <div class="mt-4 space-y-4 px-5">
      <section>
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-display text-sm font-black text-foreground">PERSONAL INFORMATION</h3>
          <span v-if="personalSaved" class="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 :size="11" /> Verified
          </span>
        </div>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <div class="border-b border-border px-4 py-3">
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">First Name</label>
            <input
              v-model="firstName"
              type="text"
              placeholder="Enter first name"
              :readonly="personalSaved"
              class="w-full bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
          <div class="border-b border-border px-4 py-3">
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last Name</label>
            <input
              v-model="lastName"
              type="text"
              placeholder="Enter last name"
              :readonly="personalSaved"
              class="w-full bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
          <div
            class="cursor-pointer border-b border-border px-4 py-3"
            @click="!personalSaved && (dobOpen = !dobOpen)"
          >
            <label class="mb-1 block cursor-pointer text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Date of Birth
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
                  {{ dobFilled ? dobDisplay : 'Select date of birth' }}
                </span>
                <ChevronDown
                  :size="14"
                  class="text-muted-foreground transition-transform duration-200"
                  :class="dobOpen ? 'rotate-180' : ''"
                />
              </div>
              <div v-if="dobOpen" class="mt-3 grid grid-cols-3 gap-2" @click.stop>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-bold uppercase text-muted-foreground">Month</span>
                  <select
                    v-model="dobMonth"
                    class="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">Month</option>
                    <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1).padStart(2, '0')">{{ m }}</option>
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-bold uppercase text-muted-foreground">Day</span>
                  <select
                    v-model="dobDay"
                    class="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">Day</option>
                    <option v-for="d in days" :key="d" :value="d">{{ parseInt(d, 10) }}</option>
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-bold uppercase text-muted-foreground">Year</span>
                  <select
                    v-model="dobYear"
                    class="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">Year</option>
                    <option v-for="y in years" :key="y" :value="String(y)">{{ y }}</option>
                  </select>
                </div>
                <button
                  v-if="dobFilled"
                  type="button"
                  class="col-span-3 mt-1 rounded-lg bg-primary/20 py-1.5 text-xs font-black text-primary transition-colors hover:bg-primary/30"
                  @click="dobOpen = false"
                >
                  Confirm — {{ dobDisplay }}
                </button>
              </div>
            </template>
          </div>
          <div class="px-4 py-3">
            <label class="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gender</label>
            <div class="flex gap-2">
              <button
                v-for="g in ['Male', 'Female', 'Other']"
                :key="g"
                type="button"
                :disabled="personalSaved"
                class="flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors"
                :class="[
                  gender === g ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                  personalSaved ? 'cursor-default opacity-60' : 'hover:text-foreground',
                ]"
                @click="!personalSaved && (gender = g)"
              >
                {{ g }}
              </button>
            </div>
          </div>
        </div>
        <button
          v-if="!personalSaved"
          type="button"
          class="mt-2.5 w-full rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground shadow shadow-amber-500/20 transition-colors hover:bg-yellow-400"
          @click="savePersonal"
        >
          Save & Lock Information
        </button>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">CONTACT INFORMATION</h3>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <div class="flex items-center justify-between border-b border-border px-4 py-3">
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-lg">✈️</div>
              <div>
                <p class="text-sm font-bold text-foreground">Telegram</p>
                <p class="text-xs text-muted-foreground">{{ telegramLinked ? '@username' : 'Not connected' }}</p>
              </div>
            </div>
            <button
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs font-black transition-colors"
              :class="telegramLinked ? 'bg-emerald-500/20 text-emerald-400' : 'bg-primary text-primary-foreground hover:bg-yellow-400'"
            >
              {{ telegramLinked ? '✓ Linked' : 'Connect' }}
            </button>
          </div>
          <div class="border-b border-border px-4 py-3">
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Phone Number</label>
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted-foreground">🇵🇭 +63</span>
              <input
                v-model="phone"
                type="tel"
                placeholder="9XX XXX XXXX"
                class="flex-1 bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
          </div>
          <div class="px-4 py-3">
            <label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Email Address</label>
            <input
              v-model="email"
              type="email"
              placeholder="your@email.com"
              class="w-full bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">CUSTOMER SUPPORT</h3>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <button
            v-for="(item, i) in SUPPORT_ITEMS"
            :key="item.label"
            type="button"
            class="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/50"
            :class="i < SUPPORT_ITEMS.length - 1 ? 'border-b border-border' : ''"
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
        <h3 class="mb-3 font-display text-sm font-black text-foreground">COMMUNITY & MEDIA</h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="l in LINKS"
            :key="l.label"
            type="button"
            class="relative rounded-2xl bg-gradient-to-br p-4 text-left transition-opacity hover:opacity-90"
            :class="l.color"
          >
            <span class="mb-2 block text-2xl">{{ l.icon }}</span>
            <p class="text-xs font-black leading-tight text-white">{{ l.label }}</p>
            <p class="mt-0.5 text-[10px] text-white/60">{{ l.sub }}</p>
            <ChevronRight :size="12" class="absolute right-3 top-3 text-white/50" />
          </button>
        </div>
      </section>

      <section>
        <h3 class="mb-3 font-display text-sm font-black text-foreground">SUPPORTED CURRENCIES</h3>
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
        <h3 class="mb-3 font-display text-sm font-black text-foreground">LEGAL & POLICIES</h3>
        <div class="overflow-hidden rounded-2xl border border-border bg-card">
          <button
            v-for="(d, i) in DOCS"
            :key="d.label"
            type="button"
            class="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/50"
            :class="i < DOCS.length - 1 ? 'border-b border-border' : ''"
          >
            <div class="flex items-center gap-3">
              <span class="text-base">{{ d.icon }}</span>
              <span class="text-sm font-semibold text-foreground">{{ d.label }}</span>
            </div>
            <ChevronRight :size="14" class="text-muted-foreground" />
          </button>
        </div>
      </section>

      <div class="space-y-1 py-4 text-center">
        <p class="text-xs text-muted-foreground">TarsierWin · v1.0.0</p>
        <p class="text-xs text-muted-foreground">© 2025 TarsierWin. All rights reserved.</p>
        <p class="mt-2 px-4 text-[10px] leading-relaxed text-muted-foreground">
          TarsierWin operates under a valid gaming license. Please play responsibly. 18+
        </p>
      </div>
    </div>
  </div>
</template>
