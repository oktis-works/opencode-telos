import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  runSddCommand,
  extractSddCommandText,
  renderSddCommandMessage,
} from "../src/opencode/command.js"
import { annotateToolDefinition } from "../src/opencode/sdd-runtime.js"
import { createRepository } from "../src/sdd/persistence/repository.js"
import { createTask } from "../src/sdd/tasks/board.js"

describe("extractSddCommandText", () => {
  test("detects raw command forms", () => {
    expect(extractSddCommandText("/sdd on")).toBe("sdd on")
    expect(extractSddCommandText("sdd on")).toBe("sdd on")
    expect(extractSddCommandText("sdd status")).toBe("sdd status")
    expect(extractSddCommandText("sdd cache_reset")).toBe("sdd cache_reset")
    expect(extractSddCommandText("sdd cache reset")).toBe("sdd cache reset")
    expect(extractSddCommandText("sdd:off")).toBe("sdd:off")
    expect(extractSddCommandText("/sdd-on")).toBe("sdd-on")
    expect(extractSddCommandText("sdd")).toBe("sdd")
  })

  test("rejects ordinary prose that merely mentions sdd", () => {
    expect(extractSddCommandText("what does /sdd on mean?")).toBeUndefined()
    expect(extractSddCommandText("sdd is great")).toBeUndefined()
    expect(extractSddCommandText("please run sdd on across the cluster")).toBeUndefined()
    expect(extractSddCommandText("")).toBeUndefined()
  })
})

describe("runSddCommand", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-command-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("non-sdd input is not matched", () => {
    const result = runSddCommand(dir, "hello world")
    expect(result.matched).toBe(false)
  })

  test("unknown subcommand is not matched, so it reaches the model", () => {
    const result = runSddCommand(dir, "sdd frobnicate")
    expect(result.matched).toBe(false)
    expect(result.text).toBe("")
  })

  test("on writes the toggle and reports enabled inline", () => {
    const result = runSddCommand(dir, "sdd on")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("enabled")
    expect(result.inline).toContain("enabled")
    expect(result.inline).toContain("approved task")
    expect(result.inline).not.toContain("Toggle written")
    expect(result.inline).not.toContain("\n")
    const state = JSON.parse(readFileSync(join(dir, ".sdd", "enabled"), "utf-8"))
    expect(state.enabled).toBe(true)
  })

  test("off writes the toggle and reports disabled inline", () => {
    const result = runSddCommand(dir, "sdd off")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("disabled")
    expect(result.inline).toContain("disabled")
    expect(result.inline).toContain("/sdd on")
    expect(result.inline).not.toContain("Toggle written")
    const state = JSON.parse(readFileSync(join(dir, ".sdd", "enabled"), "utf-8"))
    expect(state.enabled).toBe(false)
  })

  test("status reports current toggle", () => {
    const result = runSddCommand(dir, "sdd status")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("Status")
    expect(result.inline).toContain("SDD enforcement")
    expect(result.inline.split("\n")).toHaveLength(1)
  })

  test("every known subcommand has a non-empty inline result", () => {
    for (const raw of ["sdd", "sdd on", "sdd off", "sdd status", "sdd cache_reset", "sdd tasks", "sdd export", "sdd acceptance", "sdd guide", "sdd viz status"]) {
      const result = runSddCommand(dir, raw, "ses_inline")
      expect(result.matched, raw).toBe(true)
      expect(result.inline.length, raw).toBeGreaterThan(0)
    }
  })

  test("panel renders static help", () => {
    const result = runSddCommand(dir, "sdd")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("Command Panel")
  })
})

describe("/sdd tasks inline confirmations", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-tasks-inline-"))
    const repo = createRepository(dir)
    repo.createProject("inline-test", "Inline Test", "", "greenfield")
    const graph = repo.loadGraph()
    createTask(graph, { name: "Approve me", files: ["src/approve.ts"] })
    createTask(graph, { name: "Reject me", files: ["src/reject.ts"] })
    repo.saveGraph(graph)
  })

  test("approve returns a short consequence without truncating the report", () => {
    const result = runSddCommand(dir, "sdd tasks approve inline-test-TASK-001")
    expect(result.matched).toBe(true)
    expect(result.inline).toContain("TASK-001")
    expect(result.inline).toContain("approved")
    expect(result.inline).toContain("writable")
    expect(result.inline).not.toContain("Dossier")
    expect(result.text).toContain("Dossier")
  })

  test("reject returns the task ID and the blocked consequence", () => {
    const result = runSddCommand(dir, "sdd tasks reject inline-test-TASK-002")
    expect(result.matched).toBe(true)
    expect(result.inline).toContain("TASK-002")
    expect(result.inline).toContain("rejected")
    expect(result.inline).toContain("blocked")
    expect(result.text).toContain("Dossier")
  })
})

