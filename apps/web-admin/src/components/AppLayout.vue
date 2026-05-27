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
        <a-menu-item key="/settings">
          <setting-outlined />
          <span>系统设置</span>
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
              <a-menu-item @click="showPwdModal = true">修改密码</a-menu-item>
              <a-menu-divider />
              <a-menu-item @click="handleLogout" style="color:red">退出登录</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-layout-header>

      <a-layout-content style="margin: 16px">
        <RouterView />
      </a-layout-content>
    </a-layout>
  </a-layout>

  <!-- 修改密码弹窗 -->
  <a-modal v-model:open="showPwdModal" title="修改登录密码" :footer="null" @cancel="resetPwdForm">
    <a-form layout="vertical" style="margin-top:8px">
      <a-form-item label="当前密码">
        <a-input-password v-model:value="pwdForm.current" placeholder="请输入当前密码" />
      </a-form-item>
      <a-form-item label="新密码">
        <a-input-password v-model:value="pwdForm.newPwd" placeholder="至少8位" />
      </a-form-item>
      <a-form-item label="确认新密码">
        <a-input-password v-model:value="pwdForm.confirm" placeholder="再次输入新密码" />
      </a-form-item>
      <a-form-item>
        <a-button type="primary" :loading="pwdLoading" block @click="handleChangePwd">确认修改</a-button>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter, useRoute, RouterView } from 'vue-router'
import {
  DashboardOutlined, TeamOutlined, ArrowDownOutlined, ArrowUpOutlined,
  FileTextOutlined, UserOutlined, DownOutlined, AppstoreOutlined, SettingOutlined,
} from '@ant-design/icons-vue'
import { useAuthStore } from '../stores/auth.js'
import { adminChangePassword } from '../api.js'
import { message } from 'ant-design-vue'

const collapsed = ref(false)
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const role = auth.role

const showPwdModal = ref(false)
const pwdLoading = ref(false)
const pwdForm = reactive({ current: '', newPwd: '', confirm: '' })

function onMenuClick(info: { key: string }) {
  router.push(info.key)
}

function resetPwdForm() {
  pwdForm.current = ''
  pwdForm.newPwd = ''
  pwdForm.confirm = ''
}

async function handleChangePwd() {
  if (!pwdForm.current || !pwdForm.newPwd || !pwdForm.confirm) {
    message.warning('请填写所有字段'); return
  }
  if (pwdForm.newPwd !== pwdForm.confirm) {
    message.warning('两次输入的新密码不一致'); return
  }
  if (pwdForm.newPwd.length < 8) {
    message.warning('新密码至少8位'); return
  }
  pwdLoading.value = true
  try {
    await adminChangePassword(pwdForm.current, pwdForm.newPwd)
    message.success('密码已修改，请重新登录')
    showPwdModal.value = false
    resetPwdForm()
    await auth.logout()
    router.push('/login')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '修改失败')
  } finally {
    pwdLoading.value = false
  }
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
