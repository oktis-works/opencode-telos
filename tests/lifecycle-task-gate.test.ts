import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { YamlGraphRepository } from "../src/sdd/persistence/yaml.js"
import { createChange } from "../src/sdd/changes/manager.js"
import { finalizeBaseline, getProjectLifecycle } from "../src/sdd/lifecycle/project-phase.js"
import {
  approveTask,
  createTask,
  findApprovedTaskForFile,
  taskApproval,
  updateTask,
} from "../src/sdd/tasks/board.js"
import { writeTaskDossier } from "../src/sdd/tasks/dossier.js"
import { createRuntimeState, enforceToolExecution } from "../src/opencode/sdd-runtime.js"
import { createGraphMutationTool } from "../src/opencode/router/tools-composite.js"
import { setRole } from "../src/sdd/permissions/access.js"

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "telos-lifecycle-"))
  const repo = new YamlGraphRepository(dir)
  const graph = repo.createProject("proj", "Project", "Lifecycle test", "greenfield")
  const now = new Date().toISOString()

  addNode(graph, {
    id: "FEAT-1",
    type: "feature",
    name: "Checkout",
    description: "Checkout flow",
    status: "DRAFT",
    version: 1,
    metadata: { priority: "high" },
    created_at: now,
    updated_at: now,
  } as never)
  addNode(graph, {
    id: "ENT-1",
    type: "entity",
    name: "Order",
    description: "Order entity",
    status: "DRAFT",
    version: 1,
    metadata: { fields: [{ name: "id", type: "uuid", required: true }, { name: "total", type: "integer" }] },
    created_at: now,
    updated_at: now,
  } as never)
  addRelationship(graph, graph.project_id, "FEAT-1", "contains")
  addRelationship(graph, "FEAT-1", "ENT-1", "uses")
  repo.saveGraph(graph)

  return { dir, repo, graph }
}

