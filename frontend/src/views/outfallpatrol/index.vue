<template>
  <section class="page" data-module="outfallpatrol">
    <header class="page-head">
      <div>
        <h2>排口巡查管理</h2>
        <p class="page-desc">维护排口巡查记录，围绕巡查编号、排口名称、所在河段、排放水质做登记、筛选与状态流转。同一排口以最近一次巡查记录为准。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排口巡查记录</button>
        <button class="btn" type="button" @click="exportRows">导出排口巡查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>最近巡查</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '巡查编号'">
              <RouterLink class="link" :to="`/outfallpatrol/${row.id}`">{{ row[column] ?? '—' }}</RouterLink>
              <span v-if="row.__latestOutfall" class="latest-tag" title="同一排口最近一次巡查，列表与详情均以此为准">最近</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ formatStamp(row.updatedAt) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/outfallpatrol/${row.id}`">查看详情</RouterLink>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无排口巡查数据，可先登记排口巡查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条排口巡查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal-card">
        <h3>登记排口巡查记录</h3>
        <form @submit.prevent="submitCreate">
          <p v-for="field in createFields" :key="field" class="form-line">
            <label class="filter-item">
              <span>{{ field }}</span>
              <input v-model="createForm[field]" :placeholder="`请输入${field}`" />
            </label>
          </p>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <p class="modal-actions">
            <button class="btn" type="button" @click="closeCreate">取消</button>
            <button class="btn primary" type="submit" :disabled="submitting">
              {{ submitting ? '提交中…' : '保存登记' }}
            </button>
          </p>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  createPatrol,
  formatStamp,
  listPatrols,
  patrolStats,
  runPatrolAction,
  type PatrolView,
} from '@/api/outfallpatrol'
import { useSessionStore } from '@/stores/session'

const router = useRouter()
const session = useSessionStore()

const meta = moduleMeta('outfallpatrol')
const columns = ["巡查编号", "排口名称", "所在河段", "排放水质", "巡查人", "巡查日期", "发现问题数", "巡查状态"]
const actions = ["提交巡查", "确认完成", "上报问题"]
const statuses = ["待巡查", "巡查中", "已完成", "已上报"]
const createFields = ["巡查编号", "排口名称", "所在河段", "排放水质", "巡查人", "巡查日期", "发现问题数"]

const rows = ref<PatrolView[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stats = ref(patrolStats())

const creating = ref(false)
const submitting = ref(false)
const createError = ref('')
const createForm = reactive<Record<string, string>>({})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  createError.value = ''
  for (const field of createFields) {
    createForm[field] = ''
  }
  createForm['巡查日期'] = new Date().toISOString().slice(0, 10)
  createForm['发现问题数'] = '0'
  creating.value = true
}

function closeCreate() {
  creating.value = false
  submitting.value = false
}

function submitCreate() {
  if (submitting.value) {
    return
  }
  submitting.value = true
  createError.value = ''
  // 同一排口被重复提交时只接受先到的一版：提交期间锁定，保存端还会再做一次校验。
  const result = createPatrol({
    巡查编号: createForm['巡查编号'] ?? '',
    排口名称: createForm['排口名称'] ?? '',
    所在河段: createForm['所在河段'] ?? '',
    排放水质: createForm['排放水质'] ?? '',
    巡查人: createForm['巡查人'] ?? '',
    巡查日期: createForm['巡查日期'] ?? '',
    发现问题数: createForm['发现问题数'] ?? '',
    operator: session.operator,
  })
  submitting.value = false
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  reload()
  if (result.id !== undefined) {
    router.push(`/outfallpatrol/${result.id}`)
  }
}

function runAction(action: string, row: PatrolView) {
  errorMessage.value = ''
  const result = runPatrolAction(Number(row.id), action, session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listPatrols(filters.value)
    total.value = rows.value.length
    stats.value = patrolStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排口巡查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.latest-tag {
  margin-left: 6px;
  background: #e8f1ff;
  color: #1f6feb;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 22px;
  width: 460px;
  max-height: 86vh;
  overflow: auto;
}
.modal-card h3 { margin: 0 0 12px; }
.form-line { margin: 8px 0; }
.form-line .filter-item { display: block; }
.form-line input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 14px 0 0; }
</style>
