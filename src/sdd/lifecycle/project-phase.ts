/**
 * Project lifecycle guard.
 *
 * The plugin has three explicit phases:
 *
 *   bootstrap  — discovery, graph, documentation and the initial task backlog.
 *                No Change node is created and no Change approval is required.
 *   delivery   — the documentation baseline is closed. An approved task is the
 *                only authorization needed to implement that task's files.
 *   evolution  — a modification requested after the baseline. Change nodes are
 *                created as an audit/trace record, but task approval remains the
 *                human gate.
 *
 * Legacy graphs without `project.metadata.lifecycle` keep working: a project
 * that already has tasks is treated as delivery, and a project without tasks is
 * treated as bootstrap. New projects always receive an explicit lifecycle.
 */

import type { KnowledgeGraph } from "../domain/types.js"
import { getNode, updateNode } from "../graph/engine.js"

export type ProjectPhase = "bootstrap" | "delivery" | "evolution"

export type BaselineStatus = "PENDING" | "COMPLETE"

export interface BaselineState {
  status: BaselineStatus
  completed_at?: string
  completed_by?: string
  version?: number
  notes?: string
}

export interface ProjectLifecycle {
  phase: ProjectPhase
  baseline: BaselineState
  updated_at: string
  /** True when the value was inferred from a pre-lifecycle graph. */
  legacy?: boolean
}

const LIFECYCLE_KEY = "lifecycle"

const BASELINE_SPEC_TYPES = new Set([
  "domain",
  "feature",
  "requirement",
  "business_rule",
  "entity",
  "value_object",
  "flow",
  "use_case",
  "architecture_component",
  "api",
  "endpoint",
  "module",
  "database",
  "table",
])

function isPhase(value: unknown): value is ProjectPhase {
  return value === "bootstrap" || value === "delivery" || value === "evolution"
}

function now(): string {
  return new Date().toISOString()
}

function projectNode(graph: KnowledgeGraph) {
  const node = getNode(graph, graph.project_id)
  return node?.type === "project" ? node : undefined
}

/**
 * Read the lifecycle without mutating the graph.
 *
 * A graph with no project root is a unit-test/legacy graph: it stays permissive
 * (delivery/complete) so isolated domain helpers keep working.
 */
export function getProjectLifecycle(graph: KnowledgeGraph): ProjectLifecycle {
  const project = projectNode(graph)
  if (!project) {
    return {
      phase: "delivery",
      baseline: { status: "COMPLETE" },
      updated_at: now(),
      legacy: true,
    }
  }

  const metadata = (project.metadata ?? {}) as Record<string, unknown>
  const raw = metadata[LIFECYCLE_KEY]
  if (raw && typeof raw === "object") {
    const candidate = raw as Record<string, unknown>
    const rawBaseline = (candidate.baseline ?? {}) as Record<string, unknown>
    const phase = isPhase(candidate.phase) ? candidate.phase : "bootstrap"
    const baseline: BaselineState = {
      status: rawBaseline.status === "COMPLETE" ? "COMPLETE" : "PENDING",
      ...(typeof rawBaseline.completed_at === "string" ? { completed_at: rawBaseline.completed_at } : {}),
      ...(typeof rawBaseline.completed_by === "string" ? { completed_by: rawBaseline.completed_by } : {}),
      ...(typeof rawBaseline.version === "number" ? { version: rawBaseline.version } : {}),
      ...(typeof rawBaseline.notes === "string" ? { notes: rawBaseline.notes } : {}),
    }
    // A completed baseline can never be in bootstrap.
    return {
      phase: baseline.status === "COMPLETE" && phase === "bootstrap" ? "delivery" : phase,
      baseline,
      updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : now(),
    }
  }

  // Legacy inference — never rewrite until an explicit transition happens.
  const hasTasks = graph.nodes.some((node) => node.type === "task")
  return hasTasks
    ? {
        phase: "delivery",
        baseline: { status: "COMPLETE" },
        updated_at: now(),
        legacy: true,
      }
    : {
        phase: "bootstrap",
        baseline: { status: "PENDING" },
        updated_at: now(),
        legacy: true,
      }
}

export function isBaselineComplete(graph: KnowledgeGraph): boolean {
  return getProjectLifecycle(graph).baseline.status === "COMPLETE"
}

/**
 * Persist an explicit lifecycle when the project does not have one yet.
 * Used by the bootstrap/discovery path so new projects never create Changes
 * while the documentation is still being built.
 */
