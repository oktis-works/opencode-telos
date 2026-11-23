import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createSddTools } from "../src/opencode/tools.js"
import { runSddCommand } from "../src/opencode/command.js"
import { resetWorkflowState } from "../src/sdd/enforcement/workflow-tracker.js"
import { getProjectLifecycle } from "../src/sdd/lifecycle/project-phase.js"
import { createRepository } from "../src/sdd/persistence/repository.js"

function seedProject(dir: string): void {
  mkdirSync(join(dir, "src", "api"), { recursive: true })
  mkdirSync(join(dir, "src", "models"), { recursive: true })

  writeFileSync(
    join(dir, "src", "api", "users.ts"),
    [
      "// REST API for users",
      "export async function listUsers(): Promise<User[]> {",
      "  return db.user.findMany()",
      "}",
      "",
      "export async function createUser(input: { email: string; name: string }): Promise<User> {",
      "  return db.user.create({ data: input })",
      "}",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "src", "models", "user.ts"),
    [
      "export interface User {",
      "  id: string",
      "  email: string",
      "  name: string",
      "  createdAt: string",
      "}",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "sample", version: "1.0.0", dependencies: { express: "^4.0.0" } }, null, 2),
  )
}

describe("target backlog export", () => {
  let dir: string
  let targetDir: string

  beforeEach(() => {
    resetWorkflowState()
    dir = mkdtempSync(join(tmpdir(), "sdd-export-source-"))
    targetDir = mkdtempSync(join(tmpdir(), "sdd-export-target-"))
    seedProject(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(targetDir, { recursive: true, force: true })
  })

  async function scan(): Promise<void> {
    const tools = createSddTools()
    const tool = tools["sdd.reverse_engineer"] as any
    const output = (await tool.execute(
      { purpose: "reverse_engineering", depth: "full" },
      { directory: dir, sessionID: "export-scan" },
    )) as string
    expect(output).toContain("Graph Updated")
  }

  test("exports a target backlog into a fresh project with the chosen stack", async () => {
    await scan()
    const sourceRepo = createRepository(dir)
    const sourceGraph = sourceRepo.loadGraph()
    expect(sourceGraph.metadata.purpose).toBe("reverse_engineering")

    const tools = createSddTools()
    const tool = tools["sdd.integrate_tasks"] as any
    const output = (await tool.execute(
      {
        action: "export_target",
        target_dir: targetDir,
        project_name: "Target App",
        tech_stack: JSON.stringify({ backend: "NestJS", database: "PostgreSQL" }),
      },
      { directory: dir, sessionID: "export-run" },
    )) as string

    expect(output).toContain("Target backlog exported")
    expect(output).toContain("target-app")

    const targetRepo = createRepository(targetDir)
    expect(targetRepo.isInitialized()).toBe(true)
    const graph = targetRepo.loadGraph()

    expect(graph.metadata.purpose).toBe("greenfield")
    expect(graph.metadata.source_project).toBe(sourceGraph.project_id)
    expect((graph.metadata as any).tech_stack).toEqual({ backend: "NestJS", database: "PostgreSQL" })
    expect(getProjectLifecycle(graph).phase).toBe("delivery")

    const project = graph.nodes.find((node) => node.type === "project")
    expect((project?.metadata as any).tech_stack).toEqual({ backend: "NestJS", database: "PostgreSQL" })

    const tasks = graph.nodes.filter((node) => node.type === "task")
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every((task) => (task.metadata as any).execution_scope === "source")).toBe(true)
    expect(tasks.every((task) => (task.metadata as any).purpose === "greenfield")).toBe(true)
    expect(tasks.every((task) => !(task.metadata as any).files)).toBe(true)
    expect(tasks.every((task) => (task.metadata as any).source_task_id)).toBe(true)
    for (const task of tasks) {
      expect(existsSync(join(targetDir, ".sdd", "tasks", task.id, "README.md"))).toBe(true)
    }

    expect(graph.nodes.some((node) => node.type === "finding")).toBe(false)
    expect(graph.relationships.some((relationship) => relationship.type === "implements")).toBe(true)
    expect(existsSync(join(targetDir, "TARGET_BACKLOG.md"))).toBe(true)

    // Export is a copy: the source still holds its target-scoped backlog.
    expect(
      sourceRepo.loadGraph().nodes.some(
        (node) => node.type === "task" && (node.metadata as any).execution_scope === "target",
      ),
    ).toBe(true)
  })

  test("requires an explicit stack before creating the target project", async () => {
    await scan()
    const tools = createSddTools()
    const tool = tools["sdd.integrate_tasks"] as any
    const output = (await tool.execute(
      { action: "export_target", target_dir: targetDir, project_name: "No Stack" },
      { directory: dir, sessionID: "export-no-stack" },
    )) as string

    expect(output).toContain("tech_stack")
    expect(existsSync(join(targetDir, ".sdd"))).toBe(false)
  })

  test("dry_run previews the export without writing the target project", async () => {
    await scan()
    const tools = createSddTools()
    const tool = tools["sdd.integrate_tasks"] as any
    const output = (await tool.execute(
      {
        action: "export_target",
        target_dir: targetDir,
        project_name: "Preview App",
        tech_stack: JSON.stringify({ backend: "NestJS", database: "PostgreSQL" }),
        dry_run: true,
      },
      { directory: dir, sessionID: "export-dry-run" },
    )) as string

    expect(output).toContain("preview (dry run)")
    expect(output).toContain("none — this is a preview")
    expect(output).toContain("### Nodes by type")
    expect(output).toContain("### Tasks that would be exported")
    expect(existsSync(join(targetDir, ".sdd"))).toBe(false)
    expect(existsSync(join(targetDir, "TARGET_BACKLOG.md"))).toBe(false)
  })

  test("/sdd export previews and exports the backlog without calling the tool", async () => {
    await scan()
    const stack = "backend=NestJS,database=PostgreSQL"
    const dry = runSddCommand(
      dir,
      `sdd export ${targetDir} --stack ${stack} --name TargetApp --dry-run`,
      "export-cli-dry",
    )
    expect(dry.matched).toBe(true)
    expect(dry.text).toContain("preview (dry run)")
    expect(dry.text).toContain("TargetApp")
    expect(existsSync(join(targetDir, ".sdd"))).toBe(false)

    const real = runSddCommand(
      dir,
      `sdd export ${targetDir} --stack ${stack} --name TargetApp`,
      "export-cli-real",
    )
    expect(real.matched).toBe(true)
    expect(real.text).toContain("Target backlog exported")

    const graph = createRepository(targetDir).loadGraph()
    expect(graph.metadata.purpose).toBe("greenfield")
    expect((graph.metadata as any).tech_stack).toEqual({ backend: "NestJS", database: "PostgreSQL" })
    expect(existsSync(join(targetDir, "TARGET_BACKLOG.md"))).toBe(true)
  })
})
