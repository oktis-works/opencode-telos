/**
 * Deterministic Mermaid generation from the Knowledge Graph.
 *
 * No LLM is involved: the same graph always produces the same `.mmd` file.
 * Diagrams are scoped to a task's subgraph so a task dossier contains only the
 * flows, entities and components that task actually touches.
 */

import type { AnyNode, KnowledgeGraph, Relationship } from "../domain/types.js"
import { getNode } from "../graph/engine.js"

export interface TaskDiagramSet {
  flow: string
  data_model: string
  sequence: string
  architecture: string
  node_ids: string[]
}

const FLOW_TYPES = new Set([
  "task",
  "feature",
  "requirement",
  "business_rule",
  "flow",
  "use_case",
  "endpoint",
  "actor",
])

const ER_TYPES = new Set(["entity", "value_object", "table"])

const SEQUENCE_TYPES = new Set(["task", "actor", "endpoint", "use_case"])

const ARCH_TYPES = new Set(["architecture_component", "module", "api", "database"])

/**
 * BFS around the task, both directions, bounded by `maxDepth`.
 * The project root and change nodes are deliberately excluded: they are
 * governance/audit nodes, not part of the task's functional slice.
 */
export function collectTaskNodeIds(graph: KnowledgeGraph, taskId: string, maxDepth = 2): string[] {
  if (!getNode(graph, taskId)) return []
  const selected = new Set<string>([taskId])
  let frontier = [taskId]

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const rel of graph.relationships) {
        if (rel.from !== id && rel.to !== id) continue
        const otherId = rel.from === id ? rel.to : rel.from
        if (otherId === graph.project_id || selected.has(otherId)) continue
        const other = getNode(graph, otherId)
        if (!other || other.type === "change") continue
        selected.add(otherId)
        next.push(otherId)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }

  return [...selected]
}

function mermaidText(value: string, max = 90): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

function nodeLabel(node: AnyNode): string {
  return mermaidText(`${node.id}: ${node.name}`)
}

function entityId(node: AnyNode): string {
  return `E_${node.id.replace(/[^A-Za-z0-9_]/g, "_")}`
}

function participantId(index: number): string {
  return `P${index}`
}

function edgesInside(graph: KnowledgeGraph, ids: Set<string>, allowed?: Set<string>): Relationship[] {
  return graph.relationships.filter((rel) => {
    if (!ids.has(rel.from) || !ids.has(rel.to)) return false
    if (allowed && !allowed.has(rel.type)) return false
    return true
  })
}

export function generateFlowDiagram(graph: KnowledgeGraph, ids: string[]): string {
  const selected = ids
    .map((id) => getNode(graph, id))
    .filter((node): node is AnyNode => Boolean(node) && FLOW_TYPES.has(node!.type))

  if (selected.length === 0) {
    return "flowchart TD\n  %% No flow-related node is linked to this task."
  }

  const alias = new Map<string, string>()
  selected.forEach((node, index) => alias.set(node.id, `F${index}`))

  const lines = ["flowchart TD"]
  for (const node of selected) {
    lines.push(`  ${alias.get(node.id)}["${nodeLabel(node)}"]`)
  }
  for (const rel of edgesInside(graph, new Set(alias.keys()))) {
    if (rel.type === "contains") continue
    lines.push(`  ${alias.get(rel.from)} -->|${rel.type}| ${alias.get(rel.to)}`)
  }
  return lines.join("\n")
}

