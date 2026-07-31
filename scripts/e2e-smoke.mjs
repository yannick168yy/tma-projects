#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request as httpRequest } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

const chromePath = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find(existsSync)

if (!chromePath) {
  console.error('找不到 Chrome/Chromium。请设置 CHROME_PATH=/path/to/chrome 后重试。')
  process.exit(1)
}

const shouldTunnel = !process.env.E2E_WEB_TMA_BASE_URL && !process.env.E2E_WEB_ADMIN_BASE_URL
const tunnelHost = process.env.E2E_TUNNEL_HOST || 'root@47.84.34.139'
const tunnelKey = process.env.SSH_IDENTITY_FILE || '/Volumes/MacAPFS/TMA_FILES/aliyun.pem'
const localTmaPort = Number(process.env.E2E_LOCAL_TMA_PORT || 18080)
const localAdminPort = Number(process.env.E2E_LOCAL_ADMIN_PORT || 18085)
let tunnel

if (shouldTunnel) {
  tunnel = spawn('ssh', [
    '-i', tunnelKey,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-L', `${localTmaPort}:127.0.0.1:8080`,
    '-L', `${localAdminPort}:127.0.0.1:8085`,
    tunnelHost,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  process.on('exit', () => tunnel?.kill('SIGTERM'))
  await waitForPort(localTmaPort)
  await waitForPort(localAdminPort)
}

const webTmaBase = (process.env.E2E_WEB_TMA_BASE_URL || `http://127.0.0.1:${localTmaPort}`).replace(/\/$/, '')
const webAdminBase = (process.env.E2E_WEB_ADMIN_BASE_URL || `http://127.0.0.1:${localAdminPort}`).replace(/\/$/, '')
const headed = process.env.E2E_HEADED === '1'
const outDir = resolve(process.env.E2E_ARTIFACT_DIR || `artifacts/e2e-smoke/${new Date().toISOString().replace(/[:.]/g, '-')}`)
const dataDir = await mkdtemp(join(tmpdir(), 'betogo-e2e-chrome-'))
await mkdir(outDir, { recursive: true })

const chrome = spawn(chromePath, [
  headed ? '' : '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${dataDir}`,
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  'about:blank',
].filter(Boolean), { stdio: ['ignore', 'pipe', 'pipe'] })

let browserWs = ''
const stderrChunks = []
chrome.stderr.on('data', (chunk) => {
  const text = chunk.toString()
  stderrChunks.push(text)
  const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/)
  if (match) browserWs = match[1]
})

process.on('exit', () => chrome.kill('SIGTERM'))
process.on('SIGINT', () => { chrome.kill('SIGTERM'); tunnel?.kill('SIGTERM'); process.exit(130) })

for (let i = 0; i < 100 && !browserWs; i++) await delay(50)
if (!browserWs) {
  console.error('Chrome DevTools 启动失败：')
  console.error(stderrChunks.join(''))
  process.exit(1)
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
        return
      }
      const list = this.handlers.get(msg.method) || []
      for (const fn of list) void fn(msg.params)
    })
  }
  async ready() {
    while (this.ws.readyState === WebSocket.CONNECTING) await delay(20)
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  on(method, fn) {
    const list = this.handlers.get(method) || []
    list.push(fn)
    this.handlers.set(method, list)
  }
  close() {
    this.ws.close()
  }
}

function httpJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = httpRequest(url, { method: 'GET', timeout: 1000 }, (res) => {
      res.resume()
      res.on('end', () => resolve(true))
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
    req.end()
  })
}

async function waitForPort(port) {
  for (let i = 0; i < 60; i++) {
    if (await httpOk(`http://127.0.0.1:${port}/`)) return
    await delay(250)
  }
  throw new Error(`SSH 隧道本地端口未就绪: ${port}`)
}

async function createPage() {
  const version = await httpJson(browserWs.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '/json/version'))
  const browser = new Cdp(version.webSocketDebuggerUrl)
  await browser.ready()
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const targets = await httpJson(browserWs.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '/json/list'))
  const target = targets.find((item) => item.id === targetId)
  const page = new Cdp(target.webSocketDebuggerUrl)
  await page.ready()
  browser.close()
  return page
}

