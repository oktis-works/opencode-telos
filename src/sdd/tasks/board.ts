/**
 * Task board domain — Kanban view over `task` nodes without changing the SDD
 * schema.
 *
 * Everything here operates on the existing Knowledge Graph:
 *   - node type `task` (already part of `NodeType` / `TaskNode`);
 *   - statuses already present in `NodeStatus` (`todo`, `ready`, `in_progress`,
 *     `blocked`, `completed`, plus the lifecycle ones);
 *   - existing relationship types (`contains`, `implements`, `depends_on`,
 *     `blocked_by`, `tested_by`).
 *
 * The only new surface is metadata on the task node (`metadata` is an open
 * `Record<string, unknown>` in both YAML and SQLite backends), used to persist
 * the Kanban column and the AI-integration state.
 */

import type {
  AnyNode,
  KnowledgeGraph,
  NodeStatus,
  RelationshipType,
  TaskNode,
} from "../domain/types.js"
import { addNode, addRelationship, getNode, removeNode, updateNode } from "../graph/engine.js"
import { createAcceptanceCriterion, getAcceptanceCriteria } from "../acceptance/service.js"
import { getProjectLifecycle, isBaselineComplete } from "../lifecycle/project-phase.js"

export type TaskColumn = "backlog" | "ready" | "in_progress" | "blocked" | "done"

export type IntegrationStatus = "pending" | "integrated" | "manual"

export type TaskApprovalStatus = "PENDING" | "APPROVED" | "REJECTED"

export interface TaskApproval {
  status: TaskApprovalStatus
  approved_by?: string
  approved_at?: string
  rejected_by?: string
  rejected_at?: string
  note?: string
}

export type TaskPriority = "critical" | "high" | "medium" | "low"

export const TASK_PRIORITIES: readonly TaskPriority[] = ["critical", "high", "medium", "low"]

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)
}

export function taskPriority(task: TaskNode): TaskPriority {
  const value = (task.metadata as Record<string, unknown>).priority
  return isTaskPriority(value) ? value : "medium"
}

export const TASK_COLUMNS: readonly TaskColumn[] = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "done",
]

export const TASK_COLUMN_LABELS: Record<TaskColumn, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
}

const COLUMN_STATUS: Record<TaskColumn, NodeStatus> = {
  backlog: "todo",
  ready: "ready",
  in_progress: "in_progress",
  blocked: "blocked",
  done: "completed",
}

const STATUS_COLUMN: Record<string, TaskColumn> = {
  DRAFT: "backlog",
  PROPOSED: "backlog",
  todo: "backlog",
  ready: "ready",
  APPROVED: "ready",
  in_progress: "in_progress",
  IMPLEMENTING: "in_progress",
  VERIFYING: "in_progress",
  blocked: "blocked",
  BLOCKED: "blocked",
  CONFLICT: "blocked",
  FAILED: "blocked",
  DRIFTED: "blocked",
  completed: "done",
  COMPLETED: "done",
  IMPLEMENTED: "done",
  VERIFIED: "done",
  DEPRECATED: "done",
  ROLLED_BACK: "done",
}

export function isTaskColumn(value: unknown): value is TaskColumn {
  return typeof value === "string" && (TASK_COLUMNS as readonly string[]).includes(value)
}

/** Map any SDD status to the Kanban column it belongs to. */
export function statusToColumn(status: NodeStatus | string): TaskColumn {
  return STATUS_COLUMN[status] ?? "backlog"
}

/** Canonical status for a Kanban column (used when a card is dropped). */
export function columnToStatus(column: TaskColumn): NodeStatus {
  return COLUMN_STATUS[column] ?? "todo"
}

export function getTaskNodes(graph: KnowledgeGraph): TaskNode[] {
  return graph.nodes.filter((n) => n.type === "task") as TaskNode[]
}

export function getTask(graph: KnowledgeGraph, id: string): TaskNode | undefined {
  const node = getNode(graph, id)
  return node && node.type === "task" ? (node as TaskNode) : undefined
}

