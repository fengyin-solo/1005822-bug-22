<template>
  <section class="page" data-module="outfallpatrol-detail">
    <header class="page-head">
      <div>
        <h2>排口巡查详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/outfallpatrol">← 返回排口巡查列表</RouterLink>
          ｜巡查编号 {{ patrol?.['巡查编号'] ?? '—' }}（{{ patrol?.['排口名称'] ?? '—' }} · {{ patrol?.['所在河段'] ?? '—' }}）
        </p>
      </div>
    </header>

    <div v-if="!patrol" class="data-table empty-state" style="padding: 24px;">
      没有找到这条排口巡查记录，可能已被重置。
      <RouterLink class="link" to="/outfallpatrol">返回列表</RouterLink>
    </div>

    <template v-else>
      <div v-if="stale" class="stale-banner">
        本页打开后该记录已被其他人改过（最新 v{{ patrol.version }}），下面是你加载时的旧内容（v{{ formVersion }}）。
        同一排口重复提交只接受先到的一版，请
        <button class="link" type="button" @click="reload">读取最新版本</button>
        后再改。
      </div>

      <div class="detail-grid">
        <article class="detail-card">
          <h3>本次巡查内容</h3>
          <dl class="detail-list">
            <div><dt>巡查编号</dt><dd>{{ patrol['巡查编号'] }}</dd></div>
            <div><dt>排口名称</dt><dd>{{ patrol['排口名称'] }}</dd></div>
            <div><dt>所在河段</dt><dd>{{ patrol['所在河段'] }}</dd></div>
          </dl>

          <form @submit.prevent="submitSave">
            <p class="form-line">
              <label class="filter-item">
                <span>排放水质</span>
                <input v-model="form['排放水质']" placeholder="请输入排放水质" />
              </label>
            </p>
            <p class="form-line">
              <label class="filter-item">
                <span>发现问题数</span>
                <input v-model="form['发现问题数']" inputmode="numeric" placeholder="非负整数" />
              </label>
            </p>
            <p class="form-line">
              <label class="filter-item">
                <span>巡查日期</span>
                <input v-model="form['巡查日期']" type="date" />
              </label>
            </p>
            <p class="form-line">
              <label class="filter-item">
                <span>巡查人</span>
                <input v-model="form['巡查人']" placeholder="请输入巡查人" />
              </label>
            </p>
            <p class="form-line">
              <label class="filter-item">
                <span>巡查状态</span>
                <select v-model="form.status">
                  <option v-for="status in statuses" :key="status" :value="status" :disabled="isStatusDisabled(status)">
                    {{ status }}
                  </option>
                </select>
              </label>
            </p>
            <p v-if="saveMessage" :class="saveOk ? 'ok-text' : 'error-text'">{{ saveMessage }}</p>
            <p class="modal-actions">
              <button class="btn" type="button" @click="reload">放弃改动并刷新</button>
              <button class="btn primary" type="submit" :disabled="saving || stale">
                {{ saving ? '保存中…' : '保存巡查改动' }}
              </button>
            </p>
          </form>
        </article>

        <article class="detail-card">
          <h3>记录信息与改动留痕</h3>
          <dl class="detail-list">
            <div><dt>当前状态</dt><dd>{{ patrol.status }}</dd></div>
            <div v-if="!patrol.__latestOutfall">
              <dt>最近巡查</dt><dd>本记录不是该排口最近一次巡查，统计与结论以最近记录为准</dd>
            </div>
            <div v-else><dt>最近巡查</dt><dd>本记录为该排口最近一次巡查</dd></div>
            <div><dt>数据版本</dt><dd>v{{ patrol.version }}</dd></div>
            <div><dt>最后修改时间</dt><dd>{{ formatStamp(patrol.updatedAt) }}</dd></div>
            <div><dt>最后修改人</dt><dd>{{ patrol.updatedBy || '—' }}</dd></div>
          </dl>

          <h3 class="audit-title">改动历史</h3>
          <table class="data-table audit-table">
            <thead>
              <tr><th>时间</th><th>操作人</th><th>动作</th><th>改动内容</th></tr>
            </thead>
            <tbody>
              <tr v-for="entry in audits" :key="entry.id">
                <td>{{ formatStamp(entry.at) }}</td>
                <td>{{ entry.operator }}</td>
                <td>{{ entry.action }}</td>
                <td>{{ entry.detail }}</td>
              </tr>
              <tr v-if="!audits.length">
                <td colspan="4" class="empty-state">既有种子记录暂无改动留痕，保存后开始记录</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  formatStamp,
  getPatrol,
  patrolAudits,
  savePatrol,
  type PatrolView,
} from '@/api/outfallpatrol'
import type { AuditEntry } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const session = useSessionStore()