const sampleGame = {
  uuid: 'game-001',
  name: 'Lucky Jeepney',
  nameId: null,
  nameVi: null,
  nameZh: null,
  provider: 'DemoProvider',
  category: 'slots',
  subCategory: 'video',
  sortCategory: 'slots',
  imageUrl: null,
  imageHqUrl: null,
  hasDemo: true,
  hasLobby: false,
  isMobile: true,
  weight: 100,
  phBonus: 1,
  isFeatured: true,
  theme: 'Filipino',
}

const user = {
  id: 'BG-10001',
  displayName: 'E2E Player',
  inviteCode: 'E2ETEST',
  loginProvider: 'account',
  boundAccount: true,
  boundPhone: true,
  isAgent: true,
}

function ok(data) {
  return { code: 0, message: 'ok', data, traceId: 'e2e-trace' }
}

function tmaData(path) {
  if (path === '/auth/session') return ok({ valid: true, userId: user.id, expiresAt: '2099-01-01T00:00:00.000Z' })
  if (path === '/user/me') return ok(user)
  if (path === '/wallet/balances') return ok([{ currency: 'PHP', available: 1234.56, frozen: 25 }, { currency: 'USDT', available: 18.5, frozen: 0 }])
  if (path === '/wallet/summary') return ok({ primaryCurrency: 'PHP', displayPhp: '₱ 1,234.56', balances: [{ currency: 'PHP', available: 1234.56, frozen: 25 }], frozenNote: 'Some funds are frozen pending turnover.' })
  if (path === '/wallet/turnover' || path === '/turnover') return ok({ canWithdraw: true, totalRemaining: 0, requirements: [] })
  if (path === '/kyc/status') return ok({ status: 'approved', registeredPhone: '+639171234567', phone: '+639171234567', fullName: 'Juan Dela Cruz', docType: 'philid', requireDocument: true, requireFace: true, phoneVerified: true, docVerified: true, faceVerified: true })
  if (path === '/kyc/submissions/latest') return ok({ status: 'approved', verifyMode: 'face', submittedAt: '2026-06-01T00:00:00.000Z' })
  if (path === '/promotions/config') return ok({ trial: { amount: 88, enabled: true }, referral: { inviterAmount: 50, inviteeAmount: 30, enabled: true }, firstdep: { enabled: true, turnoverX: 15, turnoverDays: 30, tiers: { PHP: [{ depositAmount: 100, bonusAmount: 15 }] } } })
  if (path === '/promotions') return ok([{ promoId: 'trial', title: 'Welcome Bonus', subtitle: 'Start strong', description: 'E2E promo', ctaLabel: 'Claim', highlight: true, flagLabel: 'Hot' }])
  if (path === '/promotions/trial-play') return ok({ claimed: true, amountPhp: 88, turnoverRequired: 264 })
  if (path === '/promotions/referral') return ok({ inviteCode: 'E2ETEST', totalRewardPhp: 100, pendingRewardPhp: 50 })
  if (path === '/promotions/referral/records') return ok({ items: [{ id: 1, friendName: 'Juan', status: 'qualified', rewardPhp: 50, createdAt: '2026-06-01' }] })
  if (path === '/promotions/red-packets') return ok({ items: [{ id: 1, type: 'trial', amountPhp: 88, createdAt: '2026-06-01' }] })
  if (path === '/promotions/team/status') return ok({ isAgent: true, enabled: true, activated: true, inviteCode: 'E2ETEST', totalCommissionCents: 10000, downlineCount: 3 })
  if (path === '/slots/homepage') return ok({ popular: [sampleGame], slots: [sampleGame], live: [sampleGame], fishing: [sampleGame], crash: [sampleGame], table: [sampleGame], generatedAt: new Date().toISOString() })
  if (path === '/slots/games') return ok({ items: [sampleGame], total: 1, page: 1, pages: 1 })
  if (path === '/slots/providers') return ok(['DemoProvider'])
  if (path === '/slots/themes') return ok(['Filipino', 'Fruit'])
  if (path === '/slots/betting-activity') return ok([{ uuid: sampleGame.uuid, name: sampleGame.name, provider: sampleGame.provider, imageUrl: null, betAmount: 120 }])
  if (path === '/slots/demo' || path === '/slots/init') return ok({ url: 'about:blank#game' })
  if (path === '/spin/status') return ok({
    enabled: true,
    remainingChances: 2,
    depositRules: [{ id: 1, name: 'Deposit 580', minDepositPhp: 580, depositAmountPhp: 580, maxDepositPhp: null, chances: 1, enabled: true, sortOrder: 1, remainingChances: 2 }],
    prizes: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, ruleId: 1, name: `Bonus ${i + 1}`, imageKey: '', amountPhp: 88 + i, weight: 100, turnoverX: 1, enabled: true, sortOrder: i + 1 })),
    recentRecords: [{ id: 'SPIN-1', userId: user.id, displayName: 'E2E Player', prizeName: 'Bonus', amountPhp: 88, createdAt: '2026-06-01' }],
    tickerRecords: [{ id: 'SPIN-1', userId: user.id, displayName: 'E2E Player', prizeName: 'Bonus', amountPhp: 88, createdAt: '2026-06-01' }],
  })
  if (path === '/spin/records') return ok({ items: [{ id: 'SPIN-1', userId: user.id, displayName: 'E2E Player', amountPhp: 88, prizeName: 'Bonus', createdAt: '2026-06-01' }], total: 1, page: 1, pageSize: 20 })
  if (path === '/rebate/config') return ok({ config: [], thresholds: [] })
  if (path === '/rebate/progress') return ok({ level: 1, totalTurnover: 1000, nextLevelTurnover: 5000, progressPct: 20 })
  if (path === '/rebate/summary') return ok({ date: '2026-06-28', totalRebate: 12, claimed: false, breakdown: [] })
  if (path === '/cs/history') return ok({ conversation: { id: 1, userId: user.id, status: 'open', updatedAt: '2026-06-01' }, messages: [{ id: 1, conversationId: 1, role: 'assistant', content: 'Hi, how can we help?', createdAt: '2026-06-01' }] })
  if (path === '/cs/message') return ok({ reply: 'Thanks, support is here.', conversationId: 1, status: 'open' })
  return ok({ items: [], total: 0, page: 1, pageSize: 20 })
}

