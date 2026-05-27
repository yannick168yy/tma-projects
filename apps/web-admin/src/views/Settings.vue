<template>
  <div>
    <a-page-header title="系统设置" style="background:#fff; margin-bottom:16px; padding:16px" />

    <a-row :gutter="16">
      <!-- 操作密码 -->
      <a-col :span="12">
        <a-card title="操作密码管理" :bordered="false">
          <a-alert
            v-if="!isSuperAdmin"
            message="仅 super_admin 可修改操作密码"
            type="warning"
            show-icon
            style="margin-bottom:16px"
          />
          <a-descriptions :column="1" bordered size="small" style="margin-bottom:16px">
            <a-descriptions-item label="状态">
              <a-badge v-if="opPwdConfigured" status="success" text="已设置" />
              <a-badge v-else status="warning" text="未设置" />
            </a-descriptions-item>
          </a-descriptions>

          <a-form layout="vertical" v-if="isSuperAdmin">
            <a-form-item v-if="opPwdConfigured" label="当前操作密码">
              <a-input-password v-model:value="form.current" placeholder="请输入当前操作密码" />
            </a-form-item>
            <a-form-item label="新操作密码">
              <a-input-password v-model:value="form.newPwd" placeholder="至少6位" />
            </a-form-item>
            <a-form-item label="确认新密码">
              <a-input-password v-model:value="form.confirm" placeholder="再次输入新密码" />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" :loading="saving" @click="handleSave">
                {{ opPwdConfigured ? '修改操作密码' : '设置操作密码' }}
              </a-button>
            </a-form-item>
          </a-form>

          <a-typography-paragraph type="secondary" style="margin-top:8px">
            操作密码用于保护高风险操作（如余额调整）。调整用户余额时需输入此密码验证身份。
          </a-typography-paragraph>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { getOpPasswordStatus, setOpPassword } from '../api.js'
import { useAuthStore } from '../stores/auth.js'
import { message } from 'ant-design-vue'

const auth = useAuthStore()
const isSuperAdmin = computed(() => auth.role === 'super_admin')

const opPwdConfigured = ref(false)
const saving = ref(false)
const form = reactive({ current: '', newPwd: '', confirm: '' })

async function loadStatus() {
  try {
    const res = await getOpPasswordStatus()
    opPwdConfigured.value = res.configured
  } catch {
    // ignore
  }
}

async function handleSave() {
  if (!form.newPwd || form.newPwd.length < 6) {
    message.warning('新密码至少6位'); return
  }
  if (form.newPwd !== form.confirm) {
    message.warning('两次输入的密码不一致'); return
  }
  if (opPwdConfigured.value && !form.current) {
    message.warning('请输入当前操作密码'); return
  }
  saving.value = true
  try {
    await setOpPassword(form.newPwd, opPwdConfigured.value ? form.current : undefined)
    message.success(opPwdConfigured.value ? '操作密码已修改' : '操作密码已设置')
    form.current = ''
    form.newPwd = ''
    form.confirm = ''
    await loadStatus()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadStatus)
</script>
