import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRepository, type GraphRepository } from "../sdd/persistence/repository.js"
import { getGraphStats, getNode } from "../sdd/graph/engine.js"
import { computeImpact } from "../sdd/graph/traverse.js"
import { analyzeNodeImpact } from "../sdd/impact/service.js"
import { validateGraph } from "../sdd/validation/validator.js"
import { detectDrift } from "../sdd/drift/detector.js"
import { getPendingChanges } from "../sdd/changes/manager.js"
import { progressEmitter, type ProgressEvent } from "./events.js"
import { KANBAN_MODAL_HTML, KANBAN_SCRIPT, KANBAN_STYLE } from "./ui/kanban-view.js"
import {
  handleCreateTask,
  handleDeleteTask,
  handleIntegrateTask,
  handleListTasks,
  handleMarkIntegrated,
  handleOpenChange,
  handleTaskApproval,
  handleUpdateTask,
} from "./tasks-api.js"
import type { SqliteGraphRepository } from "../sdd/persistence/sqlite.js"
import type { NodeType } from "../sdd/domain/types.js"
import { readExecutionRecords } from "../sdd/execution/ledger.js"
import {
  handleAcceptAll,
  handleAcceptanceMigration,
  handleAcceptanceMutation,
  handleGuidance,
  handleImpact,
  handleListGuidance,
  handleListAcceptance,
  handleFinalAcceptance,
} from "./acceptance-api.js"

type DashboardSqliteAdapter = Partial<Pick<SqliteGraphRepository,
  | "getGraphCounts" | "getUpdatedAt" | "getAllNodesSummary" | "getAllRelationshipsSummary"
  | "getRelationshipsSummary" | "getNodesSummary" | "getNodeTypeCounts" | "getNodesByType"
  | "getNodeById" | "getRelationshipsForNode"
>>

export interface DashboardEvent {
  type: string
  timestamp: string
  data: unknown
}

/** Preferred dashboard port (stable across sessions). Override via SDD_DASHBOARD_PORT. */
export const DEFAULT_DASHBOARD_PORT = 7331

/** User-configured port, if any. */
export function resolveDashboardPort(): number {
  const raw = process.env.SDD_DASHBOARD_PORT
  if (!raw) return DEFAULT_DASHBOARD_PORT
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : DEFAULT_DASHBOARD_PORT
}