describe("project lifecycle", () => {
  test("bootstrap refuses Change nodes until the baseline is finalized", () => {
    const { dir, graph } = setup()
    try {
      expect(getProjectLifecycle(graph).phase).toBe("bootstrap")
      expect(() =>
        createChange(graph, {
          title: "Too early",
          reason: "Bootstrap must not create changes",
          affected_node_ids: ["FEAT-1"],
          new_nodes: [],
          modified_nodes: [],
          removed_node_ids: [],
          affected_files: ["src/checkout.ts"],
          affected_tests: [],
          implementation_tasks: [],
        }),
      ).toThrow(/bootstrap/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("finalize_baseline moves the project to delivery", () => {
    const { dir, graph } = setup()
    try {
      const result = finalizeBaseline(graph, "test")
      expect(result.finalized).toBe(true)
      const lifecycle = getProjectLifecycle(graph)
      expect(lifecycle.phase).toBe("delivery")
      expect(lifecycle.baseline.status).toBe("COMPLETE")
      expect(lifecycle.baseline.completed_by).toBe("test")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("after the baseline, a Change is allowed and the project enters evolution", () => {
    const { dir, graph } = setup()
    try {
      finalizeBaseline(graph, "test")
      const change = createChange(graph, {
        title: "Modify checkout",
        reason: "New payment method",
        affected_node_ids: ["FEAT-1"],
        new_nodes: [],
        modified_nodes: [],
        removed_node_ids: [],
        affected_files: ["src/checkout.ts"],
        affected_tests: [],
        implementation_tasks: [],
      })
      expect(change.id).toBe("CHG-001")
      expect(getProjectLifecycle(graph).phase).toBe("evolution")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("task as the single approval gate", () => {
  test("only an approved task covering the file authorizes a real write", () => {
    const { dir, repo, graph } = setup()
    try {
      const actor = process.env.USER || "current"
      setRole(dir, actor, "admin")
      const state = createRuntimeState()
      const write = (filePath: string, callID: string) =>
        enforceToolExecution(dir, "ses_test", callID, "write", { filePath }, state)

      const task = createTask(graph, {
        name: "Implement checkout",
        files: ["src/checkout.ts"],
        link_to: "FEAT-1",
      })
      repo.saveGraph(graph)
      expect(taskApproval(task).status).toBe("PENDING")
      expect(findApprovedTaskForFile(graph, "src/checkout.ts")).toBeUndefined()
      expect(write("src/checkout.ts", "call_before")).toMatch(/SDD BLOCKED/)

      const approved = approveTask(graph, task.id, actor)
      repo.saveGraph(graph)
      expect(taskApproval(approved).status).toBe("APPROVED")
      expect(approved.status).toBe("in_progress")
      expect(findApprovedTaskForFile(graph, "src/checkout.ts")?.id).toBe(task.id)
      expect(findApprovedTaskForFile(graph, "src/other.ts")).toBeUndefined()
      expect(write("src/checkout.ts", "call_after")).toBeUndefined()
      expect(write("src/other.ts", "call_other")).toMatch(/SDD BLOCKED/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("approving a task without files is refused", () => {
    const { dir, graph } = setup()
    try {
      const task = createTask(graph, { name: "No scope", link_to: "FEAT-1" })
      expect(() => approveTask(graph, task.id, "test")).toThrow(/no files/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("changing the scope invalidates approval and metadata cannot self-approve", () => {
    const { dir, graph } = setup()
    try {
      const task = createTask(graph, {
        name: "Implement checkout",
        files: ["src/checkout.ts"],
        link_to: "FEAT-1",
      })
      approveTask(graph, task.id, "test")
      expect(findApprovedTaskForFile(graph, "src/checkout.ts")?.id).toBe(task.id)

      expect(() =>
        updateTask(graph, task.id, { metadata: { approval: { status: "APPROVED" } } }),
      ).toThrow(/approval/i)

      const updated = updateTask(graph, task.id, {
        metadata: { files: ["src/other.ts"] },
      })
      expect(taskApproval(updated).status).toBe("PENDING")
      expect(findApprovedTaskForFile(graph, "src/checkout.ts")).toBeUndefined()
      expect(findApprovedTaskForFile(graph, "src/other.ts")).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("graph mutation cannot self-approve and invalidates a changed file scope", async () => {
    const { dir, repo, graph } = setup()
    try {
      const actor = process.env.USER || "current"
      setRole(dir, actor, "admin")
      const task = createTask(graph, {
        name: "Implement checkout",
        files: ["src/checkout.ts"],
        link_to: "FEAT-1",
      })
      approveTask(graph, task.id, actor)
      repo.saveGraph(graph)

      const mutation = createGraphMutationTool()
      const ctx = { directory: dir, sessionID: "ses_mutation" }
      const selfApprove = await mutation.execute({
        action: "update_node",
        node_id: task.id,
        updates_json: JSON.stringify({ metadata: { approval: { status: "APPROVED" } } }),
      }, ctx) as string
      expect(selfApprove).toContain("cannot be changed")

      const scopeChange = await mutation.execute({
        action: "update_node",
        node_id: task.id,
        updates_json: JSON.stringify({ metadata: { files: ["src/other.ts"] } }),
      }, ctx) as string
      expect(scopeChange).toContain("updated")

      const reloaded = new YamlGraphRepository(dir).loadGraph()
      const updated = reloaded.nodes.find((node) => node.id === task.id) as never
      expect(taskApproval(updated).status).toBe("PENDING")
      expect(findApprovedTaskForFile(reloaded, "src/checkout.ts")).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("task dossier", () => {
  test("writes Markdown and Mermaid diagrams with the resolved graph slice", () => {
    const { dir, graph } = setup()
    try {
      const task = createTask(graph, {
        name: "Implement checkout",
        files: ["src/checkout.ts", "tests/checkout.test.ts"],
        link_to: "FEAT-1",
      })
      const dossier = writeTaskDossier(dir, graph, task.id)

      expect(existsSync(dossier.files["README.md"])).toBe(true)
      expect(existsSync(dossier.files["traceability.md"])).toBe(true)
      expect(existsSync(dossier.files["flow.mmd"])).toBe(true)
      expect(existsSync(dossier.files["data-model.mmd"])).toBe(true)
      expect(existsSync(dossier.files["sequence.mmd"])).toBe(true)
      expect(existsSync(dossier.files["architecture.mmd"])).toBe(true)

      const traceability = readFileSync(dossier.files["traceability.md"], "utf-8")
      expect(traceability).toContain("FEAT-1")
      expect(traceability).toContain("ENT-1")
      expect(traceability).toContain(".sdd/docs/")

      const flow = readFileSync(dossier.files["flow.mmd"], "utf-8")
      expect(flow).toContain("flowchart TD")
      expect(flow).toContain("Checkout")

      const er = readFileSync(dossier.files["data-model.mmd"], "utf-8")
      expect(er).toContain("erDiagram")
      expect(er).toContain("Order")
      expect(er).toContain("total")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("updates task.metadata.dossier with the generated paths", () => {
    const { dir, graph } = setup()
    try {
      const task = createTask(graph, {
        name: "Implement checkout",
        files: ["src/checkout.ts"],
        link_to: "FEAT-1",
      })
      writeTaskDossier(dir, graph, task.id)
      const updated = graph.nodes.find((node) => node.id === task.id)
      const dossier = (updated?.metadata as Record<string, unknown>).dossier as Record<string, unknown>
      expect(String(dossier.readme)).toContain(".sdd/tasks/")
      expect(String(dossier.directory)).toContain(".sdd/tasks/")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
