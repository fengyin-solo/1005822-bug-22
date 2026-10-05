<template>
  <section class="page" data-module="outfallpatrol-detail" v-if="view">
    <header class="page-head">
      <div>
        <h2>排口巡查详情 · {{ view.巡查编号 }}</h2>
        <p class="page-desc">{{ view.排口名称 }}（{{ view.所在河段 }}）——列表与本页读同一份数据；同一排口的多次巡查以最近一次记录为准。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/outfallpatrol">返回巡查列表</RouterLink>
      </div>
    </header>

    <div class="detail-grid">
      <article class="detail-card">
        <h3 class="card-title">当前结论（取最近一次巡查）</h3>
        <dl class="detail-list">
          <template v-for="item in summaryItems" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value || '—' }}</dd>
          </template>
          <dt>数据版本</dt>
          <dd>v{{ view.version }}（最后改动：{{ view.updatedBy || '—' }} · {{ view.updatedAt || '初始记录' }}）</dd>
        </dl>
        <p v-if="view.status === '已上报'" class="warn-text">该记录已上报，状态锁定，不能再改回待巡查；业务内容仍可更正，更正会留痕。</p>
      </article>

      <article class="detail-card">
        <h3 class="card-title">本次巡查改动</h3>
        <form class="modal-form" @submit.prevent="submitPatch">
          <label class="filter-item">
            <span>排放水质</span>
            <input v-model="form.排放水质" placeholder="如：达标 / 超标（COD偏高）" />
          </label>
          <label class="filter-item">
            <span>发现问题数</span>
            <input v-model.number="form.发现问题数" type="number" min="0" step="1" />
          </label>
          <label class="filter-item">
            <span>巡查日期</span>
            <input v-model="form.巡查日期" type="date" />
          </label>
          <label class="filter-item">
            <span>巡查人</span>
            <input v-model="form.巡查人" />
          </label>
          <label class="filter-item">
            <span>巡查状态</span>
            <select v-model="form.巡查状态" :disabled="view.status === '已上报'">
              <option
                v-for="(status, index) in statuses"
                :key="status"
                :value="status"
                :disabled="index < statuses.indexOf(view.status)"
              >
                {{ status }}
              </option>
            </select>
          </label>
          <p class="form-hint">保存即持久化，刷新或重开浏览器仍在；改动会带操作人与时间戳。基于版本 v{{ form.expectedVersion }} 提交，若已被他人先改，本版将被拒绝。</p>
          <p v-if="saveMessage" :class="saveOk ? 'ok-text' : 'error-text'">{{ saveMessage }}</p>
          <div class="modal-actions">
            <button class="btn primary" type="submit">保存本次改动</button>
          </div>
        </form>
      </article>
    </div>

    <article class="detail-card">
      <h3 class="card-title">快捷流转</h3>
      <div class="row-actions action-row">
        <button
          v-for="action in actions"
          :key="action"
          class="btn"
          type="button"
          :disabled="view.status === '已上报'"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>
      <p v-if="actionMessage" class="error-text">{{ actionMessage }}</p>
    </article>

    <article class="detail-card">
      <h3 class="card-title">本排口巡查记录（{{ view.records.length }} 条，按时间倒序）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th>
            <th>排放水质</th>
            <th>发现问题数</th>
            <th>巡查人</th>
            <th>巡查日期</th>
            <th>状态</th>
            <th>版本/改动</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in view.records" :key="String(record.id)" :class="{ 'is-latest': Number(record.id) === view.id }">
            <td>{{ record.id }}<span v-if="Number(record.id) === view.id" class="latest-tag">最近</span></td>
            <td>{{ record['排放水质'] }}</td>
            <td>{{ record['发现问题数'] }}</td>
            <td>{{ record['巡查人'] }}</td>
            <td>{{ record['巡查日期'] }}</td>
            <td>{{ record.status }}</td>
            <td>v{{ versionOf(record) }} · {{ updatedByOf(record) || '初始' }}<template v-if="updatedAtOf(record)"> · {{ updatedAtOf(record) }}</template></td>
          </tr>
        </tbody>
      </table>
    </article>

    <div class="detail-grid">
      <article class="detail-card">
        <h3 class="card-title">落入防涝预警待拟清单的结论</h3>
        <table v-if="linkedWarningRows.length" class="data-table">
          <thead>
            <tr><th>预警编号</th><th>预警级别</th><th>影响区域</th><th>预警状态</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="warning in linkedWarningRows" :key="String(warning.id)">
              <td>{{ warning['预警编号'] }}</td>
              <td>{{ warning['预警级别'] }}</td>
              <td>{{ warning['影响区域'] }}</td>
              <td>{{ warning.status }}</td>
              <td><RouterLink class="link" to="/floodwarn">去处理</RouterLink></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted-text">尚无上报结论落入待拟清单；执行「上报问题」后自动生成一条待拟稿预警单，同一巡查只落一次。</p>
      </article>

      <article class="detail-card">
        <h3 class="card-title">改动留痕（可倒查）</h3>
        <table v-if="auditTrail.length" class="data-table">
          <thead>
            <tr><th>时间</th><th>操作人</th><th>动作</th><th>内容</th></tr>
          </thead>
          <tbody>
            <tr v-for="entry in auditTrail" :key="entry.id">
              <td>{{ entry.at }}</td>
              <td>{{ entry.operator }}</td>
              <td>{{ entry.action }}</td>
              <td>{{ entry.detail }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted-text">该排口的记录尚未发生改动，暂无留痕。</p>
      </article>
    </div>
  </section>

  <section v-else class="page">
    <p class="error-text">找不到该排口巡查记录。</p>
    <RouterLink class="btn" to="/outfallpatrol">返回巡查列表</RouterLink>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  getOutfallView,
  linkedWarnings as fetchLinkedWarnings,
  outfallAuditTrail,
  outfallStatuses,
  runOutfallAction,
  updateOutfall,
  type OutfallView,
} from '@/api/outfall-service'
import type { AuditEntry, EntryRow, OutfallPatch } from '@/data/types'

