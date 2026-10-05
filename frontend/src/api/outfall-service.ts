import { MODULE_BY_KEY } from '@/data/modules'
import { appendAudit, listAudit, listRows, saveRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type {
  ActionResult,
  AuditEntry,
  EntryRow,
  OutfallCreate,
  OutfallPatch,
} from '@/data/types'

// 排口巡查的全部业务规则集中在这一层：列表与详情读同一份数据、状态流转守卫、
// 重号校验、先到先得的并发控制、审计留痕、上报结论落入防涝预警待拟清单。

const OUTFALL_KEY = 'outfallpatrol'
const FLOODWARN_KEY = 'floodwarn'

export const OUTFALL_ID_FIELDS = {
  code: '巡查编号',
  name: '排口名称',
  reach: '所在河段',
  quality: '排放水质',
  inspector: '巡查人',
  date: '巡查日期',
  issues: '发现问题数',
  state: '巡查状态',
} as const

// 既有记录没有版本字段：按 0 处理，不改动它们原有的状态层级。
const VERSION_KEY = '__version'
const UPDATED_AT_KEY = '__updatedAt'
const UPDATED_BY_KEY = '__updatedBy'
// 防涝预警单通过该字段回指来源巡查记录，避免重复落入待拟清单。
const SOURCE_PATROL_KEY = '来源巡查'

type MutableOutfallRow = EntryRow & Record<string, string | number | boolean>

export type OutfallView = {
  /** 同排口同河段以最近一次巡查记录为准，id 取该记录，列表与详情都认它。 */
  id: number
  巡查编号: string
  排口名称: string
  所在河段: string
  排放水质: string
  巡查人: string
  巡查日期: string
  发现问题数: number
  巡查状态: string
  status: string
  version: number
  updatedAt: string
  updatedBy: string
  records: EntryRow[]
}

function meta() {
  const found = MODULE_BY_KEY.get(OUTFALL_KEY)
  if (!found) {
    throw new Error('没有登记排口巡查模块')
  }
  return found
}

export function outfallStatuses(): string[] {
  return meta().statuses
}

function operator(): string {
  try {
    const store = useSessionStore()
    return store.operator || '值班管理员'
  } catch {
    return '值班管理员'
  }
}

function nowStamp(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function versionOf(row: EntryRow): number {
  const value = (row as MutableOutfallRow)[VERSION_KEY]
  return typeof value === 'number' ? value : 0
}

function updatedAtOf(row: EntryRow): string {
  const value = (row as MutableOutfallRow)[UPDATED_AT_KEY]
  return typeof value === 'string' ? value : ''
}

function updatedByOf(row: EntryRow): string {
  const value = (row as MutableOutfallRow)[UPDATED_BY_KEY]
  return typeof value === 'string' ? value : ''
}

export function parseIssueCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

// 同一排口的多次巡查按日期倒序，同日期再按版本/修改时间倒序，取最近一次为准。
function sortByLatest(a: EntryRow, b: EntryRow): number {
  const dateDiff = String(b[OUTFALL_ID_FIELDS.date] ?? '').localeCompare(
    String(a[OUTFALL_ID_FIELDS.date] ?? ''),
  )
  if (dateDiff !== 0) {
    return dateDiff
  }
  const versionDiff = versionOf(b) - versionOf(a)
  if (versionDiff !== 0) {
    return versionDiff
  }
  const stampDiff = updatedAtOf(b).localeCompare(updatedAtOf(a))
  if (stampDiff !== 0) {
    return stampDiff
  }
  return Number(b.id) - Number(a.id)
}

function groupKey(row: EntryRow): string {
  return `${String(row[OUTFALL_ID_FIELDS.name] ?? '').trim()}@@${String(
    row[OUTFALL_ID_FIELDS.reach] ?? '',
  ).trim()}`
}

function toView(records: EntryRow[]): OutfallView {
  const latest = records[0]
  const mutable = latest as MutableOutfallRow
  return {
    id: Number(latest.id),
    巡查编号: String(mutable[OUTFALL_ID_FIELDS.code] ?? ''),
    排口名称: String(mutable[OUTFALL_ID_FIELDS.name] ?? ''),
    所在河段: String(mutable[OUTFALL_ID_FIELDS.reach] ?? ''),
    排放水质: String(mutable[OUTFALL_ID_FIELDS.quality] ?? ''),
    巡查人: String(mutable[OUTFALL_ID_FIELDS.inspector] ?? ''),
    巡查日期: String(mutable[OUTFALL_ID_FIELDS.date] ?? ''),
    发现问题数: parseIssueCount(mutable[OUTFALL_ID_FIELDS.issues]),
    // 既有记录的状态以顶层 status 为准，巡查状态文本字段后续保存时同步。
    巡查状态: String(latest.status ?? ''),
    status: String(latest.status ?? ''),
    version: versionOf(latest),
    updatedAt: updatedAtOf(latest),
    updatedBy: updatedByOf(latest),
    records,
  }
}

/** 列表与详情共用的读取口径：同排口同河段合并成一条，值取最近一次巡查。 */
export function outfallViews(): OutfallView[] {
  const groups = new Map<string, EntryRow[]>()
  for (const row of listRows(OUTFALL_KEY)) {
    const key = groupKey(row)
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      groups.set(key, [row])
    }
  }
  return [...groups.values()]
    .map((bucket) => toView([...bucket].sort(sortByLatest)))
    .sort((a, b) => a.巡查编号.localeCompare(b.巡查编号, 'zh-CN'))
}

export type OutfallPage = {
  items: OutfallView[]
  total: number
  page: number
  size: number
}

export function listOutfalls(
  filters: Record<string, string> = {},
): OutfallPage {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched = outfallViews().filter((view) =>
    pairs.every(([field, value]) =>
      String(view[field as keyof OutfallView] ?? '').includes(value.trim()),
    ),
  )
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 按记录 id 找它所属排口的合并视图；旧记录 id 也能定位到当前排口。 */
export function getOutfallView(id: number): OutfallView | null {
  return outfallViews().find(
    (view) => view.id === id || view.records.some((row) => Number(row.id) === id),
  ) ?? null
}

function findRow(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = listRows(OUTFALL_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { rows, index }
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
}

function audit(recordId: number, action: string, detail: string): void {
  appendAudit({ module: OUTFALL_KEY, recordId, action, operator: operator(), at: nowStamp(), detail })
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function uniqueCode(code: string, rows: EntryRow[], ignoreId?: number): boolean {
  return !rows.some(
    (row) =>
      Number(row.id) !== ignoreId &&
      String(row[OUTFALL_ID_FIELDS.code] ?? '').trim() === code.trim(),
  )
}

function uniqueOutfall(name: string, reach: string, rows: EntryRow[], ignoreId?: number): boolean {
  return !rows.some(
    (row) =>
      Number(row.id) !== ignoreId &&
      String(row[OUTFALL_ID_FIELDS.name] ?? '').trim() === name.trim() &&
      String(row[OUTFALL_ID_FIELDS.reach] ?? '').trim() === reach.trim(),
  )
}

export type CreateOutfallResult = ActionResult & { id?: number }

export function createOutfall(input: OutfallCreate): CreateOutfallResult {
  const code = input.巡查编号.trim()
  const name = input.排口名称.trim()
  const reach = input.所在河段.trim()
  const quality = input.排放水质.trim()
  const inspector = input.巡查人.trim()
  const date = input.巡查日期.trim()
  const issues = parseIssueCount(input.发现问题数)

  if (!code) {
    return { ok: false, message: '巡查编号不能为空' }
  }
  if (!name || !reach) {
    return { ok: false, message: '排口名称与所在河段都不能为空' }
  }
  if (!quality) {
    return { ok: false, message: '排放水质不能为空' }
  }
  if (!inspector) {
    return { ok: false, message: '巡查人不能为空' }
  }
  if (!isValidDate(date)) {
    return { ok: false, message: '巡查日期格式应为 YYYY-MM-DD' }
  }

  const rows = listRows(OUTFALL_KEY)
  if (!uniqueCode(code, rows)) {
    return { ok: false, message: `巡查编号 ${code} 已存在，不允许重号` }
  }
  // 同一排口名称在同一条河段下不允许重号（重复登记）。
  if (!uniqueOutfall(name, reach, rows)) {
    return { ok: false, message: `河段「${reach}」下排口「${name}」已登记，不允许重号` }
  }

  const statuses = outfallStatuses()
  const initialStatus = statuses[0]
  const id = nextId(rows)
  const row: MutableOutfallRow = {
    id,
    status: initialStatus,
    pending: true,
    abnormal: false,
    [OUTFALL_ID_FIELDS.code]: code,
    [OUTFALL_ID_FIELDS.name]: name,
    [OUTFALL_ID_FIELDS.reach]: reach,
    [OUTFALL_ID_FIELDS.quality]: quality,
    [OUTFALL_ID_FIELDS.inspector]: inspector,
    [OUTFALL_ID_FIELDS.date]: date,
    [OUTFALL_ID_FIELDS.issues]: issues,
    [OUTFALL_ID_FIELDS.state]: initialStatus,
    [VERSION_KEY]: 1,
    [UPDATED_AT_KEY]: nowStamp(),
    [UPDATED_BY_KEY]: operator(),
  }
  saveRows(OUTFALL_KEY, [...rows, row as EntryRow])
  audit(id, '登记巡查', `编号 ${code}；排口 ${name}；河段 ${reach}；问题数 ${issues}；初始状态「${initialStatus}」`)
  return { ok: true, message: `排口巡查记录 ${code} 已登记`, id }
}

function describeChanges(before: EntryRow, patch: OutfallPatch): string[] {
  const changes: string[] = []
  const mutable = before as MutableOutfallRow
  const scalar = (value: string | number | boolean): string | number =>
    typeof value === 'boolean' ? String(value) : value
  const checks: [string, string | number, string | number][] = [
    [OUTFALL_ID_FIELDS.quality, scalar(mutable[OUTFALL_ID_FIELDS.quality] ?? ''), patch.排放水质],
    [OUTFALL_ID_FIELDS.inspector, scalar(mutable[OUTFALL_ID_FIELDS.inspector] ?? ''), patch.巡查人],
    [OUTFALL_ID_FIELDS.date, scalar(mutable[OUTFALL_ID_FIELDS.date] ?? ''), patch.巡查日期],
    [
      OUTFALL_ID_FIELDS.issues,
      parseIssueCount(mutable[OUTFALL_ID_FIELDS.issues]),
      patch.发现问题数,
    ],
    ['巡查状态', before.status, patch.巡查状态],
  ]
  for (const [field, oldValue, newValue] of checks) {
    if (String(oldValue) !== String(newValue)) {
      changes.push(`${field}：${oldValue || '空'} → ${newValue || '空'}`)
    }
  }
  return changes
}

/** 保存一次巡查改动；expectedVersion 不一致说明已有人先提交，只接受先到的那一版。 */
export function updateOutfall(id: number, patch: OutfallPatch): ActionResult {
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的排口巡查记录` }
  }
  const { rows, index } = found
  const before = rows[index]

  const currentVersion = versionOf(before)
  if (patch.expectedVersion !== currentVersion) {
    return {
      ok: false,
      message: `该排口巡查记录已被别人先改过（当前版本 ${currentVersion}），请重新打开详情取最新版本后再提交；后到的改动不覆盖先到版本`,
    }
  }

  const quality = patch.排放水质.trim()
  const inspector = patch.巡查人.trim()
  const date = patch.巡查日期.trim()
  if (!quality) {
    return { ok: false, message: '排放水质不能为空' }
  }
  if (!inspector) {
    return { ok: false, message: '巡查人不能为空' }
  }
  if (!isValidDate(date)) {
    return { ok: false, message: '巡查日期格式应为 YYYY-MM-DD' }
  }
  if (!Number.isInteger(patch.发现问题数) || patch.发现问题数 < 0) {
    return { ok: false, message: '发现问题数必须是不小于 0 的整数' }
  }

  const statuses = outfallStatuses()
  const targetStatus = patch.巡查状态
  const currentStatus = String(before.status)
  if (!statuses.includes(targetStatus)) {
    return { ok: false, message: `巡查状态「${targetStatus}」不合法` }
  }
  if (targetStatus !== currentStatus) {
    // 已上报是终态：已上报的记录不能再被改成任何别的状态，尤其不能退回待巡查。
    if (currentStatus === statuses[statuses.length - 1]) {
      return { ok: false, message: '该记录已上报，状态不能再被修改（含退回待巡查）' }
    }
    if (statuses.indexOf(targetStatus) < statuses.indexOf(currentStatus)) {
      return {
        ok: false,
        message: `巡查状态只能向前流转，不能由「${currentStatus}」改回「${targetStatus}」`,
      }
    }
  }

  const changes = describeChanges(before, patch)
  const lastStatus = statuses[statuses.length - 1]
  const updated: MutableOutfallRow = {
    ...(before as MutableOutfallRow),
    status: targetStatus,
    pending: targetStatus !== lastStatus,
    [OUTFALL_ID_FIELDS.quality]: quality,
    [OUTFALL_ID_FIELDS.inspector]: inspector,
    [OUTFALL_ID_FIELDS.date]: date,
    [OUTFALL_ID_FIELDS.issues]: patch.发现问题数,
    [OUTFALL_ID_FIELDS.state]: targetStatus,
    [VERSION_KEY]: currentVersion + 1,
    [UPDATED_AT_KEY]: nowStamp(),
    [UPDATED_BY_KEY]: operator(),
  }
  const next = [...rows]
  next[index] = updated as EntryRow
  saveRows(OUTFALL_KEY, next)
  audit(
    Number(before.id),
    '保存巡查改动',
    changes.length ? changes.join('；') : '内容无变化，仅重新保存',
  )
  return { ok: true, message: '巡查改动已保存，刷新或重新打开仍然保留' }
}

function warningLevelFor(issues: number): string {
  if (issues >= 3) {
    return '橙色预警'
  }
  if (issues === 2) {
    return '黄色预警'
  }
  return '蓝色预警'
}

// 排口巡查上报的结论落到防涝预警的待拟清单；同一巡查记录只落一次。
function createWarningDraft(view: OutfallView, sourceRow: EntryRow): EntryRow | null {
  const warnings = listRows(FLOODWARN_KEY)
  const sourceId = String(sourceRow.id)
  if (
    warnings.some((row) => String((row as Record<string, unknown>)[SOURCE_PATROL_KEY] ?? '') === sourceId)
  ) {
    return null
  }

  const nextIdValue =
    warnings.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const serial = String(nextIdValue).padStart(4, '0')
  const draft: MutableOutfallRow = {
    id: nextIdValue,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    预警编号: `FLOO-${serial}`,
    预警级别: warningLevelFor(view.发现问题数),
    影响区域: `${view.所在河段} ${view.排口名称}`,
    预警依据: `排口巡查 ${view.巡查编号} 上报 ${view.发现问题数} 个问题；排放水质：${view.排放水质}（${view.巡查人}，${view.巡查日期}）`,
    拟稿人: '',
    发布时间: '',
    解除时间: '',
    预警状态: '待拟稿',
    [SOURCE_PATROL_KEY]: sourceId,
  }
  saveRows(FLOODWARN_KEY, [...warnings, draft as EntryRow])
  appendAudit({
    module: FLOODWARN_KEY,
    recordId: nextIdValue,
    action: '巡查结论落入待拟清单',
    operator: operator(),
    at: nowStamp(),
    detail: `来源排口巡查 ${view.巡查编号}（记录 ${sourceId}），${view.所在河段} ${view.排口名称}，问题数 ${view.发现问题数}`,
  })
  return draft as EntryRow
}

export type OutfallActionResult = ActionResult & { warningId?: number }

/** 列表动作（提交巡查/确认完成/上报问题）同样走守卫，并负责结论落地。 */
export function runOutfallAction(id: number, action: string): OutfallActionResult {
  const actionTargets = meta().actionTargets
  const target = actionTargets[action]
  if (!target) {
    return { ok: false, message: `排口巡查记录没有登记「${action}」这个动作` }
  }
  // 列表给的是排口视图 id（最近一次记录），直接定位记录；旧 id 也兜底到所属排口。
  const view = getOutfallView(id)
  const targetId = view ? view.id : id
  const found = findRow(targetId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的排口巡查记录` }
  }
  const { rows, index } = found
  const before = rows[index]
  const statuses = outfallStatuses()
  const currentStatus = String(before.status)

  if (currentStatus === statuses[statuses.length - 1]) {
    return { ok: false, message: '该记录已上报，不能再执行状态流转（不能退回待巡查）' }
  }
  if (statuses.indexOf(target) <= statuses.indexOf(currentStatus)) {
    return { ok: false, message: `不能由「${currentStatus}」${action}回退到「${target}」` }
  }
  if (action === '上报问题' && parseIssueCount(before[OUTFALL_ID_FIELDS.issues]) < 1) {
    return { ok: false, message: '发现问题数为 0，不能上报问题；请先在详情中登记问题数' }
  }

  const lastStatus = statuses[statuses.length - 1]
  const stamp = nowStamp()
  const updated: MutableOutfallRow = {
    ...(before as MutableOutfallRow),
    status: target,
    pending: target !== lastStatus,
    abnormal: action === '上报问题',
    [OUTFALL_ID_FIELDS.state]: target,
    [VERSION_KEY]: versionOf(before) + 1,
    [UPDATED_AT_KEY]: stamp,
    [UPDATED_BY_KEY]: operator(),
  }
  const next = [...rows]
  next[index] = updated as EntryRow
  saveRows(OUTFALL_KEY, next)
  audit(Number(before.id), action, `状态：${currentStatus} → ${target}`)

  let warningId: number | undefined
  if (action === '上报问题') {
    const latestView = getOutfallView(Number(before.id))
    if (latestView) {
      const draft = createWarningDraft(latestView, updated as EntryRow)
      if (draft) {
        warningId = Number(draft.id)
      }
    }
  }
  return {
    ok: true,
    message:
      warningId !== undefined
        ? `已${action}，结论已落入防涝预警待拟清单（预警单 ${warningId}）`
        : `已${action}，当前状态「${target}」`,
    warningId,
  }
}

export function outfallAuditTrail(recordIds: number[]): AuditEntry[] {
  const idSet = new Set(recordIds)
  return listAudit(OUTFALL_KEY).filter((entry) => idSet.has(entry.recordId))
}

export function linkedWarnings(recordIds: number[]): EntryRow[] {
  const idSet = new Set(recordIds.map(String))
  return listRows(FLOODWARN_KEY).filter((row) =>
    idSet.has(String((row as Record<string, unknown>)[SOURCE_PATROL_KEY] ?? '')),
  )
}