export class SddDashboardServer {
  private repo: GraphRepository
  private projectDir: string
  private port: number = 0
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.repo = createRepository(projectDir)
  }

  /**
   * Sobe o servidor de dashboard.
   *
   * @param preferredPort - porta desejada. Se estiver ocupada, cai para uma
   *   an ephemeral port instead of failing; the returned port is authoritative.
   * @returns the port the server is listening on
   */
  start(preferredPort: number = 0): number {
    if (!this.repo.isInitialized()) {
      throw new Error("SDD not initialized")
    }

    const options = {
      hostname: "127.0.0.1" as const,
      fetch: async (req: Request) => {
        const url = new URL(req.url)
        return this.handleRequest(url, req)
      },
    }

    let server: ReturnType<typeof Bun.serve>
    try {
      server = Bun.serve({ ...options, port: preferredPort })
    } catch (error) {
      // Bun can report EADDRINUSE for port 0 when several test/runtime
      // instances request an ephemeral listener concurrently. Retry with
      // explicit high ports so dashboard instances remain isolated.
      let lastError: unknown = error
      let started: ReturnType<typeof Bun.serve> | undefined
      for (let attempt = 0; attempt < 12 && !started; attempt++) {
        const fallbackPort = 30000 + Math.floor(Math.random() * 20000)
        try {
          started = Bun.serve({ ...options, port: fallbackPort })
        } catch (fallbackError) {
          lastError = fallbackError
        }
      }
      if (!started) throw lastError
      server = started
    }

    this.server = server
    this.port = server.port ?? 0
    return this.port
  }

  /** Encerra o servidor, se estiver rodando. */
  stop(): void {
    if (!this.server) return
    this.server.stop(true)
    this.server = null
    this.port = 0
  }

  isRunning(): boolean {
    return this.server !== null
  }

  getProjectDir(): string {
    return this.projectDir
  }

  getPort(): number {
    return this.port
  }

  getUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private async handleRequest(url: URL, req: Request): Promise<Response> {
    const origin = req.headers.get("origin")
    const allowedOrigins = new Set([`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`])
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
    if (origin && allowedOrigins.has(origin)) {
      corsHeaders["Access-Control-Allow-Origin"] = origin
      corsHeaders["Vary"] = "Origin"
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Mutating routes reject cross-origin requests (CSRF) and non-loopback
    // Host headers (DNS rebinding). The dashboard is local-only by design.
    if (req.method !== "GET" && req.method !== "HEAD") {
      const host = (req.headers.get("host") || "").split(":")[0]
      if (host !== "127.0.0.1" && host !== "localhost") {
        return this.jsonResponse({ error: "Forbidden host" }, corsHeaders, 403)
      }
      if (origin && !allowedOrigins.has(origin)) {
        return this.jsonResponse({ error: "Forbidden origin" }, corsHeaders, 403)
      }
    }

    try {
      const path = url.pathname

      if (path === "/api/health") {
        return this.jsonResponse({ status: "ok", timestamp: new Date().toISOString() }, corsHeaders)
      }

      if (path === "/api/project") {
        return this.jsonResponse(this.getProjectInfo(), corsHeaders)
      }

      if (path === "/api/graph") {
        return this.jsonResponse(this.getGraphData(), corsHeaders)
      }

      if (path === "/api/graph/counts") {
        return this.jsonResponse(this.getGraphCounts(), corsHeaders)
      }

      if (path === "/api/graph/summary") {
        const offset = parseInt(url.searchParams.get("offset") || "0")
        const limit = parseInt(url.searchParams.get("limit") || "500")
        const type = url.searchParams.get("type") || undefined
        return this.jsonResponse(this.getGraphSummary(offset, limit, type), corsHeaders)
      }

      if (path === "/api/graph/relationships") {
        const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0)
        const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get("limit") || "2000", 10) || 2000))
        return this.jsonResponse(this.getGraphRelationships(offset, limit), corsHeaders)
      }

      if (path === "/api/graph/types") {
        return this.jsonResponse(this.getNodeTypeCounts(), corsHeaders)
      }

      if (path === "/api/nodes") {
        const type = url.searchParams.get("type")
        return this.jsonResponse(this.getNodes(type), corsHeaders)
      }

      if (path.startsWith("/api/nodes/") && path.endsWith("/relationships")) {
        const nodeId = path.split("/")[3]
        return this.jsonResponse(this.getNodeRelationships(nodeId), corsHeaders)
      }

      if (path.startsWith("/api/nodes/") && path.endsWith("/impact")) {
        const nodeId = path.split("/")[3]
        const depth = parseInt(url.searchParams.get("depth") || "3")
        return this.jsonResponse(this.getNodeImpact(nodeId, depth), corsHeaders)
      }

      if (path.startsWith("/api/nodes/")) {
        const nodeId = path.split("/")[3]
        return this.jsonResponse(this.getNodeDetail(nodeId), corsHeaders)
      }

      if (path === "/api/status") {
        return this.jsonResponse(this.getStatus(), corsHeaders)
      }

      if (path === "/api/validation") {
        return this.jsonResponse(this.getValidation(), corsHeaders)
      }

      if (path === "/api/drift") {
        return this.jsonResponse(this.getDrift(), corsHeaders)
      }

      if (path === "/api/changes") {
        return this.jsonResponse(this.getChanges(), corsHeaders)
      }

      if (path === "/api/executions") {
        const runId = url.searchParams.get("run_id") || undefined
        const callId = url.searchParams.get("call_id") || undefined
        const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "100", 10) || 100))
        const records = readExecutionRecords(this.projectDir)
          .filter((record) => (!runId || record.runId === runId) && (!callId || record.callId === callId))
          .slice(-limit)
        return this.jsonResponse({ records }, corsHeaders)
      }

      // ── Acceptance and human guidance ─────────────────────────────
      if (path === "/api/acceptance" && req.method === "GET") {
        const result = handleListAcceptance(this.projectDir, url.searchParams.get("requirement_id") || undefined)
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path === "/api/acceptance/migrate" && req.method === "POST") {
        const result = handleAcceptanceMigration(this.projectDir, (await this.readJsonBody(req)) ?? {})
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path === "/api/acceptance/accept-all" && req.method === "POST") {
        const requirementId = url.searchParams.get("requirement_id")
        if (!requirementId) return this.jsonResponse({ error: "requirement_id is required" }, corsHeaders, 400)
        const result = handleAcceptAll(this.projectDir, requirementId, (await this.readJsonBody(req)) ?? {})
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path.startsWith("/api/acceptance/final/") && req.method === "POST") {
        const rest = path.slice("/api/acceptance/final/".length).split("/")
        const changeId = decodeURIComponent(rest[0] || "")
        const action = rest[1] === "reject" ? "REJECTED" : rest[1] === "accept" ? "ACCEPTED" : undefined
        if (!changeId || !action) return this.jsonResponse({ error: "Change id and final action are required" }, corsHeaders, 400)
        const result = handleFinalAcceptance(this.projectDir, changeId, action, (await this.readJsonBody(req)) ?? {})
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path.startsWith("/api/acceptance/")) {
        const rest = path.slice("/api/acceptance/".length).split("/")
        const criterionId = decodeURIComponent(rest[0] || "")
        const action = rest[1] as "accept" | "reject" | "waive" | "reopen" | "update_text" | undefined
        if (!criterionId || !action || req.method !== "POST") return this.jsonResponse({ error: "Criterion id and action are required" }, corsHeaders, 400)
        const result = handleAcceptanceMutation(this.projectDir, criterionId, action, (await this.readJsonBody(req)) ?? {})
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path.startsWith("/api/impact/")) {
        const nodeId = decodeURIComponent(path.slice("/api/impact/".length))
        const result = handleImpact(this.projectDir, nodeId, Number.parseInt(url.searchParams.get("depth") || "5", 10) || 5)
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path === "/api/guidance" && req.method === "POST") {
        const body = (await this.readJsonBody(req)) as Record<string, unknown> | undefined
        const targetId = typeof body?.target_node_id === "string" ? body.target_node_id : ""
        if (!targetId) return this.jsonResponse({ error: "target_node_id is required" }, corsHeaders, 400)
        const result = handleGuidance(this.projectDir, "create", targetId, body)
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path === "/api/guidance" && req.method === "GET") {
        const result = handleListGuidance(this.projectDir, url.searchParams.get("target_node_id") || undefined)
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }
      if (path.startsWith("/api/guidance/")) {
        const rest = path.slice("/api/guidance/".length).split("/")
        const guidanceId = decodeURIComponent(rest[0] || "")
        const action = rest[1] as "analyze" | "propose" | "apply" | "reject" | undefined
        if (!guidanceId || !action || req.method !== "POST") return this.jsonResponse({ error: "Guidance id and action are required" }, corsHeaders, 400)
        const result = handleGuidance(this.projectDir, action, guidanceId, (await this.readJsonBody(req)) ?? {})
        return this.jsonResponse(result.body, corsHeaders, result.status)
      }

      // ── Kanban tasks ─────────────────────────────────────────────
      if (path === "/api/tasks") {
        if (req.method === "GET") {
          const params: Record<string, string> = {}
          url.searchParams.forEach((v, k) => { params[k] = v })
          const result = handleListTasks(this.projectDir, params)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        if (req.method === "POST") {
          const body = await this.readJsonBody(req)
          if (body === undefined) {
            return this.jsonResponse({ error: "Invalid JSON body" }, corsHeaders, 400)
          }
          const result = handleCreateTask(this.projectDir, body)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        return this.jsonResponse({ error: "Method not allowed" }, corsHeaders, 405)
      }

      if (path.startsWith("/api/tasks/")) {
        const rest = path.slice("/api/tasks/".length)
        const [rawId, action] = rest.split("/")
        const taskId = decodeURIComponent(rawId || "")
        if (!taskId) {
          return this.jsonResponse({ error: "Task id required" }, corsHeaders, 400)
        }

        if (!action && (req.method === "POST" || req.method === "PATCH")) {
          const body = await this.readJsonBody(req)
          if (body === undefined) {
            return this.jsonResponse({ error: "Invalid JSON body" }, corsHeaders, 400)
          }
          const result = handleUpdateTask(this.projectDir, taskId, body)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        if (!action && req.method === "DELETE") {
          const result = handleDeleteTask(this.projectDir, taskId)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        if (action === "integrate" && req.method === "POST") {
          const result = handleIntegrateTask(this.projectDir, taskId)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        if (action === "change" && req.method === "POST") {
          const body = (await this.readJsonBody(req)) ?? {}
          if (typeof body !== "object" || body === null) {
            return this.jsonResponse({ error: "Invalid JSON body" }, corsHeaders, 400)
          }
          const result = handleOpenChange(this.projectDir, taskId, body)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        if (action === "integrated" && req.method === "POST") {
          const result = handleMarkIntegrated(this.projectDir, taskId)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        if ((action === "approve" || action === "reject") && req.method === "POST") {
          const body = (await this.readJsonBody(req)) ?? {}
          const result = handleTaskApproval(this.projectDir, taskId, action === "approve", body)
          return this.jsonResponse(result.body, corsHeaders, result.status)
        }
        return this.jsonResponse({ error: "Not found" }, corsHeaders, 404)
      }

      if (path === "/api/events") {
        return this.streamEvents(req)
      }

      if (path === "/api/progress") {
        return this.getProgress()
      }

      if (path === "/ui/3d-force-graph.min.js") {
        const assetPath = fileURLToPath(new URL("./ui/vendor/3d-force-graph.min.js", import.meta.url))
        if (!existsSync(assetPath)) {
          return new Response("Graph asset not found", { status: 404, headers: corsHeaders })
        }
        return new Response(readFileSync(assetPath), {
          headers: { ...corsHeaders, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
        })
      }

      if (path === "/") {
        return this.serveDashboard(corsHeaders)
      }

      if (path === "/favicon.ico") {
        return new Response(null, { status: 204, headers: corsHeaders })
      }

      return this.jsonResponse({ error: "Not found" }, corsHeaders, 404)
    } catch (error) {
      return this.jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        corsHeaders,
        500,
      )
    }
  }

  private jsonResponse(data: unknown, headers: Record<string, string> = {}, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    })
  }

  /** Parse a JSON request body. Returns undefined when the payload is invalid. */
  private async readJsonBody(req: Request): Promise<unknown | undefined> {
    try {
      const text = await req.text()
      if (!text.trim()) return {}
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  private getProjectInfo() {
    if (!this.repo.isInitialized()) return { initialized: false }
    const graph = this.repo.loadGraph()
    return {
      initialized: true,
      project_id: graph.project_id,
      version: graph.version,
      sdd_version: graph.metadata.sdd_version,
      created_at: graph.metadata.created_at,
      updated_at: graph.metadata.updated_at,
    }
  }

  private getGraphData() {
    if (!this.repo.isInitialized()) return { nodes: [], relationships: [], updated_at: "" }

    // Use optimized SQLite queries when available for large graphs
    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getGraphCounts && sqliteRepo.getUpdatedAt && sqliteRepo.getAllNodesSummary && sqliteRepo.getAllRelationshipsSummary && sqliteRepo.getNodesSummary && sqliteRepo.getRelationshipsSummary) {
      const counts = sqliteRepo.getGraphCounts()
      const updatedAt = sqliteRepo.getUpdatedAt()

      // For graphs under 2000 nodes, send all data at once
      if (counts.nodeCount <= 2000) {
        const nodes = sqliteRepo.getAllNodesSummary()
        const rels = sqliteRepo.getAllRelationshipsSummary()
        return { nodes, relationships: rels, updated_at: updatedAt, nodeCount: counts.nodeCount, relCount: counts.relCount }
      }

      // For larger graphs, send all nodes summary (lightweight) but only first 2000 relationships
      const nodes = sqliteRepo.getAllNodesSummary()
      const relsResult = sqliteRepo.getRelationshipsSummary(0, 2000)
      return {
        nodes,
        relationships: relsResult.relationships,
        updated_at: updatedAt,
        nodeCount: counts.nodeCount,
        relCount: relsResult.total,
        hasMoreRelationships: relsResult.total > 2000,
      }
    }

    // Fallback for YAML
    const graph = this.repo.loadGraph()
    return {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        status: n.status,
        version: n.version,
      })),
      relationships: graph.relationships.map((r) => ({
        id: r.id,
        from: r.from,
        to: r.to,
        type: r.type,
      })),
      updated_at: graph.metadata.updated_at,
    }
  }

  private getGraphCounts() {
    if (!this.repo.isInitialized()) return { nodeCount: 0, relCount: 0, updated_at: "" }

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getGraphCounts && sqliteRepo.getUpdatedAt) {
      const counts = sqliteRepo.getGraphCounts()
      const updatedAt = sqliteRepo.getUpdatedAt()
      return { ...counts, updated_at: updatedAt }
    }

    const graph = this.repo.loadGraph()
    return {
      nodeCount: graph.nodes.length,
      relCount: graph.relationships.length,
      updated_at: graph.metadata.updated_at,
    }
  }

  private getGraphSummary(offset: number, limit: number, type?: string) {
    if (!this.repo.isInitialized()) return { nodes: [], relationships: [], total: 0 }

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getNodesSummary) {
      const nodesResult = sqliteRepo.getNodesSummary(offset, limit, type)
      return {
        nodes: nodesResult.nodes,
        total: nodesResult.total,
        offset,
        limit,
        hasMore: offset + limit < nodesResult.total,
      }
    }

    // Fallback for YAML — load full graph and slice
    const graph = this.repo.loadGraph()
    let nodes = graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      status: n.status,
      version: n.version,
    }))
    if (type) nodes = nodes.filter((n) => n.type === type)
    return {
      nodes: nodes.slice(offset, offset + limit),
      total: nodes.length,
      offset,
      limit,
      hasMore: offset + limit < nodes.length,
    }
  }

  private getGraphRelationships(offset: number, limit: number) {
    if (!this.repo.isInitialized()) return { relationships: [], total: 0, offset, limit, hasMore: false }

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getRelationshipsSummary) {
      const result = sqliteRepo.getRelationshipsSummary(offset, limit)
      return {
        relationships: result.relationships,
        total: result.total,
        offset,
        limit,
        hasMore: offset + limit < result.total,
      }
    }

    const relationships = this.repo.loadGraph().relationships.map((r) => ({
      id: r.id,
      from: r.from,
      to: r.to,
      type: r.type,
    }))
    return {
      relationships: relationships.slice(offset, offset + limit),
      total: relationships.length,
      offset,
      limit,
      hasMore: offset + limit < relationships.length,
    }
  }

  private getNodeTypeCounts() {
    if (!this.repo.isInitialized()) return []

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getNodeTypeCounts) {
      return sqliteRepo.getNodeTypeCounts()
    }

    const graph = this.repo.loadGraph()
    const counts: Record<string, number> = {}
    for (const n of graph.nodes) {
      counts[n.type] = (counts[n.type] || 0) + 1
    }
    return Object.entries(counts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
  }

  private getNodes(type?: string | null) {
    if (!this.repo.isInitialized()) return []

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (type && sqliteRepo.getNodesByType) {
      return sqliteRepo.getNodesByType(type as NodeType)
    }

    const graph = this.repo.loadGraph()
    if (type) {
      return graph.nodes.filter((n) => n.type === type)
    }
    return graph.nodes
  }

  private getNodeDetail(nodeId: string) {
    if (!this.repo.isInitialized()) return { error: "Not initialized" }

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getNodeById) {
      const node = sqliteRepo.getNodeById(nodeId)
      return node || { error: "Node not found" }
    }

    const graph = this.repo.loadGraph()
    const node = getNode(graph, nodeId)
    if (!node) return { error: "Node not found" }
    return node
  }

  private getNodeRelationships(nodeId: string) {
    if (!this.repo.isInitialized()) return []

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getRelationshipsForNode) {
      return sqliteRepo.getRelationshipsForNode(nodeId)
    }

    const graph = this.repo.loadGraph()
    return graph.relationships.filter(
      (r) => r.from === nodeId || r.to === nodeId,
    )
  }

  private getNodeImpact(nodeId: string, depth: number) {
    if (!this.repo.isInitialized()) return { error: "Not initialized" }
    const graph = this.repo.loadGraph()
    return { ...computeImpact(graph, nodeId, depth), semantic: analyzeNodeImpact(graph, nodeId, depth) }
  }

  private getStatus() {
    if (!this.repo.isInitialized()) return { initialized: false }
    const graph = this.repo.loadGraph()
    const stats = getGraphStats(graph)
    const pending = getPendingChanges(graph)
    const validation = validateGraph(graph, undefined, this.projectDir)
    return {
      initialized: true,
      stats,
      pending_changes: pending.length,
      validation_errors: validation.errors.length,
      validation_warnings: validation.warnings.length,
    }
  }

  private getValidation() {
    if (!this.repo.isInitialized()) return { error: "Not initialized" }
    const graph = this.repo.loadGraph()
    return validateGraph(graph, undefined, this.projectDir)
  }

  private getDrift() {
    if (!this.repo.isInitialized()) return { error: "Not initialized" }
    const graph = this.repo.loadGraph()
    return detectDrift(graph, this.projectDir)
  }

  private getChanges() {
    if (!this.repo.isInitialized()) return []

    const sqliteRepo = this.repo as unknown as DashboardSqliteAdapter
    if (sqliteRepo.getNodesByType) {
      return sqliteRepo.getNodesByType("change" as NodeType)
    }

    const graph = this.repo.loadGraph()
    return graph.nodes
      .filter((n) => n.type === "change")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }

  private streamEvents(_req: Request): Response {
    let unsubscribe: (() => void) | null = null

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        const send = (event: DashboardEvent | ProgressEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            // Stream might be closed
          }
        }

        // Send initial connection event
        send({ type: "connected", timestamp: new Date().toISOString(), data: {} })

        // Send current build status if any
        const currentBuild = progressEmitter.getCurrentBuild()
        if (currentBuild) {
          send({
            type: "build_status",
            timestamp: new Date().toISOString(),
            data: currentBuild,
          })
        }

        // Subscribe to progress events
        unsubscribe = progressEmitter.on((event) => {
          send(event)
        })

        // Send heartbeat every 30 seconds to keep connection alive
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`:heartbeat\n\n`))
          } catch {
            clearInterval(heartbeat)
          }
        }, 30000)

        // Cleanup on close
        const originalCancel = stream.cancel?.bind(stream)
        stream.cancel = () => {
          clearInterval(heartbeat)
          if (unsubscribe) unsubscribe()
          return originalCancel?.() ?? Promise.resolve()
        }
      },
      cancel() {
        if (unsubscribe) unsubscribe()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": `http://127.0.0.1:${this.port}`,
      },
    })
  }

  private getProgress(): Response {
    const currentBuild = progressEmitter.getCurrentBuild()
    return new Response(
      JSON.stringify({
        building: progressEmitter.isBuilding(),
        currentBuild,
        subscribers: progressEmitter.getSubscriberCount(),
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  private serveDashboard(headers: Record<string, string>): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SDD Knowledge Graph Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; }
    .container { display: grid; grid-template-columns: 280px 1fr 320px; height: 100%; min-height: 0; }
    .sidebar { background: #161b22; border-right: 1px solid #30363d; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; }
    .main { position: relative; overflow: hidden; }
    .details { background: #161b22; border-left: 1px solid #30363d; padding: 16px; overflow-y: auto; }
    h1 { font-size: 18px; margin-bottom: 16px; color: #58a6ff; }
    h2 { font-size: 14px; margin-bottom: 8px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; }
    .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #21262d; }
    .stat-label { color: #8b949e; }
    .stat-value { font-weight: 600; }
    .node-list { list-style: none; flex: 1; overflow-y: auto; }
    .node-item { padding: 8px 12px; margin: 2px 0; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
    .node-item:hover { background: #21262d; }
    .node-item.selected { background: #1f6feb33; border-left: 3px solid #58a6ff; }
    .node-item:focus-visible { outline: 2px solid #58a6ff; outline-offset: -2px; }
    .node-id { font-size: 11px; color: #8b949e; }
    .node-name { font-size: 13px; font-weight: 500; }
    .node-status { font-size: 10px; padding: 2px 6px; border-radius: 10px; margin-left: 8px; }
    .status-DRAFT { background: #30363d; color: #8b949e; }
    .status-APPROVED { background: #238636; color: #fff; }
    .status-IMPLEMENTING { background: #9e6a03; color: #fff; }
    .status-IMPLEMENTED { background: #1f6feb; color: #fff; }
    .status-BLOCKED { background: #da3633; color: #fff; }
    .filter-bar { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
    .filter-btn { padding: 4px 10px; border-radius: 12px; border: 1px solid #30363d; background: transparent; color: #c9d1d9; cursor: pointer; font-size: 11px; transition: all 0.2s; }
    .filter-btn:hover { border-color: #58a6ff; }
    .filter-btn.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
    .search { width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; margin-bottom: 12px; font-size: 13px; outline: none; }
    .search:focus { border-color: #58a6ff; }
    .detail-section { margin-bottom: 16px; }
    .detail-section h3 { font-size: 12px; color: #58a6ff; margin-bottom: 8px; }
    .detail-field { font-size: 12px; padding: 4px 0; }
    .detail-field .label { color: #8b949e; }
    .detail-link { display: block; width: 100%; border: 0; background: transparent; color: #58a6ff; text-align: left; cursor: pointer; font: inherit; font-size: 12px; padding: 4px 0; }
    .detail-link:hover, .detail-link:focus-visible { text-decoration: underline; outline: 2px solid #58a6ff; outline-offset: 2px; }
    .detail-copy { padding: 2px 8px; margin-left: 6px; font-size: 11px; }
    .detail-meta-value { color: #c9d1d9; word-break: break-word; }
    .detail-json { margin-top: 6px; }
    .detail-json summary { cursor: pointer; color: #8b949e; font-size: 11px; }
    #graph-container { width: 100%; height: 100%; }
    .graph-overlay { position: absolute; bottom: 12px; left: 12px; background: #161b22ee; border: 1px solid #30363d; border-radius: 8px; padding: 10px 14px; font-size: 11px; color: #8b949e; pointer-events: none; max-width: calc(100% - 80px); }
    .graph-overlay.error { border-color: #da3633; color: #ffb3ad; }
    .graph-controls { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; z-index: 3; }
    .graph-btn { width: 36px; height: 36px; border-radius: 6px; border: 1px solid #30363d; background: #161b22; color: #c9d1d9; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .graph-btn:hover { border-color: #58a6ff; color: #58a6ff; }
    .graph-btn.details-toggle { display: none; font-size: 12px; width: auto; padding: 0 8px; }
    .graph-error { display: none; position: absolute; inset: 50% auto auto 50%; transform: translate(-50%, -50%); z-index: 2; width: min(420px, 90vw); background: #161b22; border: 1px solid #da3633; border-radius: 10px; padding: 18px; color: #c9d1d9; text-align: center; }
    .graph-error strong { color: #f85149; display: block; margin-bottom: 6px; }
    .graph-error p { color: #8b949e; font-size: 12px; margin-bottom: 10px; word-break: break-word; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #8b949e; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
    .progress-panel { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin-bottom: 16px; display: none; }
    .progress-panel.active { display: block; }
    .progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .progress-title { font-size: 12px; font-weight: 600; color: #58a6ff; }
    .progress-percent { font-size: 11px; color: #3fb950; }
    .progress-bar-bg { height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .progress-bar { height: 100%; background: linear-gradient(90deg, #1f6feb, #3fb950); border-radius: 3px; transition: width 0.3s ease; }
    .progress-step { font-size: 11px; color: #8b949e; }
    .progress-log { max-height: 120px; overflow-y: auto; font-size: 10px; font-family: monospace; color: #8b949e; margin-top: 8px; }
    .progress-log-entry { padding: 2px 0; border-bottom: 1px solid #21262d; }
    .progress-log-entry.error { color: #f85149; }
    .progress-log-entry.complete { color: #3fb950; }
    .sse-status { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #8b949e; margin-bottom: 8px; }
    .sse-dot { width: 6px; height: 6px; border-radius: 50%; }
    .sse-dot.connected { background: #3fb950; }
    .sse-dot.disconnected { background: #f85149; }
    .large-graph-notice { background: #1c2333; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 11px; color: #d29922; display: none; }
    .modal-open { overflow: hidden; }
    @media (max-width: 1200px) {
      .container { grid-template-columns: 240px 1fr 280px; }
      .sidebar { padding: 12px; }
      .details { padding: 12px; }
    }
    @media (max-width: 900px) {
      .container { grid-template-columns: 220px 1fr; position: relative; }
      .details { position: absolute; z-index: 4; top: 0; right: 0; bottom: 0; width: min(360px, 92vw); box-shadow: -8px 0 24px #0008; display: none; }
      .details.open { display: block; }
      .graph-btn.details-toggle { display: flex; }
    }
    @media (max-width: 700px) {
      .container { grid-template-columns: 1fr; grid-template-rows: minmax(160px, 38vh) 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid #30363d; min-height: 0; }
      .sidebar h1 { display: none; }
      .main { min-height: 220px; }
      .details { width: min(360px, 100%); }
      .graph-overlay { right: 12px; bottom: 8px; }
    }
${KANBAN_STYLE}
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar" role="banner">
      <span class="brand">SDD Knowledge Graph</span>
      <nav class="tabs" role="tablist" aria-label="Dashboard views">
        <button class="tab active" id="tab-graph" data-view="graph" role="tab" aria-selected="true" aria-controls="graph-view">Graph</button>
        <button class="tab" id="tab-kanban" data-view="kanban" role="tab" aria-selected="false" aria-controls="kanban-view">Kanban</button>
      </nav>
      <span class="task-pending" id="task-pending" role="status" aria-live="polite"></span>
    </header>
    <div class="views">
  <div class="container" id="graph-view" role="tabpanel" aria-labelledby="tab-graph">
    <div class="sidebar">
      <div class="sse-status" id="sse-status">
        <span class="sse-dot disconnected" id="sse-dot"></span>
        <span id="sse-text">Disconnected</span>
      </div>
      <div class="progress-panel" id="progress-panel">
        <div class="progress-header">
          <span class="progress-title" id="progress-title">Building...</span>
          <span class="progress-percent" id="progress-percent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar" id="progress-bar" style="width: 0%"></div>
        </div>
        <div class="progress-step" id="progress-step">Initializing...</div>
        <div class="progress-log" id="progress-log"></div>
      </div>
      <input id="search" class="search" type="text" placeholder="Search nodes...">
      <div id="filters" class="filter-bar"></div>
      <div id="legend" class="legend"></div>
      <h2>Nodes (<span id="node-count">0</span>)</h2>
      <ul id="node-list" class="node-list"></ul>
    </div>
    <div class="main">
      <div id="graph-container" role="img" aria-label="3D knowledge graph. Use the node list for keyboard navigation." aria-describedby="graph-overlay"></div>
      <div class="graph-controls">
        <button class="graph-btn details-toggle" id="details-toggle" onclick="toggleDetails()" title="Toggle details" aria-label="Toggle node details">Details</button>
        <button class="graph-btn" onclick="resetView()" title="Reset view" aria-label="Reset graph view">&#x21bb;</button>
        <button class="graph-btn" onclick="zoomIn()" title="Zoom in" aria-label="Zoom in">+</button>
        <button class="graph-btn" onclick="zoomOut()" title="Zoom out" aria-label="Zoom out">&minus;</button>
      </div>
      <div class="graph-error" id="graph-error" role="alert">
        <strong>3D graph unavailable</strong>
        <p id="graph-error-text"></p>
        <button class="btn" id="graph-retry">Retry</button>
      </div>
      <div class="graph-overlay" id="graph-overlay" role="status">Loading...</div>
    </div>
    <div class="details" id="details">
      <h2>Node Details</h2>
      <p style="color: #8b949e; font-size: 13px;">Click a node to view details</p>
    </div>
  </div>
  <div class="kanban-wrap" id="kanban-view" role="tabpanel" aria-labelledby="tab-kanban" style="display:none">
    <div class="kanban-toolbar" id="kanban-toolbar" aria-label="Task filters">
      <div class="tb-group" style="flex:1 1 220px">
        <label class="tb-label" for="kanban-search">Search</label>
        <input class="search" id="kanban-search" type="text" placeholder="Search tasks..." aria-label="Search tasks">
      </div>
      <div class="tb-group"><label class="tb-label" for="kanban-filter-link">Link</label><select id="kanban-filter-link"><option value="all">All</option><option value="linked">Linked</option><option value="unlinked">Unlinked</option><option value="project">Project</option><option value="feature">Feature</option><option value="requirement">Requirement</option><option value="entity">Entity</option><option value="test">Test</option></select></div>
      <div class="tb-group"><label class="tb-label" for="kanban-filter-integration">Integration</label><select id="kanban-filter-integration"><option value="all">All</option><option value="pending">Pending</option><option value="manual">Not requested</option><option value="integrated">Integrated</option></select></div>
      <div class="tb-group"><label class="tb-label" for="kanban-filter-priority">Priority</label><select id="kanban-filter-priority"><option value="all">All</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
      <div class="tb-group"><label class="tb-label" for="kanban-filter-column">Column</label><select id="kanban-filter-column"><option value="all">All</option><option value="backlog">Backlog</option><option value="ready">Ready</option><option value="in_progress">In Progress</option><option value="blocked">Blocked</option><option value="done">Done</option></select></div>
      <div class="tb-group"><label class="tb-label" for="kanban-filter-scope">Scope</label><select id="kanban-filter-scope"><option value="all">All</option><option value="target">Target only</option><option value="source">Source only</option></select></div>
      <div class="tb-group"><label class="tb-label" for="kanban-sort">Sort by</label><div class="tb-group-inline"><select id="kanban-sort"><option value="column">Column</option><option value="priority">Priority</option><option value="name">Name</option><option value="updated">Updated</option><option value="created">Created</option><option value="links">Links</option><option value="integration">Integration</option></select><select id="kanban-order" aria-label="Sort direction"><option value="asc">↑</option><option value="desc">↓</option></select></div></div>
      <button class="btn" id="kanban-reset-filters" style="margin-left:auto">Clear</button>
      <span class="kanban-result" id="kanban-result" role="status" aria-live="polite"></span>
      <span class="kanban-loading" id="kanban-loading">Refreshing tasks...</span>
      <span class="kanban-summary" id="kanban-filter-summary"></span>
    </div>
    <div id="kanban-alert" role="alert"></div>
    <button class="btn primary kanban-new" id="kanban-add">+ New task</button>
    <div class="kanban" id="kanban-board"></div>
    <div class="visually-hidden" id="kanban-live" role="status" aria-live="polite"></div>
  </div>
    </div>
  </div>
${KANBAN_MODAL_HTML}
  <script src="/ui/3d-force-graph.min.js"></script>
  <script>
    var TYPE_COLORS = {
      project: "#58a6ff", feature: "#3fb950", requirement: "#d29922",
      entity: "#bc8cff", task: "#f85149", change: "#f0883e",
      architecture_component: "#79c0ff", test: "#56d364", business_rule: "#f778ba",
      actor: "#d2a8ff", flow: "#79c0ff", use_case: "#56d364", module: "#d29922",
      api: "#79c0ff", endpoint: "#58a6ff", database: "#bc8cff", table: "#d2a8ff",
      field: "#8b949e", file: "#8b949e", symbol: "#8b949e",
      decision: "#f0883e", constraint: "#da3633", assumption: "#d29922",
      value_object: "#d2a8ff", domain: "#58a6ff",
    };

    var graphData = { nodes: [], links: [] };
    var allNodes = [];
    var allLinks = [];
    var selectedNodeId = null;

    function escapeHtml(value) {
      return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    var activeFilter = null;
    var searchQuery = "";
    var fg = null;
    // Use counter-based hash instead of string concatenation (O(1) for large graphs)
    var lastNodeCount = 0;
    var lastRelCount = 0;
    var lastUpdatedAt = "";
    var isLargeGraph = false;
    var LARGE_GRAPH_THRESHOLD = 2000;
    var graphRequestId = 0;

    function getColor(type) { return TYPE_COLORS[type] || "#8b949e"; }

    function showGraphError(message) {
      var panel = document.getElementById("graph-error");
      var text = document.getElementById("graph-error-text");
      var overlay = document.getElementById("graph-overlay");
      if (text) text.textContent = message || "The graph could not be loaded.";
      if (panel) panel.style.display = "block";
      if (overlay) { overlay.textContent = "Graph unavailable"; overlay.classList.add("error"); }
    }

    function hideGraphError() {
      // A successful API response does not mean the 3D graph initialized. Keep
      // the error panel visible when the canvas is unavailable so the user knows
      // why the graph is empty; the node list and Kanban still work.
      if (!fg) return;
      var panel = document.getElementById("graph-error");
      var overlay = document.getElementById("graph-overlay");
      if (panel) panel.style.display = "none";
      if (overlay) overlay.classList.remove("error");
    }

    function toggleDetails() {
      var details = document.getElementById("details");
      if (details) details.classList.toggle("open");
    }

    // Helper to safely extract id from node ref (may be object or string after graphData())
    function linkSourceId(l) { return (typeof l.source === "object" && l.source !== null) ? l.source.id : l.source; }
    function linkTargetId(l) { return (typeof l.target === "object" && l.target !== null) ? l.target.id : l.target; }

    function loadGraph() {
      var requestId = ++graphRequestId;
      fetch("/api/graph", { headers: { "Accept": "application/json" } })
        .then(function(res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function(data) {
          if (requestId !== graphRequestId) return;
          if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.relationships)) {
            throw new Error("Invalid graph response");
          }
          var nodeCount = data.nodeCount || data.nodes.length;
          var relCount = data.relCount || data.relationships.length;
          var updatedAt = data.updated_at || "";

          // O(1) change detection: compare counters + timestamp
          var changed = nodeCount !== lastNodeCount || relCount !== lastRelCount || updatedAt !== lastUpdatedAt;
          lastNodeCount = nodeCount;
          lastRelCount = relCount;
          lastUpdatedAt = updatedAt;

          isLargeGraph = nodeCount > LARGE_GRAPH_THRESHOLD;
          allNodes = data.nodes;
          if (activeFilter && !allNodes.some(function(n) { return n.type === activeFilter; })) activeFilter = null;
          hideGraphError();

          function renderLoadedLinks(links) {
            if (requestId !== graphRequestId) return;
            allLinks = links;
            if (changed) applyFilters();
            renderFilters();
            renderLegend();
            renderNodeList();
            if (typeof renderKanban === "function") renderKanban();
            var overlay = document.getElementById("graph-overlay");
            if (overlay) {
              if (!fg) {
                overlay.textContent = "3D graph unavailable; use the node list.";
                overlay.classList.add("error");
              } else {
                overlay.textContent = nodeCount === 0
                  ? "No nodes in this graph"
                  : nodeCount + " nodes, " + relCount + " links" + (isLargeGraph ? " (large graph mode: rendering " + Math.min(nodeCount, 500) + " nodes; use search/filter to focus)" : "");
              }
            }
          }

          if (data.hasMoreRelationships) {
            function loadRelationshipPage(offset, links) {
              return fetch("/api/graph/relationships?offset=" + offset + "&limit=2000", { headers: { "Accept": "application/json" } })
                .then(function(res) {
                  if (!res.ok) throw new Error("HTTP " + res.status);
                  return res.json();
                })
                .then(function(page) {
                  var combined = links.concat(page.relationships || []);
                  if (page.hasMore) return loadRelationshipPage(offset + (page.relationships || []).length, combined);
                  renderLoadedLinks(combined);
                });
            }
            loadRelationshipPage(data.relationships.length, data.relationships).catch(function(e) {
              console.error("Failed to load relationship page:", e);
              renderLoadedLinks(data.relationships);
            });
          } else {
            renderLoadedLinks(data.relationships);
          }
        })
        .catch(function(e) {
          if (requestId !== graphRequestId) return;
          console.error("Failed to load graph:", e);
          showGraphError(e && e.message ? e.message : String(e));
        });
    }

    function applyFilters() {
      var filteredNodes = allNodes;
      if (activeFilter) filteredNodes = filteredNodes.filter(function(n) { return n.type === activeFilter; });
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        filteredNodes = filteredNodes.filter(function(n) {
          return n.name.toLowerCase().indexOf(q) !== -1 || n.id.toLowerCase().indexOf(q) !== -1 || n.type.toLowerCase().indexOf(q) !== -1;
        });
      }
      if (selectedNodeId && !filteredNodes.some(function(n) { return n.id === selectedNodeId; })) {
        selectedNodeId = null;
        var detailsPanel = document.getElementById("details");
        if (detailsPanel) detailsPanel.innerHTML = '<h2>Node Details</h2><p style="color:#8b949e;font-size:13px">The selected node is hidden by the current filter.</p>';
      }
      var nodeIds = new Set(filteredNodes.map(function(n) { return n.id; }));
      var filteredLinks = allLinks.filter(function(l) { return nodeIds.has(l.from) && nodeIds.has(l.to); });
      var newData = {
        nodes: filteredNodes,
        links: filteredLinks.map(function(r) { return { id: r.id, source: r.from, target: r.to, type: r.type }; })
      };

      // For large graphs, limit nodes rendered in 3D to keep performance smooth
      if (isLargeGraph && newData.nodes.length > 500) {
        var renderLimit = 500;
        // Prioritize nodes connected to selected node, then by type diversity
        if (selectedNodeId) {
          var connected = [];
          var notConnected = [];
          newData.nodes.forEach(function(n) {
            if (n.id === selectedNodeId) { connected.unshift(n); return; }
            var isConn = newData.links.some(function(l) {
              return (l.source === selectedNodeId && l.target === n.id) || (l.target === selectedNodeId && l.source === n.id);
            });
            if (isConn) connected.push(n);
            else notConnected.push(n);
          });
          newData.nodes = connected.concat(notConnected).slice(0, renderLimit);
        } else {
          // Sample: keep first N to maintain type diversity
          newData.nodes = newData.nodes.slice(0, renderLimit);
        }
        // Only keep links between visible nodes
        var visIds = new Set(newData.nodes.map(function(n) { return n.id; }));
        newData.links = newData.links.filter(function(l) { return visIds.has(l.source) && visIds.has(l.target); });
      }

      if (fg) {
        updateGraphData(newData);
      } else {
        graphData = newData;
      }
    }

    function updateGraphData(newData) {
      if (!fg) return;
      // Preserve positions of existing nodes to avoid restarting the simulation
      var posMap = {};
      graphData.nodes.forEach(function(n) {
        if (n.x !== undefined) {
          posMap[n.id] = { x: n.x, y: n.y, z: n.z, vx: n.vx, vy: n.vy, vz: n.vz };
        }
      });
      newData.nodes.forEach(function(n) {
        var pos = posMap[n.id];
        if (pos) {
          n.x = pos.x; n.y = pos.y; n.z = pos.z;
          n.vx = pos.vx; n.vy = pos.vy; n.vz = pos.vz;
        }
      });
      graphData = newData;
      fg.graphData(graphData);
      // Re-apply highlight if a node is selected
      if (selectedNodeId) {
        highlightNode(selectedNodeId);
      }
    }

    function renderFilters() {
      // Build type counts in a single pass (O(n) instead of O(n*types))
      var typeCounts = {};
      var types = [];
      allNodes.forEach(function(n) {
        if (!typeCounts[n.type]) { typeCounts[n.type] = 0; types.push(n.type); }
        typeCounts[n.type]++;
      });
      var el = document.getElementById("filters");
      var html = '<button class="filter-btn' + (activeFilter ? "" : " active") + '" data-filter="all" aria-pressed="' + (activeFilter ? "false" : "true") + '">All (' + allNodes.length + ')</button>';
      types.forEach(function(t) {
        var active = activeFilter === t;
        html += '<button class="filter-btn' + (active ? " active" : "") + '" data-filter="' + escapeHtml(t) + '" aria-pressed="' + (active ? "true" : "false") + '">' + escapeHtml(t) + " (" + typeCounts[t] + ")</button>";
      });
      el.innerHTML = html;
      el.querySelectorAll(".filter-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var f = this.getAttribute("data-filter");
          activeFilter = f === "all" ? null : f;
          el.querySelectorAll(".filter-btn").forEach(function(b) { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
          this.classList.add("active");
          this.setAttribute("aria-pressed", "true");
          applyFilters();
          renderNodeList();
        });
      });
    }

    function renderLegend() {
      var counts = {};
      var types = [];
      allNodes.forEach(function(n) {
        if (!counts[n.type]) { counts[n.type] = 0; types.push(n.type); }
        counts[n.type]++;
      });
      var el = document.getElementById("legend");
      el.innerHTML = types.map(function(t) {
        return '<span class="legend-item" title="' + escapeHtml(t) + ' (' + counts[t] + ')"><span class="legend-dot" style="background:' + getColor(t) + '"></span>' + escapeHtml(t) + ' (' + counts[t] + ')</span>';
      }).join("");
    }

    function renderNodeList() {
      var nodes = graphData.nodes;
      document.getElementById("node-count").textContent = isLargeGraph ? (lastNodeCount + "+") : nodes.length;
      var el = document.getElementById("node-list");
      // For large graphs, limit sidebar list to 200 items
      var listLimit = isLargeGraph ? 200 : nodes.length;
      var html = "";
      var displayNodes = nodes.slice(0, listLimit);
      displayNodes.forEach(function(n) {
        var sel = selectedNodeId === n.id ? " selected" : "";
        html += '<li class="node-item' + sel + '" tabindex="0" role="button" aria-label="' + escapeHtml(n.name + " (" + n.type + ")") + '" data-id="' + escapeHtml(n.id) + '">' +
          '<div class="node-id">' + escapeHtml(n.id) + "</div>" +
          '<div class="node-name">' + escapeHtml(n.name) + '<span class="node-status status-' + escapeHtml(n.status) + '">' + escapeHtml(n.status) + "</span></div>" +
          "</li>";
      });
      if (isLargeGraph && nodes.length > listLimit) {
        html += '<li style="padding:8px;color:#8b949e;font-size:11px;text-align:center">... ' + (nodes.length - listLimit) + " more (use search to filter)</li>";
      }
      el.innerHTML = html;
      el.querySelectorAll(".node-item").forEach(function(item) {
        item.addEventListener("click", function() {
          selectNode(this.getAttribute("data-id"));
        });
        item.addEventListener("keydown", function(e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectNode(this.getAttribute("data-id")); }
        });
      });
    }

    function selectNode(id) {
      selectedNodeId = id;
      renderNodeList();
      highlightNode(id);
      var details = document.getElementById("details");
      if (details) details.innerHTML = '<h2>Node Details</h2><p style="color:#8b949e;font-size:13px">Loading...</p>';
      fetch("/api/nodes/" + encodeURIComponent(id), { headers: { "Accept": "application/json" } })
        .then(function(res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .then(function(node) {
          if (node && node.error) throw new Error(node.error);
          return fetch("/api/nodes/" + encodeURIComponent(id) + "/relationships", { headers: { "Accept": "application/json" } })
            .then(function(res2) { if (!res2.ok) throw new Error("HTTP " + res2.status); return res2.json(); })
            .then(function(rels) {
              var acceptancePromise = node.type !== "requirement"
                ? Promise.resolve(null)
                : fetch("/api/acceptance?requirement_id=" + encodeURIComponent(node.id)).then(function(res3) { return res3.json(); });
              return Promise.all([
                acceptancePromise,
                fetch("/api/guidance?target_node_id=" + encodeURIComponent(node.id)).then(function(res4) { return res4.json(); }),
              ]).then(function(values) { return { rels: rels, acceptance: values[0], guidance: values[1] }; });
            })
            .then(function(result) { renderDetails(node, result.rels, result.acceptance, result.guidance); centerOnNode(id); });
        })
        .catch(function(e) {
          console.error("Failed to load node:", e);
          if (details) details.innerHTML = '<h2>Node Details</h2><p style="color:#f85149;font-size:13px">Could not load this node: ' + escapeHtml(e && e.message ? e.message : String(e)) + '</p>';
        });
    }

    function renderDetails(node, rels, acceptance, guidanceData) {
      var el = document.getElementById("details");
      var outgoing = rels.filter(function(r) { return r.from === node.id; });
      var incoming = rels.filter(function(r) { return r.to === node.id; });
      var html = "<h2>Node Details</h2>" +
        '<div class="detail-section"><h3>Info</h3>' +
        '<div class="detail-field"><span class="label">ID:</span> ' + escapeHtml(node.id) +
        ' <button class="btn detail-copy" data-copy-id="' + escapeHtml(node.id) + '">Copy ID</button></div>' +
        '<div class="detail-field"><span class="label">Type:</span> <span class="legend-dot" style="background:' + getColor(node.type) + ';display:inline-block;vertical-align:middle;margin-right:4px"></span>' + escapeHtml(node.type) + "</div>" +
        '<div class="detail-field"><span class="label">Name:</span> ' + escapeHtml(node.name) + "</div>" +
        '<div class="detail-field"><span class="label">Status:</span> <span class="node-status status-' + escapeHtml(node.status) + '">' + escapeHtml(node.status) + "</span></div>" +
        '<div class="detail-field"><span class="label">Version:</span> ' + escapeHtml(node.version) + "</div>";
      if (node.description) html += '<div class="detail-field"><span class="label">Description:</span> ' + escapeHtml(node.description) + "</div>";
      if (node.metadata && Object.keys(node.metadata).length > 0) {
        html += '<div class="detail-section"><h3>Metadata</h3>';
        Object.keys(node.metadata).forEach(function(key) {
          var value = node.metadata[key];
          var text = typeof value === "string" ? value : JSON.stringify(value);
          html += '<div class="detail-field"><span class="label">' + escapeHtml(key) + ':</span> <span class="detail-meta-value">' + escapeHtml(text) + "</span></div>";
        });
        html += '<details class="detail-json"><summary>Raw JSON</summary><pre style="font-size:11px;color:#8b949e;white-space:pre-wrap;margin-top:4px">' + escapeHtml(JSON.stringify(node.metadata, null, 2)) + "</pre></details></div>";
      }
      html += "</div>";
      if (acceptance && Array.isArray(acceptance.criteria)) {
        html += '<div class="detail-section"><h3>Acceptance Criteria (' + acceptance.criteria.length + ')</h3>';
        html += '<div class="detail-field">Summary: ' + escapeHtml(JSON.stringify(acceptance.summary || {})) + '</div>';
        html += '<button class="btn primary" data-accept-all="' + escapeHtml(node.id) + '">Accept all pending</button>';
        acceptance.criteria.forEach(function(criterion) {
          html += '<div class="detail-field" style="margin-top:8px"><span class="node-status status-' + escapeHtml(criterion.status) + '">' + escapeHtml(criterion.status) + '</span> ' + escapeHtml(criterion.metadata.text) +
            (criterion.status === "PENDING" ? ' <button class="btn" data-accept="' + escapeHtml(criterion.id) + '">Accept</button>' : '') + '</div>';
        });
        html += '</div>';
      }
      html += '<div class="detail-section"><h3>Human guidance</h3>';
      if (guidanceData && Array.isArray(guidanceData.guidance)) {
        guidanceData.guidance.forEach(function(guidance) {
          html += '<div class="detail-field"><span class="node-status status-' + escapeHtml(guidance.metadata.status) + '">' + escapeHtml(guidance.metadata.status) + '</span> ' + escapeHtml(guidance.metadata.instruction) + ' <small>' + escapeHtml(guidance.id) + '</small></div>';
        });
      }
      html += '<textarea id="node-guidance-input" placeholder="Human guidance for this node" style="width:100%;min-height:60px"></textarea>';
      html += '<button class="btn primary" data-guide-node="' + escapeHtml(node.id) + '">Record guidance</button></div>';
      if (outgoing.length) {
        html += '<div class="detail-section"><h3>Outgoing (' + outgoing.length + ')</h3>';
        outgoing.forEach(function(r) { html += '<button type="button" class="detail-link" data-goto="' + escapeHtml(r.to) + '">' + escapeHtml(r.type) + " &rarr; " + escapeHtml(r.to) + "</button>"; });
        html += "</div>";
      }
      if (incoming.length) {
        html += '<div class="detail-section"><h3>Incoming (' + incoming.length + ')</h3>';
        incoming.forEach(function(r) { html += '<button type="button" class="detail-link" data-goto="' + escapeHtml(r.from) + '">' + escapeHtml(r.type) + " &larr; " + escapeHtml(r.from) + "</button>"; });
        html += "</div>";
      }
      el.innerHTML = html;
      el.querySelectorAll("[data-goto]").forEach(function(el) {
        el.addEventListener("click", function() { selectNode(this.getAttribute("data-goto")); });
      });
      el.querySelectorAll("[data-copy-id]").forEach(function(button) {
        button.addEventListener("click", function() {
          var id = this.getAttribute("data-copy-id");
          var done = function() { button.textContent = "Copied"; setTimeout(function() { button.textContent = "Copy ID"; }, 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(id).then(done).catch(function() { button.textContent = "Copy failed"; });
          } else {
            button.textContent = "Copy unavailable";
          }
        });
      });
      el.querySelectorAll("[data-accept]").forEach(function(button) {
        button.addEventListener("click", function() {
          fetch("/api/acceptance/" + encodeURIComponent(this.getAttribute("data-accept")) + "/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
            .then(function() { selectNode(node.id); });
        });
      });
      el.querySelectorAll("[data-accept-all]").forEach(function(button) {
        button.addEventListener("click", function() {
          fetch("/api/acceptance/accept-all?requirement_id=" + encodeURIComponent(this.getAttribute("data-accept-all")), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
            .then(function() { selectNode(node.id); });
        });
      });
      el.querySelectorAll("[data-guide-node]").forEach(function(button) {
        button.addEventListener("click", function() {
          var input = document.getElementById("node-guidance-input");
          var instruction = input && input.value ? input.value : "";
          if (!instruction) return;
          fetch("/api/guidance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_node_id: this.getAttribute("data-guide-node"), instruction: instruction }) })
            .then(function() { selectNode(node.id); });
        });
      });
    }

    function highlightNode(id) {
      if (!fg) return;
      fg.nodeColor(function(n) {
        if (!id) return getColor(n.type);
        // Keep the graph at its normal opacity. Selection is represented by a
        // small size/color accent on the clicked node, never by fading all
        // other nodes out of view.
        return n.id === id ? "#ffffff" : getColor(n.type);
      });
      fg.nodeOpacity(0.9);
      fg.nodeVal(function(n) { return n.id === id ? 8 : 6; });
      fg.linkOpacity(0.6);
      fg.linkColor(function(l) {
        return id && (linkSourceId(l) === id || linkTargetId(l) === id) ? "#58a6ff" : "#30363d";
      });
      fg.linkWidth(function(l) {
        return id && (linkSourceId(l) === id || linkTargetId(l) === id) ? 2 : 1;
      });
    }

    function clearHighlight() {
      selectedNodeId = null;
      if (!fg) return;
      fg.nodeColor(function(n) { return getColor(n.type); });
      fg.nodeOpacity(0.9);
      fg.nodeVal(6);
      fg.linkOpacity(0.6);
      fg.linkColor(function() { return "#30363d"; });
      fg.linkWidth(1);
      fg.linkDirectionalParticles(0);
    }

    function centerOnNode(id) {
      if (!fg) return;
      var node = graphData.nodes.find(function(n) { return n.id === id; });
      if (node && node.x !== undefined) {
        var distance = 120;
        var distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
        fg.cameraPosition(
          { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
          { x: node.x, y: node.y, z: node.z },
          600
        );
      }
    }

    function resetView() {
      clearHighlight();
      selectedNodeId = null;
      renderNodeList();
      document.getElementById("details").innerHTML = '<h2>Node Details</h2><p style="color:#8b949e;font-size:13px">Click a node to view details</p>';
      if (fg) fg.cameraPosition({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 0 }, 600);
    }

    function zoomIn() { if (fg) fg.cameraPosition({ z: fg.cameraPosition().z * 0.7 }); }
    function zoomOut() { if (fg) fg.cameraPosition({ z: fg.cameraPosition().z * 1.4 }); }

    function initGraph() {
      var container = document.getElementById("graph-container");
      if (typeof ForceGraph3D !== "function") throw new Error("The 3D graph library is not available.");
      fg = ForceGraph3D()(container)
        .graphData(graphData)
        .backgroundColor("#0d1117")
        .width(container.offsetWidth)
        .height(container.offsetHeight)
        .nodeVal(function(n) { return selectedNodeId === n.id ? 8 : 6; })
        .nodeColor(function(n) { return getColor(n.type); })
        .nodeOpacity(0.9)
        .nodeResolution(isLargeGraph ? 8 : 24)
        .nodeLabel(function(n) { return "<b>" + escapeHtml(n.name) + "</b><br/>" + escapeHtml(n.type) + " [" + escapeHtml(n.status) + "]"; })
        .onNodeClick(function(node) { selectNode(node.id); })
        .onBackgroundClick(function() {
          clearHighlight();
          renderNodeList();
          document.getElementById("details").innerHTML = '<h2>Node Details</h2><p style="color:#8b949e;font-size:13px">Click a node to view details</p>';
        })
        .linkColor(function() { return "#30363d"; })
        .linkOpacity(0.6)
        .linkWidth(1)
        .linkLabel(function(l) { return l.type; })
        .linkDirectionalParticles(0)
        .d3AlphaDecay(isLargeGraph ? 0.05 : 0.02)
        .d3VelocityDecay(isLargeGraph ? 0.5 : 0.3)
        .enablePointerInteraction(true)
        .showNavInfo(false);

      var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion && typeof fg.pauseAnimation === "function") {
        setTimeout(function() { if (fg && typeof fg.pauseAnimation === "function") fg.pauseAnimation(); }, 1200);
      }

      window.addEventListener("resize", function() {
        if (fg && container) {
          fg.width(container.offsetWidth);
          fg.height(container.offsetHeight);
        }
      });
    }

    var graphSearch = document.getElementById("search");
    if (graphSearch) graphSearch.addEventListener("input", function(e) {
      searchQuery = e.target.value;
      applyFilters();
      renderNodeList();
    });

    var graphRetry = document.getElementById("graph-retry");
    if (graphRetry) graphRetry.addEventListener("click", function() {
      if (!fg) {
        try { initGraph(); } catch (error) { showGraphError(error && error.message ? error.message : String(error)); }
      }
      loadGraph();
    });
    window.toggleDetails = toggleDetails;
    try { initGraph(); } catch (error) { showGraphError(error && error.message ? error.message : String(error)); }
    loadGraph();
    setInterval(loadGraph, 10000);

    // ─── SSE Real-time Progress ──────────────────────────────────────
    var progressPanel = document.getElementById("progress-panel");
    var progressTitle = document.getElementById("progress-title");
    var progressPercent = document.getElementById("progress-percent");
    var progressBar = document.getElementById("progress-bar");
    var progressStep = document.getElementById("progress-step");
    var progressLog = document.getElementById("progress-log");
    var sseDot = document.getElementById("sse-dot");
    var sseText = document.getElementById("sse-text");
    var eventSource = null;

    function connectSSE() {
      if (eventSource) {
        eventSource.close();
      }
      eventSource = new EventSource("/api/events");

      eventSource.onopen = function() {
        sseDot.className = "sse-dot connected";
        sseText.textContent = "Connected";
      };

      eventSource.onerror = function() {
        var readyState = eventSource ? eventSource.readyState : -1;
        // 0=CONNECTING, 1=OPEN, 2=CLOSED
        if (readyState === 2) {
          // Connection permanently closed — manual reconnect needed
          sseDot.className = "sse-dot disconnected";
          sseText.textContent = "Disconnected";
          setTimeout(connectSSE, 3000);
        } else if (readyState === 0) {
          // Browser is auto-reconnecting, show status but don't create new instance
          sseDot.className = "sse-dot disconnected";
          sseText.textContent = "Reconnecting...";
        }
        // readyState === 1 (OPEN): transient error, connection still alive — do nothing
      };

      eventSource.onmessage = function(e) {
        try {
          var event = JSON.parse(e.data);
          handleProgressEvent(event);
        } catch (err) {
          console.error("Failed to parse SSE event:", err);
        }
      };
    }

    function handleProgressEvent(event) {
      // Update progress panel for build events
      if (event.type === "info" && event.step === "build_start") {
        progressPanel.classList.add("active");
        progressTitle.textContent = "Building Graph...";
        progressPercent.textContent = "0%";
        progressBar.style.width = "0%";
        progressStep.textContent = event.message;
        progressLog.innerHTML = "";
        addLogEntry("Build started: " + (event.details ? event.details.buildId : ""));
        return;
      }

      if (event.type === "step") {
        progressPanel.classList.add("active");
        progressTitle.textContent = "Building Graph...";
        if (event.progress !== undefined) {
          progressPercent.textContent = event.progress + "%";
          progressBar.style.width = event.progress + "%";
        }
        progressStep.textContent = event.message;
        addLogEntry("[STEP] " + event.message);
        return;
      }

      if (event.type === "progress") {
        if (event.progress !== undefined) {
          progressPercent.textContent = event.progress + "%";
          progressBar.style.width = event.progress + "%";
        }
        progressStep.textContent = event.message;
        return;
      }

      if (event.type === "error") {
        addLogEntry("[ERROR] " + event.message, "error");
        return;
      }

      if (event.type === "complete") {
        progressTitle.textContent = "Build Complete";
        progressPercent.textContent = "100%";
        progressBar.style.width = "100%";
        progressStep.textContent = event.message;
        addLogEntry("[DONE] " + event.message, "complete");
        // Refresh graph after build completes
        setTimeout(loadGraph, 500);
        // Hide panel after 5 seconds
        setTimeout(function() {
          progressPanel.classList.remove("active");
        }, 5000);
        return;
      }

      // Handle other events
      if (event.type === "connected") {
        addLogEntry("SSE connected");
      }
      if (event.type === "build_status") {
        progressPanel.classList.add("active");
        progressTitle.textContent = "Build in Progress...";
        if (event.data && event.data.progress !== undefined) {
          progressPercent.textContent = event.data.progress + "%";
          progressBar.style.width = event.data.progress + "%";
        }
        if (event.data && event.data.currentStep) {
          progressStep.textContent = event.data.currentStep;
        }
      }
    }

    function addLogEntry(text, className) {
      var entry = document.createElement("div");
      entry.className = "progress-log-entry" + (className ? " " + className : "");
      var time = new Date().toLocaleTimeString();
      entry.textContent = "[" + time + "] " + text;
      progressLog.appendChild(entry);
      progressLog.scrollTop = progressLog.scrollHeight;
    }

    // Start SSE connection
    connectSSE();
  </script>
  <script>${KANBAN_SCRIPT}</script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ...headers,
      },
    })
  }
}

// ── Servidor compartilhado ──────────────────────────────────────────
//
// The dashboard is an in-process server: only one makes sense per project.
// The `sdd.start_dashboard` tool and the `/sdd viz` command go through here, so
// we do not start two servers (on two different ports) in the same session.

let sharedDashboard: SddDashboardServer | null = null
let sharedProjectDir: string | null = null

/**
 * Starts the project dashboard or reuses the one already running.
 *
 * @returns the port the dashboard is listening on
 */
export function startSharedDashboard(
  projectDir: string,
  preferredPort: number = resolveDashboardPort(),
): number {
  if (sharedDashboard?.isRunning() && sharedProjectDir === projectDir) {
    return sharedDashboard.getPort()
  }

  sharedDashboard?.stop()

  const server = new SddDashboardServer(projectDir)
  server.start(preferredPort)
  sharedDashboard = server
  sharedProjectDir = projectDir
  return server.getPort()
}

/** Shuts down the shared dashboard. Returns false if nothing was running. */
export function stopSharedDashboard(): boolean {
  if (!sharedDashboard?.isRunning()) return false
  sharedDashboard.stop()
  sharedDashboard = null
  sharedProjectDir = null
  return true
}

/** URL of the shared dashboard, or null if it is not running. */
export function getSharedDashboardUrl(): string | null {
  return sharedDashboard?.isRunning() ? sharedDashboard.getUrl() : null
}
