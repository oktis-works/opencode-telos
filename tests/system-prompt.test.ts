import { describe, expect, test } from "bun:test"
import { SDD_SYSTEM_PROMPT } from "../src/opencode/system-prompt.js"

describe("SDD system prompt — deterministic command confirmations", () => {
  test("tells the agent not to repeat an already executed /sdd command", () => {
    expect(SDD_SYSTEM_PROMPT).toContain("executed by the plugin before the model sees them")
    expect(SDD_SYSTEM_PROMPT).toContain("Do not\nrepeat their confirmation")
    expect(SDD_SYSTEM_PROMPT).toContain("call tools to verify a command\nthat already ran")
  })
})