function adminData(path) {
  if (path === '/admin/auth/login') return ok({ token: 'admin-e2e-token', expiresIn: 3600, role: 'super_admin' })
  if (path === '/admin/dashboard') return ok({ totalUsers: 12, activeUsers: 10, frozenUsers: 1, todayDepositCount: 3, todayDepositAmount: 5000, todayWithdrawCount: 1, todayWithdrawAmount: 600, pendingWithdrawCount: 2, totalBalance: 12345.67, sgMultiCurrency: true })
  if (path === '/admin/dashboard/badges') return ok({ manualWithdrawals: 2, pendingCs: 1, rejectedKyc: 1 })
  if (path === '/admin/users') return ok({ total: 1, items: [{ id: 'BG-10001', displayName: 'E2E Player', email: 'e2e@example.com', telegramUsername: 'e2eplayer', status: 'active', label: 'normal', lastLoginAt: '2026-06-01', lastLoginRegion: 'PH', registerRegion: 'PH', registeredAt: '2026-01-01', balance: 1234.56, level: 1 }] })
  if (path === '/admin/users/BG-10001') return ok({ user: { id: 'BG-10001', displayName: 'E2E Player', status: 'active', label: 'normal', email: 'e2e@example.com' }, level: 1, totalTurnover: 1000, wallet: { available: 1234.56, frozen: 25 }, ledger: [], loginLogs: [], betOrders: [], kycConfig: { system: { requireDocument: true, requireFace: true }, effective: { requireDocument: true, requireFace: true }, docOverride: null, faceOverride: null }, kyc: { status: 'approved', phoneVerified: true, docVerified: true, faceVerified: true } })
  if (path === '/admin/withdrawals') return ok({ total: 1, items: [{ orderId: 'WDR-E2E', userId: 'BG-10001', amount: 500, currency: 'PHP', channelId: 'tg_wallet', status: 'pending', createdAt: '2026-06-01', reviewVerdict: 'manual' }] })
  if (path === '/admin/review/overview') return ok({ pendingWithdrawals: 2, pendingTeamWithdrawals: 1, todayApproved: 3, todayRejected: 1, rulesEnabled: 4 })
  if (path === '/admin/review/proposals' || path === '/admin/review/manual-queue') return ok({ total: 1, page: 1, pageSize: 20, items: [{ id: 'WDR-E2E', orderId: 'WDR-E2E', userId: 'BG-10001', displayName: 'E2E Player', amount: 500, currency: 'PHP', status: 'pending', reviewVerdict: 'manual', createdAt: '2026-06-01' }] })
  if (path === '/admin/kyc') return ok({ total: 1, page: 1, pageSize: 20, items: [{ userId: 'BG-10001', displayName: 'E2E Player', status: 'pending', phone: '+639171234567', fullName: 'Juan Dela Cruz', docType: 'passport', phoneVerified: true, docVerified: false, faceVerified: false, submittedAt: '2026-06-01', docSubmittedAt: '2026-06-01', faceSubmittedAt: null, reviewedAt: null }] })
  if (path === '/admin/kyc/BG-10001') return ok({ user: { id: 'BG-10001', displayName: 'E2E Player', status: 'active' }, kyc: { status: 'pending', phoneVerified: true, docVerified: false, faceVerified: false, phone: '+639171234567', fullName: 'Juan Dela Cruz', docType: 'passport', rejectReason: null, rejectStep: null, extractedIdNo: 'P1234567', docSubmittedAt: '2026-06-01', faceSubmittedAt: null, reviewedAt: null, reviewedBy: null, geminiConfidence: 0.92, geminiResult: {}, docImageKey: null, livenessFrames: [], submittedAt: '2026-06-01', badgeIgnored: false } })
  if (path === '/admin/games') return ok({ total: 1, providers: ['DemoProvider'], items: [{ uuid: 'game-001', name: 'Lucky Jeepney', provider: 'DemoProvider', category: 'slots', sortCategory: 'slots', imageUrl: null, hasDemo: true, isActive: true, weight: 100, phBonus: 1 }] })
  if (path === '/admin/games/provider-stats') return ok([{ provider: 'DemoProvider', total: 1, active: 1 }])
  if (path === '/admin/promotions/config') return ok({ trial: { amount: 88, enabled: true, turnoverX: 3, turnoverDays: 7 }, referral: { inviterAmount: 50, inviteeAmount: 30, enabled: true, turnoverX: 1, turnoverDays: 7 }, firstdep: { enabled: true, turnoverX: 15, turnoverDays: 30, tiers: { PHP: [{ depositAmount: 100, bonusAmount: 15 }] } } })
  if (path === '/admin/promotions/claims') return ok({ items: [{ id: 1, userId: 'BG-10001', promoId: 'trial', amount: 88, createdAt: '2026-06-01' }], total: 1, page: 1, pageSize: 20 })
  if (path === '/admin/payment/channels') return ok([{ id: 1, name: 'TG Wallet', provider: 'tg_wallet', category: 'fiat', enabled: true, currency: 'PHP', rules: [] }])
  if (path === '/admin/payment/accounting') return ok({ summary: { depositAmount: 1000, withdrawAmount: 500, feeAmount: 10 }, rows: [] })
  if (path === '/admin/payment/balance') return ok([{ provider: 'yfpay', available: 1000, frozen: 0, updatedAt: '2026-06-01' }])
  return ok({ items: [], total: 0, page: 1, pageSize: 20 })
}

