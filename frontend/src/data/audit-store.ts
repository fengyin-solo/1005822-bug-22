import type { AuditEntry } from './types'

// 改动留痕独立持久化：不进业务数据那一份，既有记录的层级完全不动。
const AUDIT_KEY = 'drainage-pump:audit'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: AuditEntry[] | null = null

function readStorage(): AuditEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as AuditEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 跨标签页：别处改了数据，本页缓存立即作废，避免拿旧快照覆盖别人的改动。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUDIT_KEY) {
      cache = null
    }
  })
}

export function listAudits(module?: string, recordId?: number): AuditEntry[] {
  if (cache === null) {
    cache = readStorage()
  }
  const entries = cache
  const filtered = entries.filter(
    (entry) =>
      (module === undefined || entry.module === module) &&
      (recordId === undefined || entry.recordId === recordId),
  )
  // 最近一条在最前，方便倒查。
  return [...filtered].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id))
}

export function appendAudit(
  module: string,
  recordId: number,
  action: string,
  detail: string,
  operator = '值班管理员',
): AuditEntry {
  if (cache === null) {
    cache = readStorage()
  }
  const id = cache.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
  const entry: AuditEntry = {
    id,
    module,
    recordId,
    action,
    operator,
    at: new Date().toISOString(),
    detail,
  }
  cache = [...cache, entry]
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(cache))
  }
  return clone(entry)
}