const route = useRoute()
const statuses = outfallStatuses()
const actions = ['提交巡查', '确认完成', '上报问题']

const view = ref<OutfallView | null>(null)
const auditTrail = ref<AuditEntry[]>([])
const linkedWarningRows = ref<EntryRow[]>([])

const form = ref<OutfallPatch>({
  排放水质: '',
  发现问题数: 0,
  巡查日期: '',
  巡查人: '',
  巡查状态: '待巡查',
  expectedVersion: 0,
})
const saveMessage = ref('')
const saveOk = ref(false)
const actionMessage = ref('')

const summaryItems = computed(() => {
  if (!view.value) {
    return []
  }
  return [
    { label: '排口名称', value: view.value.排口名称 },
    { label: '所在河段', value: view.value.所在河段 },
    { label: '排放水质', value: view.value.排放水质 },
    { label: '发现问题数', value: String(view.value.发现问题数) },
    { label: '巡查日期', value: view.value.巡查日期 },
    { label: '巡查人', value: view.value.巡查人 },
    { label: '巡查状态', value: view.value.巡查状态 },
  ]
})

function versionOf(record: EntryRow): number {
  const value = (record as Record<string, unknown>).__version
  return typeof value === 'number' ? value : 0
}
function updatedAtOf(record: EntryRow): string {
  const value = (record as Record<string, unknown>).__updatedAt
  return typeof value === 'string' ? value : ''
}
function updatedByOf(record: EntryRow): string {
  const value = (record as Record<string, unknown>).__updatedBy
  return typeof value === 'string' ? value : ''
}

function load() {
  const id = Number(route.params.id)
  const loaded = getOutfallView(id)
  view.value = loaded
  saveMessage.value = ''
  actionMessage.value = ''
  if (!loaded) {
    return
  }
  form.value = {
    排放水质: loaded.排放水质,
    发现问题数: loaded.发现问题数,
    巡查日期: loaded.巡查日期,
    巡查人: loaded.巡查人,
    巡查状态: loaded.巡查状态,
    expectedVersion: loaded.version,
  }
  auditTrail.value = outfallAuditTrail(loaded.records.map((record) => Number(record.id)))
  linkedWarningRows.value = fetchLinkedWarnings(loaded.records.map((record) => Number(record.id)))
}

function submitPatch() {
  if (!view.value) {
    return
  }
  const result = updateOutfall(view.value.id, { ...form.value })
  saveOk.value = result.ok
  saveMessage.value = result.message
  if (result.ok) {
    load()
  } else {
    // 版本冲突或校验失败：重新取最新数据，但保留用户输入只刷新版本基准提示。
    const latest = getOutfallView(view.value.id)
    if (latest) {
      view.value = latest
      form.value.expectedVersion = latest.version
    }
  }
}

function runAction(action: string) {
  if (!view.value) {
    return
  }
  actionMessage.value = ''
  const result = runOutfallAction(view.value.id, action)
  if (!result.ok) {
    actionMessage.value = result.message
    return
  }
  load()
}

watch(() => route.params.id, load)
onMounted(load)
</script>