function routeApi(url, method) {
  const u = new URL(url)
  if (!u.pathname.includes('/api/v1')) return null
  if (method === 'OPTIONS') return { status: 204, body: '' }
  const path = u.pathname.slice(u.pathname.indexOf('/api/v1') + '/api/v1'.length)
  const normalized = path.replace(/\/$/, '')
  if (url.includes(':8085') || normalized.startsWith('/admin/')) return adminData(normalized, method)
  return tmaData(normalized, method)
}

async function runScenario(scenario) {
  const page = await createPage()
  const consoleLogs = []
  const network = []
  let failed = false

  page.on('Runtime.consoleAPICalled', (p) => {
    consoleLogs.push(`[${p.type}] ${(p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`)
  })
  page.on('Fetch.requestPaused', async (p) => {
    const mock = routeApi(p.request.url, p.request.method)
    if (!mock) {
      await page.send('Fetch.continueRequest', { requestId: p.requestId })
      return
    }
    network.push(`${p.request.method} ${new URL(p.request.url).pathname}`)
    await page.send('Fetch.fulfillRequest', {
      requestId: p.requestId,
      responseCode: mock.status ?? 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
        { name: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization,X-Telegram-Init-Data,X-Request-Id' },
      ],
      body: Buffer.from(mock.body ?? JSON.stringify(mock)).toString('base64'),
    })
  })
  page.on('Network.loadingFailed', (p) => {
    if (p.type !== 'Image') network.push(`FAILED ${p.errorText} ${p.requestId}`)
  })

  try {
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Network.enable')
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/v1/*', requestStage: 'Request' }] })
    await page.send('Emulation.setDeviceMetricsOverride', scenario.viewport)
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        localStorage.setItem('betogo_locale','en');
        localStorage.setItem('betogo_token','e2e-token');
        localStorage.setItem('betogo_trial_claimed','1');
        localStorage.setItem('admin_token','admin-e2e-token');
        localStorage.setItem('admin_role','super_admin');
        sessionStorage.setItem('betogo_trial_sheet_seen','1');
      `,
    })
    await page.send('Page.navigate', { url: scenario.url })
    await waitForLoad(page)
    await waitForBodyText(page)
    if (scenario.action) await scenario.action(page)
    const text = await waitForExpectedText(page, scenario.mustContain, scenario.name)
    for (const needle of scenario.mustContain) {
      assertText(text, needle, scenario.name)
    }
    await screenshot(page, `${scenario.name}.png`)
  } catch (err) {
    failed = true
    await screenshot(page, `${scenario.name}.failed.png`).catch(() => {})
    const html = await page.send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }).catch(() => null)
    await writeFile(join(outDir, `${scenario.name}.failed.html`), html?.result?.value ?? '')
    await writeFile(join(outDir, `${scenario.name}.error.txt`), err instanceof Error ? err.stack || err.message : String(err))
  } finally {
    await writeFile(join(outDir, `${scenario.name}.console.log`), consoleLogs.join('\n'))
    await writeFile(join(outDir, `${scenario.name}.network.log`), network.join('\n'))
    page.close()
  }
  if (failed) throw new Error(`${scenario.name} 失败，详见 ${outDir}`)
}

function waitForLoad(page) {
  return Promise.race([
    new Promise((resolve) => page.on('Page.loadEventFired', resolve)),
    delay(5000),
  ])
}

async function evalText(page) {
  const result = await page.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })
  return result.result.value || ''
}

async function waitForBodyText(page) {
  for (let i = 0; i < 30; i++) {
    const text = await evalText(page)
    if (text.trim().length > 0) return text
    await delay(200)
  }
  return ''
}

async function waitForExpectedText(page, needles, name) {
  let text = ''
  for (let i = 0; i < 60; i++) {
    text = await evalText(page)
    if (needles.every((needle) => textMatches(text, needle))) return text
    await delay(250)
  }
  const missing = needles.find((needle) => !textMatches(text, needle))
  throw new Error(`${name} 未找到预期内容: ${missing}\n页面文本前 1000 字:\n${text.slice(0, 1000)}`)
}

function textMatches(text, needle) {
  return needle instanceof RegExp ? needle.test(text) : text.includes(needle)
}

function assertText(text, needle, name) {
  const matched = textMatches(text, needle)
  if (!matched) throw new Error(`${name} 未找到预期内容: ${needle}\n页面文本前 1000 字:\n${text.slice(0, 1000)}`)
}

async function clickText(page, regexSource) {
  let clicked = false
  for (let i = 0; i < 40; i++) {
    const result = await page.send('Runtime.evaluate', {
      expression: `
        (() => {
          const re = new RegExp(${JSON.stringify(regexSource)}, 'i');
          const nodes = [...document.querySelectorAll('button,a,[role="button"],input,textarea')];
          const el = nodes.find((n) => re.test((n.innerText || n.value || n.getAttribute('aria-label') || n.placeholder || '').trim()));
          if (!el) return false;
          el.click();
          return true;
        })()
      `,
      returnByValue: true,
    })
    if (result.result.value) {
      clicked = true
      break
    }
    await delay(250)
  }
  if (!clicked) throw new Error(`未找到可点击入口: ${regexSource}`)
  await delay(700)
}

async function clickCustomerService(page) {
  let clicked = false
  for (let i = 0; i < 40; i++) {
    const result = await page.send('Runtime.evaluate', {
      expression: `
        (() => {
          const buttons = [...document.querySelectorAll('header button')];
          const el = buttons.find((button) => {
            const label = (button.innerText || button.getAttribute('aria-label') || '').trim();
            const icon = button.querySelector('svg.lucide-headset, svg[class*="lucide-headset"]');
            return /support|help|customer/i.test(label) || icon;
          }) || buttons.at(-1);
          if (!el) return false;
          el.click();
          return true;
        })()
      `,
      returnByValue: true,
    })
    if (result.result.value) {
      clicked = true
      break
    }
    await delay(250)
  }
  if (!clicked) throw new Error('未找到客服入口')
  await delay(700)
}

async function screenshot(page, file) {
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(join(outDir, file), Buffer.from(shot.data, 'base64'))
}

const mobile = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
const desktop = { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }

const scenarios = [
  { name: 'web-tma-mobile-start-home', url: `${webTmaBase}/home`, viewport: mobile, mustContain: [/BetoGo|Top Up|PHP|Lucky/i] },
  { name: 'web-tma-mobile-wallet', url: `${webTmaBase}/home`, viewport: mobile, action: (p) => clickText(p, 'Top up|PHP|₱'), mustContain: [/Wallet|Deposit|Withdraw|Top up|PHP/i] },
  { name: 'web-tma-mobile-kyc', url: `${webTmaBase}/kyc-setting`, viewport: mobile, mustContain: [/KYC|Identity|approved|Verify/i] },
  { name: 'web-tma-mobile-bonuses', url: `${webTmaBase}/bonuses`, viewport: mobile, mustContain: [/Bonus|Welcome|Referral|Claim/i] },
  { name: 'web-tma-mobile-spin', url: `${webTmaBase}/rewards-spin`, viewport: mobile, mustContain: [/Spin|Bonus|Chances|Prize/i] },
  { name: 'web-tma-mobile-customer-service', url: `${webTmaBase}/home`, viewport: mobile, action: clickCustomerService, mustContain: [/support|help|Hi, how can we help|message/i] },
  { name: 'web-tma-mobile-slots-lobby', url: `${webTmaBase}/slots`, viewport: mobile, mustContain: [/Lucky Jeepney|DemoProvider|Slots|Game/i] },
  { name: 'web-admin-desktop-login', url: `${webAdminBase}/login`, viewport: desktop, mustContain: [/BetoGo 管理后台|登录|用户名/i] },
  { name: 'web-admin-desktop-dashboard', url: `${webAdminBase}/dashboard`, viewport: desktop, mustContain: [/数据概览|总用户数|平台总余额/i] },
  { name: 'web-admin-desktop-user-detail', url: `${webAdminBase}/users/BG-10001`, viewport: desktop, mustContain: [/E2E Player|BG-10001|余额|KYC/i] },
  { name: 'web-admin-desktop-withdraw-review', url: `${webAdminBase}/withdrawals`, viewport: desktop, mustContain: [/WDR-E2E|提款|BG-10001|pending/i] },
  { name: 'web-admin-desktop-kyc', url: `${webAdminBase}/kyc`, viewport: desktop, mustContain: [/KYC|Juan|BG-10001|pending/i] },
  { name: 'web-admin-desktop-games', url: `${webAdminBase}/games`, viewport: desktop, mustContain: [/Lucky Jeepney|DemoProvider|游戏/i] },
  { name: 'web-admin-desktop-promotions', url: `${webAdminBase}/promotions`, viewport: desktop, mustContain: [/活动|trial|首充|试玩|邀请/i] },
  { name: 'web-admin-desktop-payment-channels', url: `${webAdminBase}/payment/channels`, viewport: desktop, mustContain: [/TG Wallet|支付|渠道|PHP/i] },
]

const selected = process.env.E2E_TARGET
  ? scenarios.filter((s) => s.name.includes(process.env.E2E_TARGET))
  : scenarios

const failures = []
for (const scenario of selected) {
  process.stdout.write(`==> ${scenario.name} ... `)
  try {
    await runScenario(scenario)
    console.log('ok')
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err))
    console.log('failed')
  }
}

chrome.kill('SIGTERM')
tunnel?.kill('SIGTERM')

console.log(`\nE2E artifacts: ${outDir}`)
if (failures.length) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}
