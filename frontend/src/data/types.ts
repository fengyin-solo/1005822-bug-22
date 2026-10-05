/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 审计留痕：每次业务改动一条，谁、什么时候、改了什么都能倒查。 */
export type AuditEntry = {
  id: number
  module: string
  recordId: number
  action: string
  operator: string
  at: string
  detail: string
}

/** 排口巡查一次修改提交的内容；expectedVersion 用于先到先得的并发控制。 */
export type OutfallPatch = {
  排放水质: string
  发现问题数: number
  巡查日期: string
  巡查人: string
  巡查状态: string
  expectedVersion: number
}

/** 登记一条新的排口巡查记录。 */
export type OutfallCreate = {
  巡查编号: string
  排口名称: string
  所在河段: string
  排放水质: string
  巡查人: string
  巡查日期: string
  发现问题数: number
}