export function generateErDiagram(graph: KnowledgeGraph, ids: string[]): string {
  const selected = ids
    .map((id) => getNode(graph, id))
    .filter((node): node is AnyNode => Boolean(node) && ER_TYPES.has(node!.type))

  if (selected.length === 0) {
    return "erDiagram\n  %% No entity/value object/table is linked to this task."
  }

  const selectedIds = new Set(selected.map((node) => node.id))
  const lines = ["erDiagram"]
  for (const node of selected) {
    lines.push(`  %% ${node.id}: ${mermaidText(node.name)}`)
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    const fields = Array.isArray(metadata.fields)
      ? (metadata.fields as Array<Record<string, unknown>>)
      : []
    lines.push(`  ${entityId(node)} {`)
    if (fields.length === 0) {
      lines.push("    string id")
    } else {
      for (const field of fields.slice(0, 24)) {
        const name = mermaidText(String(field.name ?? "field"), 40).replace(/[^A-Za-z0-9_]/g, "_") || "field"
        const type = mermaidText(String(field.type ?? "string"), 24).replace(/[^A-Za-z0-9_]/g, "_") || "string"
        lines.push(`    ${type} ${name}`)
      }
    }
    lines.push("  }")
  }

  for (const rel of edgesInside(graph, selectedIds)) {
    if (rel.from === rel.to) continue
    lines.push(`  ${entityId(getNode(graph, rel.from)!)} ||--o{ ${entityId(getNode(graph, rel.to)!)} : "${rel.type}"`)
  }
  return lines.join("\n")
}

export function generateSequenceDiagram(graph: KnowledgeGraph, ids: string[]): string {
  const selected = ids
    .map((id) => getNode(graph, id))
    .filter((node): node is AnyNode => Boolean(node) && SEQUENCE_TYPES.has(node!.type))

  if (selected.length === 0) {
    return "sequenceDiagram\n  %% No actor/endpoint/use case is linked to this task."
  }

  const alias = new Map<string, string>()
  selected.forEach((node, index) => alias.set(node.id, participantId(index)))

  const lines = ["sequenceDiagram"]
  for (const node of selected) {
    const keyword = node.type === "actor" ? "actor" : "participant"
    lines.push(`  ${keyword} ${alias.get(node.id)} as "${nodeLabel(node)}"`)
  }

  const edges = edgesInside(graph, new Set(alias.keys()))
  if (edges.length === 0) {
    const first = selected[0]
    lines.push(`  Note over ${alias.get(first.id)}: ${nodeLabel(first)}`)
  } else {
    for (const rel of edges) {
      if (rel.type === "contains") continue
      lines.push(`  ${alias.get(rel.from)}->>${alias.get(rel.to)}: ${rel.type}`)
    }
  }
  return lines.join("\n")
}

export function generateArchitectureDiagram(graph: KnowledgeGraph, ids: string[]): string {
  const selected = ids
    .map((id) => getNode(graph, id))
    .filter((node): node is AnyNode => Boolean(node) && ARCH_TYPES.has(node!.type))

  if (selected.length === 0) {
    return "flowchart LR\n  %% No architecture component/module/API/database is linked to this task."
  }

  const alias = new Map<string, string>()
  selected.forEach((node, index) => alias.set(node.id, `A${index}`))

  const lines = ["flowchart LR"]
  for (const node of selected) {
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    const detail = metadata.technology || metadata.layer || metadata.path || ""
    const label = detail ? `${nodeLabel(node)} (${String(detail)})` : nodeLabel(node)
    lines.push(`  ${alias.get(node.id)}["${mermaidText(label)}"]`)
  }
  for (const rel of edgesInside(graph, new Set(alias.keys()))) {
    if (rel.type === "contains") continue
    lines.push(`  ${alias.get(rel.from)} -->|${rel.type}| ${alias.get(rel.to)}`)
  }
  return lines.join("\n")
}

export function buildTaskDiagrams(graph: KnowledgeGraph, taskId: string): TaskDiagramSet {
  const ids = collectTaskNodeIds(graph, taskId)
  return {
    flow: generateFlowDiagram(graph, ids),
    data_model: generateErDiagram(graph, ids),
    sequence: generateSequenceDiagram(graph, ids),
    architecture: generateArchitectureDiagram(graph, ids),
    node_ids: ids,
  }
}
