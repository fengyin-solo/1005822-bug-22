<template>
  <section class="page" data-module="outfallpatrol">
    <header class="page-head">
      <div>
        <h2>排口巡查管理</h2>
        <p class="page-desc">维护排口巡查记录，围绕巡查编号、排口名称、所在河段、排放水质做登记、筛选与状态流转。同一排口同河段以最近一次巡查为准。</p>
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
          <th>最近改动</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>{{ row.巡查编号 }}</td>
          <td><RouterLink class="link" :to="`/outfallpatrol/${row.id}`">{{ row.排口名称 }}</RouterLink></td>
          <td>{{ row.所在河段 }}</td>
          <td>{{ row.排放水质 }}</td>
          <td>{{ row.巡查人 }}</td>
          <td>{{ row.巡查日期 }}</td>
          <td>{{ row.发现问题数 }}</td>
          <td>{{ row.巡查状态 }}</td>
          <td>
            <span v-if="row.updatedAt">{{ row.updatedBy }} · {{ row.updatedAt }}</span>
            <span v-else class="muted-text">—</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/outfallpatrol/${row.id}`">详情</RouterLink>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无排口巡查数据，可先登记排口巡查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 个排口（同排口同河段已合并，取最近一次巡查）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal-card">
        <h3 class="modal-title">登记排口巡查记录</h3>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field.prop" class="filter-item">
            <span>{{ field.label }}</span>
            <input
              v-model="createForm[field.prop]"
              :type="field.type"
              :placeholder="`请输入${field.label}`"
            />
          </label>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <div class="modal-actions">
            <button class="btn primary" type="submit">保存登记</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  createOutfall,
  listOutfalls,
  runOutfallAction,
  today,
  type OutfallView,
} from '@/api/outfall-service'

const columns = ["巡查编号", "排口名称", "所在河段", "排放水质", "巡查人", "巡查日期", "发现问题数", "巡查状态"]
const actions = ["提交巡查", "确认完成", "上报问题"]
const statuses = ["待巡查", "巡查中", "已完成", "已上报"]

const rows = ref<OutfallView[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => {
  const monthPrefix = today().slice(0, 7)
  return [
    { label: '待巡查排口', value: rows.value.filter((row) => row.status === '待巡查').length },
    { label: '已完成巡查', value: rows.value.filter((row) => row.status === '已完成' || row.status === '已上报').length },
    {
      label: '本月发现问题数',
      value: rows.value
        .filter((row) => row.巡查日期.startsWith(monthPrefix))
        .reduce((sum, row) => sum + row.发现问题数, 0),
    },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('outfallpatrol')
}

const creating = ref(false)
const createError = ref('')
const createFields = [
  { prop: '巡查编号' as const, label: '巡查编号', type: 'text' },
  { prop: '排口名称' as const, label: '排口名称', type: 'text' },
  { prop: '所在河段' as const, label: '所在河段', type: 'text' },
  { prop: '排放水质' as const, label: '排放水质', type: 'text' },
  { prop: '巡查人' as const, label: '巡查人', type: 'text' },
  { prop: '巡查日期' as const, label: '巡查日期', type: 'date' },
  { prop: '发现问题数' as const, label: '发现问题数', type: 'number' },
]
const emptyCreateForm = () => ({
  巡查编号: '',
  排口名称: '',
  所在河段: '',
  排放水质: '',
  巡查人: '',
  巡查日期: today(),
  发现问题数: 0,
})
const createForm = ref(emptyCreateForm())

function openCreate() {
  createError.value = ''
  createForm.value = emptyCreateForm()
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function submitCreate() {
  createError.value = ''
  const result = createOutfall({
    巡查编号: createForm.value.巡查编号,
    排口名称: createForm.value.排口名称,
    所在河段: createForm.value.所在河段,
    排放水质: createForm.value.排放水质,
    巡查人: createForm.value.巡查人,
    巡查日期: createForm.value.巡查日期,
    发现问题数: Number(createForm.value.发现问题数),
  })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: OutfallView) {
  errorMessage.value = ''
  const result = runOutfallAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listOutfalls(filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排口巡查列表读取失败'
  }
}

onMounted(reload)
</script>
