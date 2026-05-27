<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider v-model:collapsed="collapsed" collapsible theme="dark">
      <div class="logo">
        <span v-if="!collapsed">🎰 BetoGo</span>
        <span v-else>BG</span>
      </div>
      <a-menu
        theme="dark"
        mode="inline"
        :selected-keys="[route.path]"
        @click="onMenuClick"
      >
        <a-menu-item key="/dashboard">
          <dashboard-outlined />
          <span>数据概览</span>
        </a-menu-item>
        <a-menu-item key="/users">
          <team-outlined />
          <span>用户管理</span>
        </a-menu-item>
        <a-menu-item key="/deposits">
          <arrow-down-outlined />
          <span>存款管理</span>
        </a-menu-item>
        <a-menu-item key="/withdrawals">
          <arrow-up-outlined />
          <span>提款审批</span>
        </a-menu-item>
        <a-menu-item key="/games">
          <appstore-outlined />
          <span>游戏管理</span>
        </a-menu-item>
        <a-menu-item key="/audit-log">
          <file-text-outlined />
          <span>操作日志</span>
        </a-menu-item>
      </a-menu>
    </a-layout-sider>

    <a-layout>
      <a-layout-header style="background:#fff; padding: 0 16px; display:flex; align-items:center; justify-content:space-between; box-shadow: 0 1px 4px rgba(0,0,0,.1)">
        <span style="font-weight:600; font-size:16px">BetoGo 管理后台</span>
        <a-dropdown>
          <a-button type="text">
            <user-outlined /> {{ role || 'Admin' }} <down-outlined />
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item @click="handleLogout">退出登录</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-layout-header>

      <a-layout-content style="margin: 16px">
        <RouterView />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute, RouterView } from 'vue-router'
import {
  DashboardOutlined, TeamOutlined, ArrowDownOutlined, ArrowUpOutlined,
  FileTextOutlined, UserOutlined, DownOutlined, AppstoreOutlined,
} from '@ant-design/icons-vue'
import { useAuthStore } from '../stores/auth.js'
import { message } from 'ant-design-vue'

const collapsed = ref(false)
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const role = auth.role

function onMenuClick(info: { key: string }) {
  router.push(info.key)
}

async function handleLogout() {
  await auth.logout()
  message.success('已退出')
  router.push('/login')
}
</script>

<style scoped>
.logo {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: bold;
  background: rgba(255,255,255,.1);
  margin-bottom: 4px;
}
</style>
