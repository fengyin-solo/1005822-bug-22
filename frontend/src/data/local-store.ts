import { SEED_ROWS } from './seed'
import type { AuditEntry, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'drainage-pump:entries'
// 改动留痕独立存放，刷新、重开浏览器后仍可倒查。
const AUDIT_KEY = 'drainage-pump:audit'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 仅供自测：业务页面不会调用。刷新页面本身就是新进程，无需此方法。
export function __resetCachesForTest(): void {
  cache = null
  auditCache = null
}

let auditCache: AuditEntry[] | null = null

function readAudit(): AuditEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : []
  } catch {
    return []
  }
}

export function listAudit(module?: string, recordId?: number): AuditEntry[] {
  if (auditCache === null) {
    auditCache = readAudit()
  }
  return auditCache.filter(
    (entry) =>
      (module === undefined || entry.module === module) &&
      (recordId === undefined || entry.recordId === recordId),
  )
}

export function appendAudit(entry: Omit<AuditEntry, 'id'>): AuditEntry {
  if (auditCache === null) {
    auditCache = readAudit()
  }
  const saved: AuditEntry = { ...entry, id: Date.now() + auditCache.length }
  auditCache = [saved, ...auditCache]
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(auditCache))
  }
  return saved
}
