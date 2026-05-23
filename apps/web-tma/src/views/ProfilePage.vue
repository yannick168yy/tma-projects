<script setup lang="ts">
import { ref } from 'vue'
import { CheckCircle2, Copy, ChevronRight } from 'lucide-vue-next'

const personalSaved = ref(false)
const copied = ref(false)
const firstName = ref('')
const lastName = ref('')
const phone = ref('')
const email = ref('')
const gender = ref('')

const USER_ID = 'TW-8842916'

function copyId() {
  navigator.clipboard?.writeText(USER_ID).catch(() => {})
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

const DOCS = [
  { label: 'Terms & Conditions', icon: '📋' },
  { label: 'Privacy Policy', icon: '🔒' },
  { label: 'Responsible Gaming', icon: '🛡️' },
  { label: 'Bonus Terms', icon: '🎁' },
  { label: 'About TarsierWin', icon: 'ℹ️' },
]
</script>

<template>
  <div class="flex-1 overflow-y-auto pb-4 hide-scrollbar">
    <div class="flex items-center gap-4 px-5 py-4 bg-card border-b border-border">
      <div class="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 overflow-hidden shadow-lg shadow-amber-500/30 flex-shrink-0">
        <svg viewBox="0 0 40 40" width="48" height="48" aria-hidden="true">
          <circle cx="20" cy="22" r="16" fill="#a16207" />
          <circle cx="13" cy="20" r="6" fill="white" />
          <circle cx="27" cy="20" r="6" fill="white" />
          <circle cx="13" cy="20" r="4" fill="#1e293b" />
          <circle cx="27" cy="20" r="4" fill="#1e293b" />
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-foreground font-black text-sm leading-none mb-1">Player Account</p>
        <button type="button" class="flex items-center gap-1.5 hover:opacity-80" @click="copyId">
          <span class="text-muted-foreground text-xs">ID: </span>
          <span class="text-primary font-bold text-xs">{{ USER_ID }}</span>
          <CheckCircle2 v-if="copied" :size="11" class="text-emerald-400" />
          <Copy v-else :size="11" class="text-muted-foreground" />
        </button>
        <p v-if="copied" class="text-emerald-400 text-[10px] font-semibold mt-0.5">Copied!</p>
      </div>
    </div>

    <div class="px-5 space-y-4 mt-4">
      <section>
        <h3 class="text-foreground font-black text-sm mb-3 font-display">PERSONAL INFORMATION</h3>
        <div class="bg-card rounded-2xl overflow-hidden border border-border">
          <div class="px-4 py-3 border-b border-border">
            <label class="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1">First Name</label>
            <input
              v-model="firstName"
              type="text"
              placeholder="Enter first name"
              :readonly="personalSaved"
              class="w-full bg-transparent text-foreground font-semibold text-sm focus:outline-none"
            />
          </div>
          <div class="px-4 py-3 border-b border-border">
            <label class="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1">Last Name</label>
            <input
              v-model="lastName"
              type="text"
              placeholder="Enter last name"
              :readonly="personalSaved"
              class="w-full bg-transparent text-foreground font-semibold text-sm focus:outline-none"
            />
          </div>
          <div class="px-4 py-3">
            <label class="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-2">Gender</label>
            <div class="flex gap-2">
              <button
                v-for="g in ['Male', 'Female', 'Other']"
                :key="g"
                type="button"
                class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors"
                :class="gender === g ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
                :disabled="personalSaved"
                @click="gender = g"
              >
                {{ g }}
              </button>
            </div>
          </div>
        </div>
        <button
          v-if="!personalSaved"
          type="button"
          class="w-full mt-2.5 py-3 rounded-2xl bg-primary text-primary-foreground font-black text-sm hover:bg-yellow-400 transition-colors"
          @click="personalSaved = !!(firstName && lastName && gender)"
        >
          Save & Lock Information
        </button>
      </section>

      <section>
        <h3 class="text-foreground font-black text-sm mb-3 font-display">CONTACT INFORMATION</h3>
        <div class="bg-card rounded-2xl overflow-hidden border border-border">
          <div class="flex items-center justify-between px-4 py-3 border-b border-border">
            <div class="flex items-center gap-3">
              <span class="text-lg">✈️</span>
              <div>
                <p class="text-foreground font-bold text-sm">Telegram</p>
                <p class="text-muted-foreground text-xs">Not connected</p>
              </div>
            </div>
            <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-black bg-primary text-primary-foreground">Connect</button>
          </div>
          <div class="px-4 py-3 border-b border-border">
            <label class="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1">Phone</label>
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground text-sm">🇵🇭 +63</span>
              <input v-model="phone" type="tel" placeholder="9XX XXX XXXX" class="flex-1 bg-transparent text-foreground text-sm focus:outline-none" />
            </div>
          </div>
          <div class="px-4 py-3">
            <label class="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1">Email</label>
            <input v-model="email" type="email" placeholder="your@email.com" class="w-full bg-transparent text-foreground text-sm focus:outline-none" />
          </div>
        </div>
      </section>

      <section>
        <h3 class="text-foreground font-black text-sm mb-3 font-display">LEGAL & POLICIES</h3>
        <div class="bg-card rounded-2xl overflow-hidden border border-border">
          <button
            v-for="(d, i) in DOCS"
            :key="d.label"
            type="button"
            class="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
            :class="i < DOCS.length - 1 ? 'border-b border-border' : ''"
          >
            <div class="flex items-center gap-3">
              <span>{{ d.icon }}</span>
              <span class="text-foreground font-semibold text-sm">{{ d.label }}</span>
            </div>
            <ChevronRight :size="14" class="text-muted-foreground" />
          </button>
        </div>
      </section>

      <div class="text-center py-4 space-y-1">
        <p class="text-muted-foreground text-xs">TarsierWin · v1.0.0</p>
        <p class="text-muted-foreground text-[10px] px-4 leading-relaxed">Please play responsibly. 18+</p>
      </div>
    </div>
  </div>
</template>
