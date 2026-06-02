import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue') },
    {
      path: '/',
      component: () => import('./components/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: () => import('./views/Dashboard.vue') },
        { path: 'users', component: () => import('./views/Users.vue') },
        { path: 'users/:id', component: () => import('./views/UserDetail.vue') },
        { path: 'deposits', component: () => import('./views/Deposits.vue') },
        { path: 'withdrawals', component: () => import('./views/Withdrawals.vue') },
        { path: 'audit-log', component: () => import('./views/AuditLog.vue') },
        { path: 'games', component: () => import('./views/Games.vue') },
        { path: 'settings', component: () => import('./views/Settings.vue') },
        { path: 'exchange-rates', component: () => import('./views/ExchangeRates.vue') },
        { path: 'customer-service', component: () => import('./views/CustomerService.vue') },
        { path: 'cs-faq', component: () => import('./views/CsFaq.vue') },
        { path: 'bet-orders', component: () => import('./views/BetOrders.vue') },
        { path: 'sg-settlement', component: () => import('./views/SgSettlement.vue') },
        { path: 'team-referral', component: () => import('./views/TeamReferral.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('admin_token')
  if (to.meta.requiresAuth && !token) return '/login'
  if (to.path === '/login' && token) return '/dashboard'
})

export default router
