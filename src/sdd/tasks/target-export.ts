/**
 * Export the reverse-engineering target backlog into a fresh SDD project.
 *
 * The source graph is never modified. The target project receives the
 * technology-agnostic specification nodes, the target tasks, the traceability
 * edges that survive without source files/findings, and a dossier per task.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs"
import { basename, isAbsolute, join, relative, resolve } from "path"
import type { AnyNode, KnowledgeGraph, Relationship, TaskNode } from "../domain/types.js"
import { addNode, addRelationship } from "../graph/engine.js"
import { finalizeBaseline } from "../lifecycle/project-phase.js"
import { createRepository } from "../persistence/repository.js"
import { writeTaskDossiers } from "./dossier.js"

export interface TargetExportOptions {
  /** New project directory. Relative paths are resolved against the source project. */
  targetDir: string
  projectName?: string
  /** JSON object or `key=value,key=value` string. Falls back to graph metadata. */
  techStack?: string | Record<string, string>
  /** Preview the export without creating the target project or writing any file. */
  dryRun?: boolean
}

export interface TargetExportResult {
  targetDir: string
  projectId: string
  projectName: string
  nodes: number
  relationships: number
  tasks: number
  requirements: number
  dossiers: number
  stack: Record<string, string>
  reportPath: string
  dryRun: boolean
  nodesByType: Record<string, number>
  taskPreview: Array<{ id: string; name: string }>
}

const EXPORT_NODE_TYPES = new Set([
  "domain",
  "feature",
  "requirement",
  "business_rule",
  "actor",
  "entity",
  "value_object",
  "flow",
  "use_case",
  "architecture_component",
  "module",
  "api",
  "endpoint",
  "database",
  "table",
  "field",
  "decision",
  "constraint",
  "assumption",
  "acceptance_criterion",
  "task",
])

function now(): string {
  return new Date().toISOString()
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function metadataOf(node: AnyNode): Record<string, unknown> {
  return clone((node.metadata ?? {}) as Record<string, unknown>)
}

function isTargetTask(node: AnyNode): boolean {
  if (node.type !== "task") return false
  const metadata = metadataOf(node)
  return metadata.execution_scope === "target" || metadata.purpose === "reverse_engineering"
}

function readStackFromGraph(graph: KnowledgeGraph): Record<string, string> {
  const project = graph.nodes.find((node) => node.type === "project")
  const candidates = [
    (graph.metadata as Record<string, unknown>).tech_stack,
    project ? (project.metadata as Record<string, unknown>).tech_stack : undefined,
  ]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue
    const entries = Object.entries(candidate as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, value]) => [key, value.trim()])
    if (entries.length > 0) return Object.fromEntries(entries)
  }
  return {}
}

function parseStackText(text: string): Record<string, string> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith("{")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error("`tech_stack` is not valid JSON.")
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("`tech_stack` JSON must be an object such as {\"backend\":\"NestJS\"}.")
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([key, value]) => [key, value.trim()]),
    )
  }

  const stack: Record<string, string> = {}
  for (const part of trimmed.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)) {
    const index = part.indexOf("=")
    if (index <= 0) {
      throw new Error("`tech_stack` must be JSON or `layer=technology` pairs, e.g. backend=NestJS,database=PostgreSQL.")
    }
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!key || !value) throw new Error("`tech_stack` contains an empty layer or technology.")
    stack[key] = value
  }
  return stack
}

export function resolveTechStack(
  raw: string | Record<string, string> | undefined,
  graph: KnowledgeGraph,
): Record<string, string> {
  let stack: Record<string, string> = {}
  if (typeof raw === "string") stack = parseStackText(raw)
  else if (raw && typeof raw === "object") {
    stack = Object.fromEntries(
      Object.entries(raw)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([key, value]) => [key, value.trim()]),
    )
  }
  if (Object.keys(stack).length === 0) stack = readStackFromGraph(graph)
  if (Object.keys(stack).length === 0) {
    throw new Error(
      "`tech_stack` is required before exporting: choose the target stack, e.g. {\"frontend\":\"React\",\"backend\":\"NestJS\",\"database\":\"PostgreSQL\"}.",
    )
  }
  return stack
}

function resolveTargetDir(projectDir: string, targetDir: string, create: boolean): string {
  const source = resolve(projectDir)
  const target = resolve(source, targetDir)
  if (target === source) throw new Error("`target_dir` must be a new project, not the source project.")
  const rel = relative(source, target)
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    throw new Error("`target_dir` must be outside the source project.")
  }
  if (existsSync(target)) {
    const entries = readdirSync(target).filter((entry) => entry !== ".DS_Store")
    if (entries.length > 0) {
      throw new Error("`target_dir` already exists and is not empty. Choose a fresh directory.")
    }
  }
  if (create) mkdirSync(target, { recursive: true })
  return target
}

function targetNodeId(projectId: string, sourceProjectId: string, sourceId: string): string {
  const prefix = `${sourceProjectId}-`
  const suffix = sourceId.startsWith(prefix)
    ? sourceId.slice(prefix.length)
    : sourceId.replace(/[^a-zA-Z0-9_-]+/g, "-")
  return `${projectId}-${suffix}`
}

