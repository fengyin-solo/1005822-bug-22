import { appendAudit, listAudits } from '@/data/audit-store'
import { listRows, saveRows } from '@/data/local-store'
import { moduleMeta, filterRows } from '@/api/local-service'
import type { ActionResult, AuditEntry, EntryRow } from '@/data/types'

export const OUTFALL_KEY = 'outfallpatrol'
export const FLOODWARN_KEY = 'floodwarn'

const EDITABLE_STATUSES = ['待巡查', '巡查中', '已完成', '已上报']
const LATEST_MARK = '__latestOutfall'

// 列表/详情共用一份读出口，两处永远读同一份数据，不会再各说各话。
export type PatrolView = EntryRow & {
  version: number
  updatedAt: string
  updatedBy: string
  __latestOutfall: boolean
}

export type SavePatrolPayload = {
  排放水质: string
  发现问题数: string
  巡查日期: string
  巡查人: string
  status: string
  expectedVersion: number
  operator?: string
}

export type CreatePatrolPayload = {
  巡查编号: string
  排口名称: string
  所在河段: string
  排放水质: string
  巡查人: string
  巡查日期: string
  发现问题数: string
  operator?: string
}

function meta() {
  return moduleMeta(OUTFALL_KEY)
}

function nowText(): string {
  return new Date().toISOString()
}