export function ensureProjectLifecycle(
  graph: KnowledgeGraph,
  phase: ProjectPhase = "bootstrap",
): ProjectLifecycle {
  const project = projectNode(graph)
  const current = getProjectLifecycle(graph)
  if (!project || !current.legacy) return current

  const lifecycle: ProjectLifecycle = {
    phase,
    baseline: { status: phase === "bootstrap" ? "PENDING" : "COMPLETE" },
    updated_at: now(),
  }
  setProjectLifecycle(graph, lifecycle)
  return lifecycle
}

export function setProjectLifecycle(graph: KnowledgeGraph, lifecycle: ProjectLifecycle): void {
  const project = projectNode(graph)
  if (!project) return
  const metadata = {
    ...(project.metadata as Record<string, unknown>),
    [LIFECYCLE_KEY]: lifecycle,
  }
  updateNode(graph, project.id, { metadata: metadata as unknown as typeof project.metadata })
}

export function setProjectPhase(graph: KnowledgeGraph, phase: ProjectPhase): ProjectLifecycle {
  const current = getProjectLifecycle(graph)
  const lifecycle: ProjectLifecycle = {
    ...current,
    phase,
    updated_at: now(),
    legacy: false,
  }
  setProjectLifecycle(graph, lifecycle)
  return lifecycle
}

export interface FinalizeBaselineResult {
  finalized: boolean
  lifecycle: ProjectLifecycle
  reason?: string
}

/**
 * Close the documentation baseline.
 *
 * Requires at least one specification node beyond the project root, so a
 * baseline cannot be declared over an empty graph. Idempotent.
 */
export function finalizeBaseline(
  graph: KnowledgeGraph,
  actor?: string,
  notes?: string,
): FinalizeBaselineResult {
  const current = getProjectLifecycle(graph)
  if (current.baseline.status === "COMPLETE") {
    return { finalized: false, lifecycle: current, reason: "Baseline is already complete." }
  }

  if (!projectNode(graph)) {
    return { finalized: false, lifecycle: current, reason: "Project root not found." }
  }

  const hasSpec = graph.nodes.some((node) => BASELINE_SPEC_TYPES.has(node.type))
  if (!hasSpec) {
    return {
      finalized: false,
      lifecycle: current,
      reason:
        "The graph has no specification nodes yet. Build the documentation (discover/build_graph/update_from_answers) before closing the baseline.",
    }
  }

  const lifecycle: ProjectLifecycle = {
    phase: "delivery",
    baseline: {
      status: "COMPLETE",
      completed_at: now(),
      ...(actor ? { completed_by: actor } : {}),
      ...(notes ? { notes } : {}),
      version: 1,
    },
    updated_at: now(),
  }
  setProjectLifecycle(graph, lifecycle)
  return { finalized: true, lifecycle }
}

export interface ChangeGate {
  allowed: boolean
  reason?: string
  message?: string
}

/**
 * Change nodes are an evolution artifact. They are refused while the original
 * documentation baseline is still open.
 */
export function canCreateChange(graph: KnowledgeGraph): ChangeGate {
  const lifecycle = getProjectLifecycle(graph)
  if (lifecycle.phase !== "bootstrap") return { allowed: true }
  return {
    allowed: false,
    reason: "Project is in bootstrap: the documentation baseline is still open.",
    message: [
      "## SDD: Change not created — bootstrap phase",
      "",
      "The documentation baseline is still open. Change nodes are only created for",
      "modifications requested after the baseline is finalized.",
      "",
      "Next steps:",
      "1. Finish the documentation/task backlog (discover / update_from_answers / build_graph).",
      "2. Close the baseline with `sdd.finalize_baseline` (`confirm: true`).",
      "3. Approve a task and implement it directly — no Change is required for delivery.",
      "4. For later modifications, call `sdd.enforce` again (evolution).",
    ].join("\n"),
  }
}

/** Record that the project entered evolution (first Change after baseline). */
export function markEvolution(graph: KnowledgeGraph): void {
  const lifecycle = getProjectLifecycle(graph)
  if (lifecycle.phase === "evolution") return
  if (lifecycle.baseline.status !== "COMPLETE") return
  setProjectPhase(graph, "evolution")
}

export function describeLifecycle(graph: KnowledgeGraph): string {
  const lifecycle = getProjectLifecycle(graph)
  const baseline = lifecycle.baseline.status === "COMPLETE"
    ? `COMPLETE${lifecycle.baseline.completed_at ? ` at ${lifecycle.baseline.completed_at}` : ""}`
    : "PENDING"
  return `phase=${lifecycle.phase}; baseline=${baseline}`
}