/** Approval state of a task. Legacy tasks without the field are PENDING. */
export function taskApproval(task: TaskNode): TaskApproval {
  const value = (task.metadata as Record<string, unknown>).approval
  if (!value || typeof value !== "object") return { status: "PENDING" }
  const raw = value as Record<string, unknown>
  const status: TaskApprovalStatus =
    raw.status === "APPROVED" || raw.status === "REJECTED" ? raw.status : "PENDING"
  return {
    status,
    ...(typeof raw.approved_by === "string" ? { approved_by: raw.approved_by } : {}),
    ...(typeof raw.approved_at === "string" ? { approved_at: raw.approved_at } : {}),
    ...(typeof raw.rejected_by === "string" ? { rejected_by: raw.rejected_by } : {}),
    ...(typeof raw.rejected_at === "string" ? { rejected_at: raw.rejected_at } : {}),
    ...(typeof raw.note === "string" ? { note: raw.note } : {}),
  }
}

export function isTaskApproved(task: TaskNode): boolean {
  return taskApproval(task).status === "APPROVED"
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/")
}

/** True when `filePath` is inside the file scope declared by the task. */
export function taskCoversFile(task: TaskNode, filePath: string): boolean {
  const target = normalizeRepoPath(filePath)
  const files = Array.isArray((task.metadata as Record<string, unknown>).files)
    ? ((task.metadata as Record<string, unknown>).files as unknown[]).filter((file): file is string => typeof file === "string")
    : []
  return files.some((scope) => {
    const normalized = normalizeRepoPath(scope)
    if (!normalized || !target) return false
    return target === normalized || target.endsWith(`/${normalized}`) || normalized.endsWith(`/${target}`)
  })
}

/**
 * The delivery write authorization: an APPROVED task covering the file.
 * Completed tasks no longer authorize writes.
 */
export function findApprovedTaskForFile(graph: KnowledgeGraph, filePath: string): TaskNode | undefined {
  return getTaskNodes(graph).find(
    (task) =>
      isTaskApproved(task) &&
      task.status !== "completed" &&
      task.status !== "COMPLETED" &&
      taskCoversFile(task, filePath),
  )
}

/**
 * Approve a task. This is the only human gate for delivery: the declared files
 * become writable immediately, with no Change node.
 */
export function approveTask(graph: KnowledgeGraph, id: string, actor?: string, note?: string): TaskNode {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)

  const metadata = { ...(task.metadata as Record<string, unknown>) }
  const files = Array.isArray(metadata.files)
    ? (metadata.files as unknown[]).filter((file): file is string => typeof file === "string" && file.trim().length > 0)
    : []
  if (files.length === 0) {
    throw new Error(
      `Task ${id} declares no files. Declare the files it will write before approving it.`,
    )
  }

  metadata.approval = {
    status: "APPROVED",
    ...(actor ? { approved_by: actor } : {}),
    approved_at: new Date().toISOString(),
    ...(note ? { note } : {}),
  }
  metadata.approved_files = [...files]
  metadata.board_column = "in_progress"

  return updateNode(graph, id, {
    status: "in_progress",
    metadata: metadata as TaskNode["metadata"],
  }) as TaskNode
}

export function rejectTask(graph: KnowledgeGraph, id: string, actor?: string, note?: string): TaskNode {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)

  const metadata = { ...(task.metadata as Record<string, unknown>) }
  metadata.approval = {
    status: "REJECTED",
    ...(actor ? { rejected_by: actor } : {}),
    rejected_at: new Date().toISOString(),
    ...(note ? { note } : {}),
  }
  metadata.board_column = "blocked"

  return updateNode(graph, id, {
    status: "blocked",
    metadata: metadata as TaskNode["metadata"],
  }) as TaskNode
}

/**
 * Next `TASK-###` id, matching the format produced by `sdd.graph_mutation(action="add_node")`
 * (`${project_id}-TASK-001`). Scans for the highest existing suffix instead of
 * counting nodes so removals never cause a collision.
 */