export function formatStamp(stamp: string | number | boolean | undefined): string {
  if (!stamp) {
    return '—'
  }
  const date = new Date(String(stamp))
  if (Number.isNaN(date.getTime())) {
    return String(stamp)
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function parseIssueCount(value: string | number | boolean | undefined): number | null {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) {
    return null
  }
  return Number(text)
}

function patrolDateValue(row: EntryRow): number {
  const text = String(row['巡查日期'] ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) {
    return Number.NaN
  }
  return Number(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

// 同一排口（排口名称 + 所在河段）的多条巡查记录里，以最近一次巡查为准：
// 巡查日期晚的优先，日期相同再比最近改动时间与编号。
function latestIndexByOutfall(rows: EntryRow[]): Map<number, boolean> {
  const groups = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const name = String(row['排口名称'] ?? '').trim()
    const reach = String(row['所在河段'] ?? '').trim()
    const key = `${reach}｜${name}`
    const indexes = groups.get(key)
    if (indexes) {
      indexes.push(index)
    } else {
      groups.set(key, [index])
    }
  })
  const latest = new Map<number, boolean>()
  groups.forEach((indexes) => {
    let winner = indexes[0]
    for (const index of indexes.slice(1)) {
      const candidate = rows[index]
      const current = rows[winner]
      const candidateDate = patrolDateValue(candidate)
      const currentDate = patrolDateValue(current)
      const candidateDateValid = !Number.isNaN(candidateDate)
      const currentDateValid = !Number.isNaN(currentDate)
      if (
        (candidateDateValid && !currentDateValid) ||
        (candidateDateValid === currentDateValid && candidateDate > currentDate) ||
        (candidateDateValid === currentDateValid &&
          candidateDate === currentDate &&
          String(candidate.updatedAt ?? '') > String(current.updatedAt ?? '')) ||
        (candidateDateValid === currentDateValid &&
          candidateDate === currentDate &&
          String(candidate.updatedAt ?? '') === String(current.updatedAt ?? '') &&
          Number(candidate.id) > Number(current.id))
      ) {
        winner = index
      }
    }
    latest.set(winner, true)
  })
  return latest
}

function decorate(rows: EntryRow[]): PatrolView[] {
  const latestMap = latestIndexByOutfall(rows)
  return rows.map((row, index) => ({
    ...row,
    // 既有种子数据没有版本/时间戳：读时补默认值，绝不回写改动既有记录层级。
    version: typeof row.version === 'number' ? row.version : 0,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : '',
    // 列表与详情都以系统状态为准，杜绝「巡查状态」字段和状态机对不上。
    巡查状态: row.status,
    [LATEST_MARK]: latestMap.get(index) === true,
  }))
}

export function listPatrols(filters: Record<string, string> = {}): PatrolView[] {
  const decorated = decorate(listRows(OUTFALL_KEY))
  return filterRows(decorated, filters) as PatrolView[]
}

export function getPatrol(id: number): PatrolView | null {
  return decorate(listRows(OUTFALL_KEY)).find((row) => Number(row.id) === id) ?? null
}

export function latestPatrolByOutfall(rows: PatrolView[] = listPatrols()): PatrolView[] {
  return rows.filter((row) => row[LATEST_MARK])
}

function findDuplicateCode(
  rows: EntryRow[],
  code: string,
  name: string,
  reach: string,
  excludeId?: number,
): EntryRow | undefined {
  const targetCode = code.trim()
  const targetName = name.trim()
  const targetReach = reach.trim()
  return rows.find((row) => {
    if (excludeId !== undefined && Number(row.id) === excludeId) {
      return false
    }
    return (
      String(row['巡查编号'] ?? '').trim() === targetCode &&
      String(row['排口名称'] ?? '').trim() === targetName &&
      String(row['所在河段'] ?? '').trim() === targetReach
    )
  })
}

function stamp(rows: EntryRow[], key: string): number {
  return rows.reduce((max, row) => {
    const value = Number(row[key])
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
}

// 巡查结论落入防涝预警的待拟清单：同一排口（同一巡查记录）重复上报只落一次。
function createFloodwarnDraft(
  patrol: EntryRow,
  issues: number,
  operator: string,
): { created: boolean; message: string } {
  const rows = listRows(FLOODWARN_KEY)
  const sourceId = Number(patrol.id)
  const existed = rows.some(
    (row) => Number(row['来源巡查记录']) === sourceId && row.status !== '已解除',
  )
  if (existed) {
    return { created: false, message: '该巡查结论已在防涝预警待拟清单中，不重复生成' }
  }
  const reach = String(patrol['所在河段'] ?? '')
  const name = String(patrol['排口名称'] ?? '')
  const code = String(patrol['巡查编号'] ?? '')
  const id = stamp(rows, 'id') + 1
  let warningCode = `FW-OUTF-${String(id).padStart(4, '0')}`
  const usedCodes = new Set(rows.map((row) => String(row['预警编号'] ?? '')))
  let suffix = 1
  while (usedCodes.has(warningCode)) {
    warningCode = `FW-OUTF-${String(id).padStart(4, '0')}-${suffix}`
    suffix += 1
  }
  const draft: EntryRow = {
    id,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    预警编号: warningCode,
    预警级别: issues >= 3 ? '黄色预警' : '蓝色预警',
    影响区域: `${reach}${name}`,
    预警依据: `排口巡查（${code}）上报发现 ${issues} 个问题`,
    拟稿人: operator,
    发布时间: '—',
    解除时间: '—',
    预警状态: '待拟稿',
    来源: '排口巡查',
    来源巡查编号: code,
    来源巡查记录: sourceId,
  }
  saveRows(FLOODWARN_KEY, [...rows, draft])
  appendAudit(
    FLOODWARN_KEY,
    id,
    '巡查结论落入待拟清单',
    `排口巡查 ${code} 上报 ${issues} 个问题，生成待拟稿预警单 ${warningCode}`,
    operator,
  )
  return { created: true, message: `已生成防涝预警待拟稿 ${warningCode}` }
}

export function patrolAudits(id: number): AuditEntry[] {
  return listAudits(OUTFALL_KEY, id)
}

export function createPatrol(payload: CreatePatrolPayload): ActionResult & { id?: number } {
  const operator = payload.operator ?? '值班管理员'
  const code = payload['巡查编号'].trim()
  const name = payload['排口名称'].trim()
  const reach = payload['所在河段'].trim()
  const quality = payload['排放水质'].trim()
  const inspector = payload['巡查人'].trim()
  const date = payload['巡查日期'].trim()
  if (!code || !name || !reach) {
    return { ok: false, message: '巡查编号、排口名称、所在河段不能为空' }
  }
  if (!quality) {
    return { ok: false, message: '排放水质不能为空' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: '巡查日期格式应为 YYYY-MM-DD' }
  }
  if (parseIssueCount(payload['发现问题数']) === null) {
    return { ok: false, message: '发现问题数必须是不小于 0 的整数' }
  }
  const rows = listRows(OUTFALL_KEY)
  if (findDuplicateCode(rows, code, name, reach)) {
    return { ok: false, message: `同一排口在该河段下已有巡查编号 ${code}，不允许重号` }
  }
  const id = stamp(rows, 'id') + 1
  const issues = parseIssueCount(payload['发现问题数']) ?? 0
  const stampText = nowText()
  const row: EntryRow = {
    id,
    status: '待巡查',
    pending: true,
    abnormal: false,
    巡查编号: code,
    排口名称: name,
    所在河段: reach,
    排放水质: quality,
    巡查人: inspector || operator,
    巡查日期: date,
    发现问题数: issues,
    巡查状态: '待巡查',
    version: 1,
    createdAt: stampText,
    createdBy: operator,
    updatedAt: stampText,
    updatedBy: operator,
  }
  saveRows(OUTFALL_KEY, [...rows, row])
  appendAudit(OUTFALL_KEY, id, '登记', `登记巡查记录 ${code}（${reach}${name}）`, operator)
  return { ok: true, message: `巡查记录 ${code} 已登记`, id }
}

// 保存一次巡查改动：乐观锁（expectedVersion）保证同一排口被重复提交时只接受先到的那一版。
export function savePatrol(id: number, payload: SavePatrolPayload): ActionResult {
  const operator = payload.operator ?? '值班管理员'
  const quality = payload['排放水质'].trim()
  const date = payload['巡查日期'].trim()
  const inspector = payload['巡查人'].trim()
  const issues = parseIssueCount(payload['发现问题数'])
  const targetStatus = payload.status
  if (!quality) {
    return { ok: false, message: '排放水质不能为空' }
  }
  if (issues === null) {
    return { ok: false, message: '发现问题数必须是不小于 0 的整数' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: '巡查日期格式应为 YYYY-MM-DD' }
  }
  if (!EDITABLE_STATUSES.includes(targetStatus)) {
    return { ok: false, message: `不支持的巡查状态「${targetStatus}」` }
  }
  const rows = listRows(OUTFALL_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排口巡查记录` }
  }
  const current = rows[index]
  const currentVersion = typeof current.version === 'number' ? current.version : 0
  if (payload.expectedVersion !== currentVersion) {
    return {
      ok: false,
      message:
        '该巡查记录已被其他人先提交了一版（当前版本 v' +
        `${currentVersion}），请刷新详情后按最新记录再改，先到的版本已保留`,
    }
  }
  // 终态保护：已上报的记录不能再被改成待巡查。
  if (String(current.status) === '已上报' && targetStatus === '待巡查') {
    return { ok: false, message: '巡查状态已上报的记录不能再被改回「待巡查」' }
  }
  const changes: string[] = []
  const compare = (label: string, key: string, next: string | number) => {
    const prev = current[key]
    if (String(prev ?? '') !== String(next)) {
      changes.push(`${label}：${prev ?? '—'} → ${next || '—'}`)
    }
  }
  compare('排放水质', '排放水质', quality)
  compare('发现问题数', '发现问题数', issues)
  compare('巡查日期', '巡查日期', date)
  compare('巡查人', '巡查人', inspector)
  compare('巡查状态', 'status', targetStatus)
  if (changes.length === 0) {
    return { ok: false, message: '内容没有变化，无需保存' }
  }
  const stampText = nowText()
  const lastStatus = meta().statuses[meta().statuses.length - 1]
  const updated: EntryRow = {
    ...current,
    排放水质: quality,
    发现问题数: issues,
    巡查日期: date,
    巡查人: inspector || String(current['巡查人'] ?? operator),
    status: targetStatus,
    巡查状态: targetStatus,
    pending: targetStatus !== lastStatus,
    version: currentVersion + 1,
    updatedAt: stampText,
    updatedBy: operator,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(OUTFALL_KEY, next)
  appendAudit(
    OUTFALL_KEY,
    id,
    '编辑保存',
    `${String(updated['巡查编号'] ?? '')}：${changes.join('；')}`,
    operator,
  )
  return { ok: true, message: `已保存 ${changes.length} 项改动（v${currentVersion + 1}）` }
}

// 列表上的状态动作同样走带版本的写入口，并留痕；上报问题时把结论送进防涝预警待拟清单。
export function runPatrolAction(
  id: number,
  action: string,
  operator = '值班管理员',
): ActionResult {
  const target = meta().actionTargets[action]
  if (!target) {
    return { ok: false, message: `排口巡查记录没有登记「${action}」这个动作` }
  }
  const rows = listRows(OUTFALL_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排口巡查记录` }
  }
  const current = rows[index]
  const currentStatus = String(current.status)
  if (currentStatus === target) {
    return { ok: false, message: `排口巡查记录已经是「${target}」，不用重复操作` }
  }
  if (currentStatus === '已上报' && target === '待巡查') {
    return { ok: false, message: '巡查状态已上报的记录不能再被改回「待巡查」' }
  }
  const currentVersion = typeof current.version === 'number' ? current.version : 0
  const stampText = nowText()
  const lastStatus = meta().statuses[meta().statuses.length - 1]
  const updated: EntryRow = {
    ...current,
    status: target,
    巡查状态: target,
    pending: target !== lastStatus,
    version: currentVersion + 1,
    updatedAt: stampText,
    updatedBy: operator,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(OUTFALL_KEY, next)
  appendAudit(
    OUTFALL_KEY,
    id,
    action,
    `${String(updated['巡查编号'] ?? '')}：巡查状态 ${currentStatus} → ${target}`,
    operator,
  )
  let extra = ''
  if (action === '上报问题') {
    const issues = parseIssueCount(current['发现问题数']) ?? 0
    if (issues <= 0) {
      extra = '；发现问题数为 0，未生成防涝预警待拟稿'
    } else {
      const handoff = createFloodwarnDraft(updated, issues, operator)
      extra = `；${handoff.message}`
    }
  }
  return { ok: true, message: `排口巡查记录已${action}，当前状态「${target}」${extra}` }
}

export type PatrolStats = { label: string; value: number }[]

export function patrolStats(now = new Date()): PatrolStats {
  const canonical = latestPatrolByOutfall()
  const pendingCount = canonical.filter((row) => String(row.status) === '待巡查').length
  const finishedCount = canonical.filter((row) =>
    ['已完成', '已上报'].includes(String(row.status)),
  ).length
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthlyIssues = canonical.reduce((sum, row) => {
    if (!String(row['巡查日期'] ?? '').startsWith(monthPrefix)) {
      return sum
    }
    return sum + (parseIssueCount(row['发现问题数']) ?? 0)
  }, 0)
  return [
    { label: '待巡查排口', value: pendingCount },
    { label: '已完成巡查', value: finishedCount },
    { label: '本月发现问题数', value: monthlyIssues },
  ]
}