describe("renderSddCommandMessage", () => {
  let dir: string
  let messageID: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-render-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
    messageID = `msg-${Math.random().toString(36).slice(2)}-${dir.split("-").pop()}`
  })

  test("returns the full deterministic result, not only the inline summary", () => {
    const text = renderSddCommandMessage(dir, "sdd on", messageID)
    expect(text).toContain("enabled")
    expect(text).toContain("Toggle written")
  })

  test("caches per message id and does not re-execute side effects", () => {
    const first = renderSddCommandMessage(dir, "sdd on", messageID)
    const fileAfterFirst = readFileSync(join(dir, ".sdd", "enabled"), "utf-8")

    const second = renderSddCommandMessage(dir, "sdd on", messageID)
    expect(second).toBe(first)

    const fileAfterSecond = readFileSync(join(dir, ".sdd", "enabled"), "utf-8")
    expect(fileAfterSecond).toBe(fileAfterFirst)
  })

  test("different message ids re-execute", () => {
    const first = renderSddCommandMessage(dir, "sdd on", "msg-a")
    const second = renderSddCommandMessage(dir, "sdd on", "msg-b")
    expect(first).toContain("enabled")
    expect(second).toContain("enabled")
  })
})
describe("retired /sdd tool-names command", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "telos-retired-cmd-"))
  })

  test("is no longer a recognized subcommand", () => {
    for (const raw of ["sdd tool-names", "sdd tool-names safe", "sdd tool_names canonical"]) {
      const result = runSddCommand(dir, raw, "ses_test")
      expect(result.matched, raw).toBe(false)
      expect(result.text, raw).toBe("")
    }
  })

  test("is not advertised by the panel or the status footer", () => {
    for (const raw of ["sdd", "sdd help", "sdd status"]) {
      const result = runSddCommand(dir, raw, "ses_test")
      expect(result.text, raw).not.toContain("tool-names")
    }
  })
})

describe("/sdd grammar is derived from one table", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-grammar-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  // Every subcommand the hub advertises must behave identically through both
  // entry points: the TUI command and the plain-text admission check. This is
  // the invariant that used to break, because the dispatcher and the regex were
  // two hand-written copies of the same grammar.
  const KNOWN = [
    "sdd", "sdd panel", "sdd help", "sdd on", "sdd enable", "sdd off", "sdd disable",
    "sdd status", "sdd renew", "sdd cache_reset", "sdd cache reset", "sdd cachereset",
    "sdd tasks", "sdd tasks board", "sdd tasks integrate", "sdd tasks change TASK-1",
    "sdd export ../target-app", "sdd export ../target-app --dry-run",
    "sdd acceptance", "sdd acceptance REQ-1", "sdd guide NODE-1 do the thing",
    "sdd viz", "sdd viz stop", "sdd viz status",
  ] as const

  test("both entry points agree on every known subcommand", () => {
    for (const raw of KNOWN) {
      const asCommand = runSddCommand(dir, raw, "ses_t").matched
      const asText = extractSddCommandText(raw) !== undefined
      expect(asCommand, `dispatch: ${raw}`).toBe(true)
      expect(asText, `text admission: ${raw}`).toBe(true)
    }
  })

  test("both entry points reject what is not a subcommand", () => {
    for (const raw of [
      "sdd bogus", "sdd tool-names", "sdd tool-names safe", "sdd on extra", "sdd frobnicate",
    ]) {
      const asCommand = runSddCommand(dir, raw, "ses_t").matched
      const asText = extractSddCommandText(raw) !== undefined
      expect(asCommand, `dispatch: ${raw}`).toBe(false)
      expect(asText, `text admission: ${raw}`).toBe(false)
    }
  })

  test("ordinary prose is still never treated as a command", () => {
    for (const prose of [
      "what does /sdd on mean?", "sdd is great", "please run sdd on across the cluster",
      "the sdd workflow requires a change", "",
    ]) {
      expect(extractSddCommandText(prose), prose).toBeUndefined()
    }
  })

  test("the advertised list is exactly the dispatchable list", () => {
    const panel = runSddCommand(dir, "sdd", "ses_t").text
    const status = runSddCommand(dir, "sdd status", "ses_t").text
    for (const alias of [
      "on", "off", "status", "renew", "tasks", "export", "acceptance", "guide", "viz", "cache_reset", "panel",
    ]) {
      expect(panel, `panel: ${alias}`).toContain(`\`sdd ${alias}\``)
      expect(status, `status footer: ${alias}`).toContain(`\`/sdd ${alias}\``)
      // and it is real, not just advertised
      expect(runSddCommand(dir, `sdd ${alias}`, "ses_t").matched, `dispatch: ${alias}`).toBe(true)
    }
  })

  test("the terminal tool annotation does not leak V1-only surfaces", () => {
    // The `sdd`/`sdd-panel` annotation belonged to the V1 command hub and was
    // removed; the only annotated host tool is the terminal tool.
    for (const toolId of ["sdd", "sdd-panel"]) {
      expect(annotateToolDefinition(toolId, undefined)).toBeUndefined()
    }
    const terminal = annotateToolDefinition("run_terminal_command", "Runs commands.") ?? ""
    expect(terminal).toContain("SDD ENFORCEMENT")
  })
})