export function nextTaskId(graph: KnowledgeGraph): string {
  const prefix = `${graph.project_id}-TASK-`
  let max = 0
  for (const node of graph.nodes) {
    if (!node.id.startsWith(prefix)) continue
    const suffix = Number.parseInt(node.id.slice(prefix.length), 10)
    if (Number.isInteger(suffix) && suffix > max) max = suffix
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`
}

export interface TaskLink {
  id: string
  type: RelationshipType
  direction: "outgoing" | "incoming"
  node_id: string
  node_type?: string
  node_name?: string
}

export interface TaskBoardItem {
  id: string
  name: string
  description?: string
  status: NodeStatus
  column: TaskColumn
  version: number
  metadata: Record<string, unknown>
  integration_status: IntegrationStatus
  priority: TaskPriority
  /** SDD Change opened by this task, if any (evolution only). */
  change_id?: string
  change_status?: NodeStatus
  /** Human approval; the delivery write gate. */
  approval: TaskApproval
  created_at: string
  updated_at: string
  links: TaskLink[]
}

export function taskIntegrationStatus(task: TaskNode): IntegrationStatus {
  const value = (task.metadata as Record<string, unknown>).integration_status
  return value === "pending" || value === "integrated" ? value : "manual"
}

export function toTaskBoardItem(graph: KnowledgeGraph, task: TaskNode): TaskBoardItem {
  const links: TaskLink[] = []
  for (const rel of graph.relationships) {
    if (rel.from !== task.id && rel.to !== task.id) continue
    const otherId = rel.from === task.id ? rel.to : rel.from
    const other = getNode(graph, otherId)
    links.push({
      id: rel.id,
      type: rel.type,
      direction: rel.from === task.id ? "outgoing" : "incoming",
      node_id: otherId,
      node_type: other?.type,
      node_name: other?.name,
    })
  }

  const metadata = { ...(task.metadata as Record<string, unknown>) }
  const requirementIds = links
    .filter((link) => link.node_type === "requirement")
    .map((link) => link.node_id)
  const criteria = requirementIds.flatMap((requirementId) => getAcceptanceCriteria(graph, requirementId, true))
  if (criteria.length > 0) {
    metadata.acceptance_summary = {
      total: criteria.length,
      pending: criteria.filter((criterion) => criterion.status === "PENDING").length,
      accepted: criteria.filter((criterion) => criterion.status === "ACCEPTED").length,
      rejected: criteria.filter((criterion) => criterion.status === "REJECTED").length,
      waived: criteria.filter((criterion) => criterion.status === "WAIVED").length,
    }
  }
  const declaredChange = typeof metadata.change_id === "string" ? metadata.change_id : undefined
  const change = declaredChange ? getNode(graph, declaredChange) : undefined
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    status: task.status,
    column: statusToColumn(task.status),
    version: task.version,
    metadata,
    integration_status: taskIntegrationStatus(task),
    priority: taskPriority(task),
    approval: taskApproval(task),
    change_id: change?.type === "change" ? change.id : undefined,
    change_status: change?.type === "change" ? change.status : undefined,
    created_at: task.created_at,
    updated_at: task.updated_at,
    links,
  }
}

export function listTasks(graph: KnowledgeGraph): TaskBoardItem[] {
  return queryTasks(graph, {})
}

// ── Filtering, search and sorting ───────────────────────────────────────

export type TaskSortKey = "column" | "priority" | "name" | "created" | "updated" | "links" | "integration"

export const TASK_SORT_KEYS: readonly TaskSortKey[] = [
  "column", "priority", "name", "created", "updated", "links", "integration",
]

export type TaskSortOrder = "asc" | "desc"

export interface TaskQuery {
  /** Free-text search on id, name, description, goal, files, acceptance, and linked node names. */
  search?: string
  /** Filter by link status: "all", "linked", "unlinked", or a node type (feature, requirement, …). */
  link?: string
  /** Filter by integration status. */
  integration?: "all" | IntegrationStatus
  /** Filter by priority. */
  priority?: "all" | TaskPriority
  /** Filter by Kanban column. */
  column?: "all" | TaskColumn
  /** Sort key (default: "column"). */
  sort?: TaskSortKey
  /** Sort direction (default varies by key). */
  order?: TaskSortOrder
}

function matchesSearch(item: TaskBoardItem, q: string): boolean {
  const hay = [
    item.id,
    item.name,
    item.description ?? "",
    String(item.metadata.goal ?? ""),
    ...(Array.isArray(item.metadata.files) ? item.metadata.files : []),
    ...(Array.isArray(item.metadata.acceptance) ? item.metadata.acceptance : []),
    ...item.links.map((l) => l.node_id),
    ...item.links.map((l) => l.node_name ?? ""),
  ].join(" ").toLowerCase()
  return hay.includes(q)
}

function meaningfulLinks(item: TaskBoardItem): TaskLink[] {
  return item.links.filter((l) => l.type !== "contains")
}

function matchesLinkFilter(item: TaskBoardItem, filter: string): boolean {
  if (filter === "all") return true
  const meaningful = meaningfulLinks(item)
  if (filter === "linked") return meaningful.length > 0
  if (filter === "unlinked") return meaningful.length === 0
  return meaningful.some((l) => l.node_type === filter)
}

function defaultOrder(key: TaskSortKey): TaskSortOrder {
  return key === "updated" || key === "created" ? "desc" : "asc"
}

function sortItems(items: TaskBoardItem[], sortKey: TaskSortKey, order: TaskSortOrder): TaskBoardItem[] {
  const dir = order === "desc" ? -1 : 1
  const columnIndex = (item: TaskBoardItem) => TASK_COLUMNS.indexOf(item.column)
  const integrationWeight = (item: TaskBoardItem) =>
    item.integration_status === "pending" ? 0 : item.integration_status === "manual" ? 1 : 2

  const sorted = [...items].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case "priority":
        cmp = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
        break
      case "name":
        cmp = a.name.localeCompare(b.name)
        break
      case "created":
        cmp = a.created_at.localeCompare(b.created_at)
        break
      case "updated":
        cmp = a.updated_at.localeCompare(b.updated_at)
        break
      case "links":
        cmp = a.links.length - b.links.length
        break
      case "integration":
        cmp = integrationWeight(a) - integrationWeight(b)
        break
      default: {
        // "column" — primary by column order, then priority, then name
        cmp = columnIndex(a) - columnIndex(b)
        if (cmp === 0) cmp = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
        if (cmp === 0) cmp = a.name.localeCompare(b.name)
        return cmp
      }
    }
    if (cmp !== 0) return cmp * dir
    // Stable tiebreakers
    const colCmp = columnIndex(a) - columnIndex(b)
    if (colCmp !== 0) return colCmp
    return a.name.localeCompare(b.name)
  })
  return sorted
}

export function queryTasks(graph: KnowledgeGraph, query: TaskQuery = {}): TaskBoardItem[] {
  const search = (query.search ?? "").trim().toLowerCase().slice(0, 200)
  const link = (query.link ?? "all").trim()
  const integration = query.integration ?? "all"
  const priority = query.priority ?? "all"
  const column = query.column ?? "all"
  const sortKey: TaskSortKey = (query.sort as TaskSortKey) ?? "column"
  const order: TaskSortOrder = query.order ?? defaultOrder(sortKey)

  let items = getTaskNodes(graph).map((task) => toTaskBoardItem(graph, task))

  if (search) items = items.filter((item) => matchesSearch(item, search))
  if (link !== "all") items = items.filter((item) => matchesLinkFilter(item, link))
  if (integration !== "all") items = items.filter((item) => item.integration_status === integration)
  if (priority !== "all") items = items.filter((item) => item.priority === priority)
  if (column !== "all") items = items.filter((item) => item.column === column)

  return sortItems(items, sortKey, order)
}

export interface CreateTaskInput {
  name: string
  description?: string
  goal?: string
  files?: string[]
  acceptance?: string[]
  column?: TaskColumn
  status?: NodeStatus
  priority?: TaskPriority
  link_to?: string
  link_type?: RelationshipType
  origin?: string
  integration_status?: IntegrationStatus
}

function linkTask(
  graph: KnowledgeGraph,
  task: TaskNode,
  linkTo?: string,
  linkType?: RelationshipType,
): void {
  if (linkTo) {
    const target = getNode(graph, linkTo)
    if (target) {
      const type: RelationshipType =
        linkType ?? (target.type === "project" ? "contains" : "implements")
      if (type === "contains") {
        addRelationship(graph, target.id, task.id, "contains")
      } else {
        addRelationship(graph, task.id, target.id, type)
      }
      return
    }
  }

  // Keep the task connected to the project root so a manual card never becomes
  // an orphan (which the integrity/health checks would flag).
  const project = getNode(graph, graph.project_id)
  if (project && project.id !== task.id) {
    try {
      addRelationship(graph, project.id, task.id, "contains")
    } catch {
      // Already linked or cycle rule — nothing to repair.
    }
  }
}

export function createTask(graph: KnowledgeGraph, input: CreateTaskInput): TaskNode {
  const name = (input.name ?? "").trim()
  if (!name) throw new Error("Task name is required")

  const duplicate = getTaskNodes(graph).find((t) => t.name.toLowerCase() === name.toLowerCase())
  if (duplicate) {
    throw new Error(`Task "${name}" already exists (${duplicate.id})`)
  }

  const column = input.column ?? statusToColumn(input.status ?? "todo")
  const status = input.status ?? columnToStatus(column)
  const now = new Date().toISOString()

  const metadata: Record<string, unknown> = {
    board_column: column,
    integration_status: input.integration_status ?? "pending",
    origin: input.origin ?? "dashboard",
    created_from: input.origin ?? "dashboard",
    approval: { status: "PENDING" },
    created_in_phase: getProjectLifecycle(graph).phase,
    change_required: isBaselineComplete(graph),
  }
  if (input.goal) metadata.goal = input.goal
  if (input.files?.length) metadata.files = input.files
  if (input.acceptance?.length) metadata.legacy_acceptance = input.acceptance
  if (isTaskPriority(input.priority)) metadata.priority = input.priority

  const node: TaskNode = {
    id: nextTaskId(graph),
    type: "task",
    name,
    description: input.description,
    status,
    version: 1,
    metadata: metadata as TaskNode["metadata"],
    created_at: now,
    updated_at: now,
  }

  addNode(graph, node)
  linkTask(graph, node, input.link_to, input.link_type)
  if (input.acceptance?.length) {
    const requirement = graph.relationships
      .filter((rel) => rel.from === node.id && rel.type === "implements")
      .map((rel) => getNode(graph, rel.to))
      .find((candidate) => candidate?.type === "requirement")
    if (requirement) {
      for (const criterion of input.acceptance) createAcceptanceCriterion(graph, requirement.id, criterion, `task:${node.id}`)
      delete (node.metadata as Record<string, unknown>).legacy_acceptance
    } else {
      ;(node.metadata as Record<string, unknown>).legacy_acceptance = input.acceptance
    }
  }
  return node
}

export interface UpdateTaskInput {
  name?: string
  description?: string
  goal?: string
  files?: string[]
  acceptance?: string[]
  status?: NodeStatus
  column?: TaskColumn
  priority?: TaskPriority
  metadata?: Record<string, unknown>
  /** Re-flag the task for AI integration (content changed). */
  markPending?: boolean
  expected_version?: number
}

export function updateTask(graph: KnowledgeGraph, id: string, input: UpdateTaskInput): TaskNode {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)

  if (input.expected_version !== undefined && task.version !== input.expected_version) {
    throw new Error(
      `Version conflict on ${id}: expected ${input.expected_version}, found ${task.version}`,
    )
  }

  const updates: Partial<AnyNode> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new Error("Task name cannot be empty")
    const duplicate = getTaskNodes(graph).find(
      (t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) throw new Error(`Task "${name}" already exists (${duplicate.id})`)
    updates.name = name
  }
  if (input.description !== undefined) updates.description = input.description

  const metadata: Record<string, unknown> = { ...(task.metadata as Record<string, unknown>) }
  const previousFiles = JSON.stringify(metadata.files ?? [])
  if (input.metadata) {
    // Approval is the human gate, not a generic metadata field. Allowing it
    // through `metadata` would let a board/API update mark itself approved.
    if ("approval" in input.metadata || "approved_files" in input.metadata) {
      throw new Error(
        "Task approval cannot be changed through metadata; use approveTask/rejectTask.",
      )
    }
    Object.assign(metadata, input.metadata)
  }
  if (input.goal !== undefined) metadata.goal = input.goal
  if (input.files !== undefined) metadata.files = input.files
  // Changing the scope invalidates a previous approval: the human approved a
  // different set of files. This also covers updates that change `files`
  // through the generic metadata bag.
  if (JSON.stringify(metadata.files ?? []) !== previousFiles) {
    metadata.approval = { status: "PENDING" }
    delete metadata.approved_files
  }
  if (input.acceptance !== undefined) {
    const requirement = graph.relationships
      .filter((rel) => rel.from === task.id && rel.type === "implements")
      .map((rel) => getNode(graph, rel.to))
      .find((candidate) => candidate?.type === "requirement")
    if (requirement) {
      for (const criterion of input.acceptance) createAcceptanceCriterion(graph, requirement.id, criterion, `task:${task.id}`)
      delete metadata.acceptance
      delete metadata.legacy_acceptance
    } else {
      metadata.legacy_acceptance = input.acceptance
      delete metadata.acceptance
    }
  }
  if (input.priority !== undefined) metadata.priority = input.priority

  let status = task.status
  if (input.column && isTaskColumn(input.column)) status = columnToStatus(input.column)
  if (input.status) status = input.status
  if (input.column || input.status) {
    updates.status = status
    metadata.board_column = statusToColumn(status)
  } else if (metadata.board_column === undefined) {
    metadata.board_column = statusToColumn(status)
  }

  if (input.markPending) {
    metadata.integration_status = "pending"
    metadata.integration_requested_at = new Date().toISOString()
  }
  if (input.priority !== undefined) {
    metadata.priority = input.priority
  }

  updates.metadata = metadata as AnyNode["metadata"]
  return updateNode(graph, id, updates) as TaskNode
}

export function removeTask(graph: KnowledgeGraph, id: string): void {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)
  removeNode(graph, id)
}

export function markTaskIntegrated(graph: KnowledgeGraph, id: string): TaskNode {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)
  const metadata: Record<string, unknown> = {
    ...(task.metadata as Record<string, unknown>),
    integration_status: "integrated",
    integrated_at: new Date().toISOString(),
  }
  return updateNode(graph, id, { metadata } as Partial<AnyNode>) as TaskNode
}

export function getPendingIntegrationTasks(graph: KnowledgeGraph): TaskNode[] {
  return getTaskNodes(graph).filter((task) => taskIntegrationStatus(task) === "pending")
}

/**
 * Deterministic integration plan handed to the agent (via the system prompt or
 * the `sdd.integrate_tasks` tool). It never mutates the graph itself.
 */
export function buildIntegrationBrief(graph: KnowledgeGraph): string {
  const pending = getPendingIntegrationTasks(graph)
  if (pending.length === 0) {
    return "## SDD Tasks — no task pending integration."
  }

  const lines = [`## SDD Tasks — ${pending.length} task(s) pending integration`, ""]
  for (const task of pending) {
    const meta = task.metadata as Record<string, unknown>
    lines.push(`### ${task.id}: ${task.name}`)
    if (task.description) lines.push(`- Description: ${task.description}`)
    if (meta.goal) lines.push(`- Goal: ${String(meta.goal)}`)
    if (Array.isArray(meta.files) && meta.files.length > 0) {
      lines.push(`- Planned files: ${meta.files.join(", ")}`)
    }
    const derived = toTaskBoardItem(graph, task).metadata.acceptance_summary as Record<string, unknown> | undefined
    if (derived) {
      lines.push(`- Derived acceptance criteria: ${String(derived.total)} total, ${String(derived.pending)} pending, ${String(derived.accepted)} accepted, ${String(derived.rejected)} rejected`)
    }
    lines.push("")
  }

  lines.push(
    "**How to integrate:** link the task to its `feature`/`requirement` with `sdd.graph_mutation(action=\"add_relationship\")` " +
      "(type `implements`), create a `test` when there is coverage (`tested_by`) and record `decision`/`file` " +
      "where it makes sense. Do not touch source files at this stage — it is specification only. " +
      'When done, call `sdd.integrate_tasks` with `action="mark_integrated"` and the `task_id`. ' +
      "Integration generates the task dossier; it does NOT open a Change. " +
      'Approve the task with `sdd.integrate_tasks` (`action="approve_task"`) — that approval authorizes the declared files.',
  )
  return lines.join("\n")
}

/** Short, deterministic prompt used to wake the agent when a card is saved. */
export function buildTaskIntegrationPrompt(taskId: string, name: string): string {
  return [
    "## SDD: manual task integration",
    "",
    `The dashboard created/changed task \`${taskId}\` ("${name}").`,
    "",
    "Integrate it into the Knowledge Graph now:",
    "1. Call `sdd.integrate_tasks` with `action=\"list\"` to see the integration plan.",
    "2. Create the relationships and supporting nodes (`implements` for feature/requirement, `tested_by`, `depends_on`/`blocked_by`, `decision`, `file`).",
    `3. When done, call \`sdd.integrate_tasks\` with \`action="mark_integrated"\` and \`task_id="${taskId}"\`.`,
    "   Integration generates the task dossier and does NOT open a Change.",
    `4. Approve the task with \`sdd.integrate_tasks\` (\`action="approve_task"\`, \`task_id="${taskId}"\`).`,
    "   Approval authorizes the declared files for Write/Edit and shell writes.",
    "",
    "Integration only changes the SDD graph — write code only after the task is approved.",
  ].join("\n")
}
