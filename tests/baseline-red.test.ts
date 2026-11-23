import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { KANBAN_SCRIPT } from "../src/server/ui/kanban-view.js"
import { SddDashboardServer } from "../src/server/server.js"
import { createRepository } from "../src/sdd/persistence/repository.js"
import { runSddCommand } from "../src/opencode/command.js"

/**
 * Regression baseline for the pre-fix commit (`a3f27b1`).
 *
 * These assertions describe behavior that did NOT exist before the UI
 * correction. Running this file against that commit produces failures; running
 * it against the fixed tree must pass. Keeping them separate makes the red-first
 * baseline explicit instead of hiding it inside the larger integration suite.
 */
describe("UI correction baseline (red before a3f27b1 fixes)", () => {
  test("the Kanban owns task state instead of reusing the graph payload", () => {
    expect(KANBAN_SCRIPT).toContain("var allTasks = []")
    expect(KANBAN_SCRIPT).not.toContain("allLinks")
  })

  test("task search, link filters and date sorting use the complete task contract", () => {
    expect(KANBAN_SCRIPT).toContain('raw.search !== "all"')
    expect(KANBAN_SCRIPT).toContain("task.links")
    expect(KANBAN_SCRIPT).not.toContain("r.source")
    expect(KANBAN_SCRIPT).toContain("compareText(a.created_at")
    expect(KANBAN_SCRIPT).toContain("compareText(a.updated_at")
  })

  test("deterministic commands expose a short inline result", () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-inline-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
    const result = runSddCommand(dir, "sdd status")
    expect(result.matched).toBe(true)
    expect(typeof result.inline).toBe("string")
    expect(result.inline.length).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("the dashboard serves the graph asset locally and has no CDN reference", async () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-asset-"))
    const repo = createRepository(dir)
    repo.createProject("baseline", "Baseline", "", "greenfield")
    const server = new SddDashboardServer(dir)
    try {
      const port = server.start(0)
      const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
      expect(html).toContain("/ui/3d-force-graph.min.js")
      expect(html).not.toContain("unpkg.com")
    } finally {
      server.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
