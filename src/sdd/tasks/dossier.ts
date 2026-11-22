/**
 * Task dossier: the single traceability package for a task.
 *
 * For every task it writes, under `.sdd/tasks/<TASK-ID>/`:
 *   README.md          — objective, files, tests, approval and links
 *   traceability.md    — resolved graph slice, relationships and node docs
 *   flow.mmd           — task flow (Mermaid)
 *   data-model.mmd     — ER model (Mermaid)
 *   sequence.mmd       — actor/endpoint sequence (Mermaid)
 *   architecture.mmd   — components and dependencies (Mermaid)
 *
 * `.sdd/tasks/index.md` lists every task and its approval state.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import type { AnyNode, KnowledgeGraph, TaskNode } from "../domain/types.js"
import { getNode, updateNode } from "../graph/engine.js"
import { getAcceptanceCriteria } from "../acceptance/service.js"
import { MarkdownRepository } from "../persistence/markdown.js"
import { getTask, taskApproval, type TaskApprovalStatus } from "./board.js"
import { buildTaskDiagrams } from "../documentation/mermaid.js"

export interface TaskDossierResult {
  task_id: string
  directory: string
  files: Record<string, string>
  node_ids: string[]
}

function now(): string {
  return new Date().toISOString()
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []
}

function mdLink(label: string, path: string): string {
  return `[${label}](${path})`
}

function nodeDocPath(projectDir: string, graph: KnowledgeGraph, nodeId: string): string {
  const mdRepo = new MarkdownRepository(projectDir)
  return mdRepo.getRelativeDocPath(nodeId, mdRepo.getGraphVersion(graph))
}

function nodeSection(node: AnyNode): string[] {
  const lines = [`- **${node.id}** (${node.type}) — ${node.name}`]
  if (node.description) lines.push(`  - ${node.description.replace(/\r?\n/g, " ").slice(0, 240)}`)
  const metadata = (node.metadata ?? {}) as Record<string, unknown>
  if (Array.isArray(metadata.fields) && metadata.fields.length > 0) {
    const fields = (metadata.fields as Array<Record<string, unknown>>)
      .map((field) => `${String(field.name ?? "field")}:${String(field.type ?? "unknown")}${field.required ? " (required)" : ""}`)
      .join(", ")
    lines.push(`  - Fields: ${fields}`)
  }
  if (typeof metadata.method === "string" && typeof metadata.path === "string") {
    lines.push(`  - Endpoint: ${metadata.method} ${metadata.path}`)
  }
  if (typeof metadata.rule_text === "string") lines.push(`  - Rule: ${metadata.rule_text}`)
  if (Array.isArray(metadata.acceptance_criteria) && metadata.acceptance_criteria.length > 0) {
    lines.push(`  - Acceptance: ${metadata.acceptance_criteria.map(String).join("; ")}`)
  }
  if (typeof metadata.priority === "string") lines.push(`  - Priority: ${metadata.priority}`)
  return lines
}

export function buildTaskDossier(
  projectDir: string,
  graph: KnowledgeGraph,
  taskId: string,
): { readme: string; traceability: string; diagrams: ReturnType<typeof buildTaskDiagrams> } {
  const task = getTask(graph, taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const diagrams = buildTaskDiagrams(graph, taskId)
  const nodeIds = diagrams.node_ids
  const nodes = nodeIds.map((id) => getNode(graph, id)).filter((node): node is AnyNode => Boolean(node) && node!.id !== taskId)
  const metadata = (task.metadata ?? {}) as Record<string, unknown>
  const approval = taskApproval(task)
  const files = readStringArray(metadata.files)
  const tests = readStringArray(metadata.tests ?? metadata.affected_tests)
  const changeId = typeof metadata.change_id === "string" ? metadata.change_id : undefined

  const grouped = new Map<string, AnyNode[]>()
  for (const node of nodes) {
    const bucket = grouped.get(node.type) ?? []
    bucket.push(node)
    grouped.set(node.type, bucket)
  }

  const readme = [
    `# ${task.id}: ${task.name}`,
    "",
    `**Status:** ${task.status}`,
    `**Approval:** ${approval.status}${approval.approved_by ? ` by ${approval.approved_by}` : ""}${approval.approved_at ? ` at ${approval.approved_at}` : ""}`,
    `**Integration:** ${String(metadata.integration_status ?? "manual")}`,
    `**Priority:** ${String(metadata.priority ?? "medium")}`,
    changeId ? `**Change (evolution):** ${changeId}` : "",
    "",
    "## Objective",
    "",
    task.description || String(metadata.goal ?? "No description provided."),
    "",
    "## Scope",
    "",
    files.length > 0 ? files.map((file) => `- \`${file}\``).join("\n") : "- No files declared yet.",
    "",
    "## Tests",
    "",
    tests.length > 0 ? tests.map((file) => `- \`${file}\``).join("\n") : "- No test declared yet.",
    "",
    "## Diagrams",
    "",
    `- ${mdLink("Flow", "flow.mmd")}`,
    `- ${mdLink("Data model", "data-model.mmd")}`,
    `- ${mdLink("Sequence", "sequence.mmd")}`,
    `- ${mdLink("Architecture", "architecture.mmd")}`,
    "",
    "## Traceability",
    "",
    `See ${mdLink("traceability.md", "traceability.md")} for the resolved graph slice, relationships and links to the per-node Markdown.`,
    "",
    "## Implementation rule",
    "",
    approval.status === "APPROVED"
      ? "This task is approved: Write/Edit is authorized for the declared files. Implement the code, run the tests and mark the task done."
      : "Approve this task before writing code. Approval is the only human gate for delivery.",
    "",
    `_Generated at ${now()}._`,
    "",
  ].join("\n")

  const traceability: string[] = [
    `# Traceability — ${task.id}`,
    "",
    `**Task:** ${task.name}`,
    `**Approval:** ${approval.status}`,
    "",
    "## Graph nodes",
    "",
  ]

  if (nodes.length === 0) {
    traceability.push("- No node is linked to this task yet. Link a feature/requirement with `implements` before approval.")
  } else {
    for (const [type, bucket] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      traceability.push(`### ${type} (${bucket.length})`, "")
      for (const node of bucket) {
        traceability.push(...nodeSection(node))
        traceability.push(`  - Doc: ${nodeDocPath(projectDir, graph, node.id)}`)
      }
      traceability.push("")
    }
  }

  traceability.push("## Relationships", "")
  const relevant = graph.relationships.filter((rel) => nodeIds.includes(rel.from) && nodeIds.includes(rel.to))
  if (relevant.length === 0) {
    traceability.push("- No relationship inside the task slice.")
  } else {
    for (const rel of relevant) {
      const from = getNode(graph, rel.from)
      const to = getNode(graph, rel.to)
      traceability.push(`- ${from?.name ?? rel.from} —[${rel.type}]→ ${to?.name ?? rel.to}`)
    }
  }

  traceability.push("", "## Acceptance criteria", "")
  const requirementIds = nodes.filter((node) => node.type === "requirement").map((node) => node.id)
  const criteria = requirementIds.flatMap((id) => getAcceptanceCriteria(graph, id, true))
  if (criteria.length === 0) {
    traceability.push("- No acceptance criterion found for the linked requirements.")
  } else {
    for (const criterion of criteria) {
      traceability.push(`- **${criterion.id}** (${criterion.status}) — ${criterion.metadata.text}`)
    }
  }

  traceability.push("", "## Files and tests", "")
  traceability.push(files.length > 0 ? files.map((file) => `- \`${file}\``).join("\n") : "- No file declared.")
  traceability.push("", tests.length > 0 ? tests.map((file) => `- \`${file}\``).join("\n") : "- No test declared.")
  traceability.push("", `_Generated at ${now()}._`, "")

  return {
    readme: readme,
    traceability: traceability.join("\n"),
    diagrams,
  }
}

/** Write the dossier and persist the paths in `task.metadata.dossier`. */
export function writeTaskDossier(
  projectDir: string,
  graph: KnowledgeGraph,
  taskId: string,
): TaskDossierResult {
  const task = getTask(graph, taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const built = buildTaskDossier(projectDir, graph, taskId)
  const relativeDir = join(".sdd", "tasks", task.id)
  const directory = join(projectDir, relativeDir)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

  const files: Record<string, string> = {
    "README.md": join(directory, "README.md"),
    "traceability.md": join(directory, "traceability.md"),
    "flow.mmd": join(directory, "flow.mmd"),
    "data-model.mmd": join(directory, "data-model.mmd"),
    "sequence.mmd": join(directory, "sequence.mmd"),
    "architecture.mmd": join(directory, "architecture.mmd"),
  }

  writeFileSync(files["README.md"], built.readme, "utf-8")
  writeFileSync(files["traceability.md"], built.traceability, "utf-8")
  writeFileSync(files["flow.mmd"], `${built.diagrams.flow}\n`, "utf-8")
  writeFileSync(files["data-model.mmd"], `${built.diagrams.data_model}\n`, "utf-8")
  writeFileSync(files["sequence.mmd"], `${built.diagrams.sequence}\n`, "utf-8")
  writeFileSync(files["architecture.mmd"], `${built.diagrams.architecture}\n`, "utf-8")

  const metadata = {
    ...(task.metadata as Record<string, unknown>),
    dossier: {
      directory: relativeDir,
      readme: join(relativeDir, "README.md"),
      traceability: join(relativeDir, "traceability.md"),
      diagrams: {
        flow: join(relativeDir, "flow.mmd"),
        data_model: join(relativeDir, "data-model.mmd"),
        sequence: join(relativeDir, "sequence.mmd"),
        architecture: join(relativeDir, "architecture.mmd"),
      },
      generated_at: now(),
    },
  }
  updateNode(graph, task.id, { metadata: metadata as TaskNode["metadata"] })

  return {
    task_id: task.id,
    directory,
    files,
    node_ids: built.diagrams.node_ids,
  }
}

export function writeTaskDossiers(projectDir: string, graph: KnowledgeGraph): TaskDossierResult[] {
  const results: TaskDossierResult[] = []
  for (const node of graph.nodes) {
    if (node.type !== "task") continue
    try {
      results.push(writeTaskDossier(projectDir, graph, node.id))
    } catch {
      // One broken task must not prevent the rest of the dossiers.
    }
  }
  writeTaskIndex(projectDir, graph)
  return results
}

export function writeTaskIndex(projectDir: string, graph: KnowledgeGraph): string {
  const tasks = graph.nodes.filter((node) => node.type === "task") as TaskNode[]
  const directory = join(projectDir, ".sdd", "tasks")
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

  const lines = [
    "# Task Dossiers",
    "",
    "| Task | Status | Approval | Files | Dossier |",
    "|---|---|---|---|---|",
  ]
  for (const task of tasks.sort((a, b) => a.id.localeCompare(b.id))) {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>
    const files = readStringArray(metadata.files)
    const approval = taskApproval(task)
    const status: TaskApprovalStatus = approval.status
    lines.push(
      `| ${task.id} | ${task.status} | ${status} | ${files.length} | [README](.sdd/tasks/${task.id}/README.md) |`,
    )
  }
  lines.push("", `_Generated at ${now()}._`, "")

  const indexPath = join(directory, "index.md")
  writeFileSync(indexPath, lines.join("\n"), "utf-8")
  return indexPath
}