function cloneNode(
  node: AnyNode,
  targetId: string,
  stack: Record<string, string>,
  sourceProjectId: string,
): AnyNode {
  const timestamp = now()
  const metadata = metadataOf(node)

  if (node.type === "architecture_component") {
    const layer = typeof metadata.layer === "string" ? metadata.layer : ""
    if (layer && stack[layer]) metadata.technology = stack[layer]
  }

  if (node.type === "task") {
    const sourceTaskId = node.id
    delete metadata.approval
    delete metadata.approved_files
    delete metadata.change_id
    delete metadata.change_status
    delete metadata.dossier
    delete metadata.files
    metadata.approval = { status: "PENDING" }
    metadata.board_column = "backlog"
    metadata.integration_status = "manual"
    metadata.origin = "reverse_engineering_export"
    metadata.created_from = "reverse_engineering_export"
    metadata.created_in_phase = "delivery"
    metadata.change_required = true
    metadata.execution_scope = "source"
    metadata.purpose = "greenfield"
    metadata.source_task_id = sourceTaskId
    metadata.exported_from = sourceProjectId
    metadata.exported_at = timestamp
  }

  if (node.type === "acceptance_criterion") {
    metadata.criterion_version = 1
    metadata.source_status = node.status
  }

  return {
    ...clone(node),
    id: targetId,
    status: node.type === "task" ? "todo" : node.type === "acceptance_criterion" ? "PENDING" : "DRAFT",
    version: 1,
    metadata,
    created_at: timestamp,
    updated_at: timestamp,
    change_id: undefined,
    previous_version: undefined,
    md_path: undefined,
  } as AnyNode
}

function reportFor(
  result: Omit<TargetExportResult, "reportPath">,
  graph: KnowledgeGraph,
): string {
  const tasks = graph.nodes
    .filter((node) => node.type === "task")
    .sort((a, b) => a.id.localeCompare(b.id)) as TaskNode[]
  const lines = [
    `# Target Backlog — ${result.projectName}`,
    "",
    `Exported from: \`${graph.metadata.source_project ?? "unknown"}\``,
    `Exported at: ${now()}`,
    `Target project: \`${result.targetDir}\``,
    "",
    "## Stack",
    "",
    ...Object.entries(result.stack).map(([layer, technology]) => `- **${layer}:** ${technology}`),
    "",
    "## Backlog",
    "",
  ]
  if (tasks.length === 0) {
    lines.push("- No target tasks were exported.")
  } else {
    for (const task of tasks) {
      const metadata = task.metadata as Record<string, unknown>
      lines.push(`- **${task.id}** — ${task.name}${metadata.priority ? ` (${String(metadata.priority)})` : ""}`)
    }
  }
  lines.push(
    "",
    "## Next steps",
    "",
    "1. Declare the target files for each task (`sdd.integrate_tasks` action=`update`).",
    "2. Approve a task to authorize exactly those files.",
    "3. Implement and verify the task.",
    "",
  )
  return lines.join("\n")
}

interface TargetExportPlan {
  stack: Record<string, string>
  targetDir: string
  projectName: string
  projectId: string
  exportedAt: string
  selected: AnyNode[]
  idMap: Map<string, string>
  nodesByType: Record<string, number>
  taskPreview: Array<{ id: string; name: string }>
  tasks: number
  requirements: number
  relationships: number
  reportPath: string
}

function buildTargetExportPlan(
  projectDir: string,
  graph: KnowledgeGraph,
  options: TargetExportOptions,
): TargetExportPlan {
  if (graph.metadata.purpose !== "reverse_engineering") {
    throw new Error("Only an SDD with purpose=reverse_engineering can export a target backlog.")
  }
  if (!graph.nodes.some((node) => isTargetTask(node))) {
    throw new Error("No target tasks found. Run sdd.reverse_engineer with purpose=reverse_engineering first.")
  }

  const dryRun = options.dryRun === true
  const stack = resolveTechStack(options.techStack, graph)
  const targetDir = resolveTargetDir(projectDir, options.targetDir, !dryRun)
  const projectName = options.projectName?.trim() || basename(targetDir) || "Target project"
  const projectId = slug(projectName) || "target-project"
  const selected = graph.nodes.filter((node) =>
    node.type !== "project" &&
    EXPORT_NODE_TYPES.has(node.type) &&
    (node.type !== "task" || isTargetTask(node)),
  )

  const idMap = new Map<string, string>([[graph.project_id, projectId]])
  for (const node of selected) {
    idMap.set(node.id, targetNodeId(projectId, graph.project_id, node.id))
  }

  const nodesByType: Record<string, number> = {}
  for (const node of selected) {
    nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1
  }

  let relationships = 0
  for (const relationship of graph.relationships) {
    const from = idMap.get(relationship.from)
    const to = idMap.get(relationship.to)
    if (from && to && from !== to) relationships++
  }

  const taskPreview = selected
    .filter((node) => node.type === "task")
    .map((node) => ({ id: idMap.get(node.id) ?? node.id, name: node.name }))

  return {
    stack,
    targetDir,
    projectName,
    projectId,
    exportedAt: now(),
    selected,
    idMap,
    nodesByType,
    taskPreview,
    tasks: taskPreview.length,
    requirements: selected.filter((node) => node.type === "requirement").length,
    relationships,
    reportPath: join(targetDir, "TARGET_BACKLOG.md"),
  }
}