const statuses = ['待巡查', '巡查中', '已完成', '已上报']

const recordId = computed(() => Number(route.params.id))
const patrol = ref<PatrolView | null>(null)
const audits = ref<AuditEntry[]>([])
const saving = ref(false)
const saveMessage = ref('')
const saveOk = ref(false)

const form = reactive({
  排放水质: '',
  发现问题数: '',
  巡查日期: '',
  巡查人: '',
  status: '待巡查',
})
const formVersion = ref(0)

const stale = computed(() => patrol.value !== null && formVersion.value !== patrol.value.version)

function isStatusDisabled(status: string): boolean {
  // 巡查状态已上报的记录不能再被改成待巡查。
  return Boolean(patrol.value && patrol.value.status === '已上报' && status === '待巡查')
}

function fillForm() {
  if (!patrol.value) {
    return
  }
  form['排放水质'] = String(patrol.value['排放水质'] ?? '')
  form['发现问题数'] = String(patrol.value['发现问题数'] ?? '')
  form['巡查日期'] = String(patrol.value['巡查日期'] ?? '')
  form['巡查人'] = String(patrol.value['巡查人'] ?? '')
  form.status = String(patrol.value.status)
  formVersion.value = patrol.value.version
}

function reload() {
  saveMessage.value = ''
  patrol.value = getPatrol(recordId.value)
  audits.value = patrolAudits(recordId.value)
  fillForm()
}

function submitSave() {
  if (saving.value || stale.value) {
    return
  }
  saving.value = true
  saveMessage.value = ''
  // 提交即锁，重复点击/重复提交只可能进来一次；服务端再用版本号兜底先到先得。
  const result = savePatrol(recordId.value, {
    排放水质: form['排放水质'],
    发现问题数: form['发现问题数'],
    巡查日期: form['巡查日期'],
    巡查人: form['巡查人'],
    status: form.status,
    expectedVersion: formVersion.value,
    operator: session.operator,
  })
  saving.value = false
  saveOk.value = result.ok
  saveMessage.value = result.message
  if (result.ok) {
    reload()
  } else {
    // 版本冲突等错误：立刻拉最新，让页面看到已被接受的先到版本。
    patrol.value = getPatrol(recordId.value)
    audits.value = patrolAudits(recordId.value)
  }
}

watch(recordId, reload)
onMounted(reload)
</script>

<style scoped>
.detail-grid { display: grid; grid-template-columns: minmax(320px, 460px) 1fr; gap: 12px; }
.detail-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
.detail-card h3 { margin: 0 0 10px; font-size: 15px; }
.detail-list { margin: 0 0 8px; }
.detail-list div { display: flex; gap: 10px; padding: 4px 0; font-size: 13px; border-bottom: 1px dashed #eef2f7; }
.detail-list dt { width: 92px; color: var(--muted); flex: none; }
.detail-list dd { margin: 0; }
.form-line { margin: 10px 0; }
.form-line .filter-item { display: block; }
.form-line input, .form-line select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 14px 0 0; }
.ok-text { color: #067647; }
.stale-banner { background: #fffaeb; border: 1px solid #fedf89; color: #b54708; border-radius: 8px; padding: 8px 12px; font-size: 13px; margin-bottom: 12px; }
.audit-title { margin-top: 14px !important; }
.audit-table th, .audit-table td { font-size: 12px; padding: 6px 8px; }
</style>