export function exportTargetBacklog(
  projectDir: string,
  graph: KnowledgeGraph,
  options: TargetExportOptions,
): TargetExportResult {
  const dryRun = options.dryRun === true
  const plan = buildTargetExportPlan(projectDir, graph, options)
  const result: TargetExportResult = {
    targetDir: plan.targetDir,
    projectId: plan.projectId,
    projectName: plan.projectName,
    nodes: plan.selected.length,
    relationships: plan.relationships,
    tasks: plan.tasks,
    requirements: plan.requirements,
    dossiers: plan.tasks,
    stack: plan.stack,
    reportPath: plan.reportPath,
    dryRun,
    nodesByType: plan.nodesByType,
    taskPreview: plan.taskPreview,
  }
  if (dryRun) return result

  const repo = createRepository(plan.targetDir)
  const targetGraph = repo.createProject(
    plan.projectId,
    plan.projectName,
    `Target project exported from ${graph.project_id}`,
    "greenfield",
  )
  targetGraph.metadata.purpose = "greenfield"
  targetGraph.metadata.source_project = graph.project_id
  ;(targetGraph.metadata as Record<string, unknown>).tech_stack = plan.stack
  const targetProject = targetGraph.nodes.find((node) => node.type === "project")
  if (targetProject) {
    Object.assign(targetProject.metadata, {
      purpose: "greenfield",
      stack: Object.values(plan.stack),
      tech_stack: plan.stack,
      source_project: graph.project_id,
      exported_at: plan.exportedAt,
    })
  }

  let nodes = 0
  for (const node of plan.selected) {
    const targetId = plan.idMap.get(node.id)
    if (!targetId || targetGraph.nodes.some((candidate) => candidate.id === targetId)) continue
    addNode(targetGraph, cloneNode(node, targetId, plan.stack, graph.project_id))
    nodes++
  }

  let relationships = 0
  for (const relationship of graph.relationships) {
    const from = plan.idMap.get(relationship.from)
    const to = plan.idMap.get(relationship.to)
    if (!from || !to || from === to) continue
    try {
      addRelationship(
        targetGraph,
        from,
        to,
        relationship.type as Relationship["type"],
        {
          ...clone(relationship.metadata ?? {}),
          source: "reverse_engineering_export",
          exported_from: graph.project_id,
        },
      )
      relationships++
    } catch {
      // Source-only nodes (files, findings, tests) disappear from the slice;
      // an edge that cannot be represented in the target graph is skipped.
    }
  }

  finalizeBaseline(targetGraph, "target_export", `Exported from ${graph.project_id}`)

  const dossiers = writeTaskDossiers(plan.targetDir, targetGraph)
  repo.saveGraph(targetGraph)

  result.nodes = nodes
  result.relationships = relationships
  result.tasks = targetGraph.nodes.filter((node) => node.type === "task").length
  result.requirements = targetGraph.nodes.filter((node) => node.type === "requirement").length
  result.dossiers = dossiers.length
  writeFileSync(result.reportPath, reportFor(result, targetGraph), "utf-8")
  return result
}

export function formatTargetExport(result: TargetExportResult): string {
  const lines = [
    result.dryRun ? "## Target backlog export preview (dry run)" : "## Target backlog exported",
    "",
    `- **Target directory:** \`${result.targetDir}\``,
    `- **Project:** ${result.projectName} (\`${result.projectId}\`)`,
    `- **Writes:** ${result.dryRun ? "none — this is a preview" : "target project created"}`,
    `- **Nodes:** ${result.nodes}`,
    `- **Relationships:** ${result.relationships}`,
    `- **Requirements:** ${result.requirements}`,
    `- **Tasks:** ${result.tasks}`,
    `- **Task dossiers:** ${result.dossiers}`,
    `- **Report:** \`${result.reportPath}\`${result.dryRun ? " (would be written)" : ""}`,
    `- **Stack:** ${Object.entries(result.stack).map(([layer, technology]) => `${layer}=${technology}`).join(", ")}`,
  ]
  if (result.dryRun) {
    lines.push("", "### Nodes by type", "")
    for (const [type, count] of Object.entries(result.nodesByType).sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`- **${type}:** ${count}`)
    }
    lines.push("", "### Tasks that would be exported", "")
    for (const task of result.taskPreview) {
      lines.push(`- **${task.id}** — ${task.name}`)
    }
  }
  lines.push("", "Next: declare the target files for each task, then approve the task to authorize exactly those files.")
  return lines.join("\n")
}
