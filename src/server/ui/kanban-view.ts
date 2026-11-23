/**
 * Kanban view assets for the SDD dashboard.
 *
 * Kept as plain strings (not files) because the plugin is compiled with `tsc`
 * and `dist/` ships only JS — static assets would not be copied. The script is
 * a classic (non-module) script so it shares the global scope with the graph
 * script.
 *
 * The Kanban is intentionally independent from `/api/graph`: `/api/tasks`
 * already returns the complete `TaskBoardItem` (metadata, approval, links and
 * timestamps), while the graph endpoint stays lightweight for the 3D view.
 */

export const KANBAN_STYLE = `
    .app { display: flex; flex-direction: column; height: 100dvh; }
    .views { flex: 1; min-height: 0; position: relative; }
    .topbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; background: #161b22; border-bottom: 1px solid #30363d; flex-wrap: wrap; }
    .brand { font-size: 13px; font-weight: 600; color: #58a6ff; letter-spacing: .5px; }
    .tabs { display: flex; gap: 6px; }
    .tab { padding: 6px 14px; border-radius: 6px; border: 1px solid #30363d; background: transparent; color: #c9d1d9; cursor: pointer; font-size: 12px; transition: all .2s; }
    .tab:hover { border-color: #58a6ff; }
    .tab.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
    .tab:focus-visible, .btn:focus-visible, .graph-btn:focus-visible, .kcard:focus-visible, .node-item:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
    .task-pending { margin-left: auto; font-size: 11px; color: #d29922; }
    .kanban-wrap { height: 100%; overflow: auto; padding: 16px; }
    .kanban { display: flex; gap: 14px; align-items: flex-start; min-height: 100%; }
    .kcol { flex: 1 1 0; min-width: 220px; background: #161b22; border: 1px solid #30363d; border-radius: 10px; display: flex; flex-direction: column; max-height: calc(100dvh - 170px); }
    .kcol.drop-target { border-color: #58a6ff; background: #1c2333; }
    .kcol-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #21262d; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #8b949e; position: sticky; top: 0; background: #161b22; z-index: 1; border-radius: 10px 10px 0 0; }
    .kcol-count { background: #21262d; border-radius: 10px; padding: 1px 8px; font-size: 11px; }
    .kcol-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 60px; }
    .kcard { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 10px; cursor: grab; transition: border-color .2s, transform .1s; }
    .kcard:hover { border-color: #58a6ff; }
    .kcard.dragging { opacity: .5; }
    .kcard-title { font-size: 13px; font-weight: 600; color: #c9d1d9; }
    .kcard-id { font-size: 10px; color: #8b949e; margin-top: 2px; }
    .kcard-desc { font-size: 11px; color: #8b949e; margin-top: 6px; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .kanban-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; padding: 10px 14px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; font-size: 12px; }
    .kanban-toolbar input, .kanban-toolbar select { padding: 6px 8px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; font-size: 12px; outline: none; font-family: inherit; }
    .kanban-toolbar input:focus, .kanban-toolbar select:focus { border-color: #58a6ff; }
    .kanban-toolbar .search { min-width: 190px; }
    .kanban-toolbar .tb-label { color: #8b949e; font-size: 10px; text-transform: uppercase; letter-spacing: .6px; display: block; margin-bottom: 2px; }
    .kanban-toolbar .tb-group { display: flex; flex-direction: column; gap: 2px; }
    .kanban-toolbar .tb-group-inline { display: flex; align-items: center; gap: 6px; }
    .kanban-toolbar .spacer { flex: 1; }
    .kanban-result { color: #8b949e; font-size: 11px; }
    .kanban-summary { color: #8b949e; font-size: 11px; flex-basis: 100%; }
    .kcard-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
    .kbadge { font-size: 10.5px; padding: 2px 6px; border-radius: 10px; border: 1px solid #30363d; color: #8b949e; white-space: nowrap; }
    .kbadge.pending { border-color: #9e6a03; color: #d29922; }
    .kbadge.integrated { border-color: #238636; color: #3fb950; }
    .kbadge.manual { border-color: #6e7681; color: #8b949e; }
    .kbadge.change-draft { border-color: #9e6a03; color: #d29922; }
    .kbadge.change-approved { border-color: #1f6feb; color: #58a6ff; }
    .kbadge.approved { border-color: #238636; color: #3fb950; }
    .kbadge.rejected { border-color: #da3633; color: #f85149; }
    .kbadge.target-backlog { border-color: #8957e5; color: #d2a8ff; background: #2d1b4e; }
    .kchange { font-size: 12px; color: #8b949e; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .kempty { color: #6e7681; font-size: 11px; text-align: center; padding: 14px 0; }
    .kempty button { margin-top: 8px; }
    .kanban-new { margin-bottom: 12px; }
    .board-alert { background: #3d1d1d; border: 1px solid #da3633; color: #ffb3ad; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .board-alert .btn { padding: 4px 10px; }
    .btn { padding: 7px 14px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 12px; transition: all .2s; }
    .btn:hover { border-color: #58a6ff; }
    .btn:disabled { opacity: .5; cursor: wait; }
    .btn.primary { background: #238636; border-color: #238636; color: #fff; }
    .btn.danger { background: #da3633; border-color: #da3633; color: #fff; }
    .btn.link { background: transparent; border-color: transparent; color: #58a6ff; padding: 4px 6px; }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: #000000aa; z-index: 50; align-items: center; justify-content: center; padding: 16px; }
    .modal-backdrop.open { display: flex; }
    .modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; width: min(560px, 92vw); max-height: 88dvh; overflow-y: auto; padding: 20px; position: relative; }
    .modal-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding-right: 28px; }
    .modal h3 { font-size: 15px; color: #58a6ff; }
    .modal-version { color: #8b949e; font-size: 11px; }
    .modal-close { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; cursor: pointer; font-size: 18px; line-height: 1; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .5px; }
    .field input, .field select, .field textarea { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; font-size: 13px; outline: none; font-family: inherit; }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: #58a6ff; }
    .field textarea { resize: vertical; min-height: 60px; }
    .task-links { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #8b949e; }
    .task-links a { color: #58a6ff; }
    .modal-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
    .modal-actions .spacer { flex: 1; }
    .modal-danger { display: flex; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #21262d; }
    .modal-status { font-size: 11px; margin-top: 10px; min-height: 14px; color: #8b949e; }
    .modal-status.error { color: #f85149; }
    .modal-status.ok { color: #3fb950; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (max-width: 1200px) {
      .kanban-toolbar .search { min-width: 150px; }
      .kcol { min-width: 200px; }
    }
    @media (max-width: 900px) {
      .kanban-wrap { padding: 12px; }
      .kanban-toolbar { align-items: flex-end; }
      .kanban-toolbar .search { flex: 1 1 100%; }
      .kcol { min-width: 210px; }
    }
    @media (max-width: 700px) {
      .topbar { gap: 8px; padding: 8px 10px; }
      .brand { flex: 1 1 100%; }
      .task-pending { margin-left: 0; }
      .kanban-wrap { padding: 8px; overflow-x: auto; }
      .kanban-toolbar { gap: 6px; padding: 8px; }
      .kanban-toolbar .tb-group { flex: 1 1 45%; }
      .kanban-toolbar select { width: 100%; }
      .kanban-new { width: 100%; }
      .kcol { flex: 0 0 82vw; min-width: 0; }
      .modal { padding: 16px; }
      .modal-actions { position: sticky; bottom: -16px; background: #161b22; padding: 10px 0 2px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; }
    }
`

export const KANBAN_MODAL_HTML = `
  <div class="modal-backdrop" id="task-modal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" tabindex="-1">
      <button class="modal-close" id="task-close" aria-label="Close task dialog">&times;</button>
      <div class="modal-heading">
        <h3 id="task-modal-title">New task</h3>
        <span class="modal-version" id="task-version"></span>
      </div>
      <input type="hidden" id="task-id">
      <div class="field">
        <label for="task-name">Name</label>
        <input id="task-name" type="text" placeholder="e.g. Implement Google login" maxlength="200">
      </div>
      <div class="field">
        <label for="task-description">Description</label>
        <textarea id="task-description" placeholder="Context and details of the task"></textarea>
      </div>
      <div class="field">
        <label for="task-goal">Goal</label>
        <input id="task-goal" type="text" placeholder="Expected outcome" maxlength="4000">
      </div>
      <div class="field">
        <label for="task-acceptance">Acceptance criteria derived from the Requirement</label>
        <textarea id="task-acceptance" placeholder="Link the Task to a Requirement to see its criteria" readonly></textarea>
      </div>
      <div class="field">
        <label for="task-files">Planned files (comma-separated)</label>
        <input id="task-files" type="text" placeholder="src/auth.ts, src/auth.test.ts">
      </div>
      <div class="field">
        <label for="task-priority">Priority</label>
        <select id="task-priority">
          <option value="medium">Medium</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="field">
        <label for="task-column">Column</label>
        <select id="task-column">
          <option value="backlog">Backlog</option>
          <option value="ready">Ready</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div class="field" id="task-link-field">
        <label for="task-link">Link to (feature/requirement/project ID — optional)</label>
        <input id="task-link" type="text" placeholder="FEAT-001">
      </div>
      <div class="field" id="task-links-field" style="display:none">
        <label>Current links</label>
        <div class="task-links" id="task-links"></div>
      </div>
      <div class="field" id="task-change-field" style="display:none">
        <label>SDD Change (evolution/audit — not the write gate)</label>
        <div class="kchange" id="task-change-info">—</div>
      </div>
      <div class="modal-actions">
        <button class="btn primary" id="task-save">Save</button>
        <button class="btn" id="task-integrate" style="display:none">Integrate with AI</button>
        <button class="btn primary" id="task-approve" style="display:none">Approve task</button>
        <button class="btn danger" id="task-reject" style="display:none">Reject</button>
        <button class="btn" id="task-change" style="display:none">Open SDD Change</button>
        <div class="spacer"></div>
        <button class="btn" id="task-cancel">Cancel</button>
      </div>
      <div class="modal-danger">
        <button class="btn danger" id="task-delete" style="display:none">Delete task</button>
      </div>
      <div class="modal-status" id="task-modal-status" role="status" aria-live="polite"></div>
    </div>
  </div>
`

export const KANBAN_SCRIPT = `
(function () {
  var COLUMN_ORDER = ["backlog", "ready", "in_progress", "blocked", "done"];
  var COLUMN_LABEL = { backlog: "Backlog", ready: "Ready", in_progress: "In Progress", blocked: "Blocked", done: "Done" };
  var STATUS_COLUMN = {
    DRAFT: "backlog", PROPOSED: "backlog", todo: "backlog",
    ready: "ready", APPROVED: "ready",
    in_progress: "in_progress", IMPLEMENTING: "in_progress", VERIFYING: "in_progress",
    blocked: "blocked", BLOCKED: "blocked", CONFLICT: "blocked", FAILED: "blocked", DRIFTED: "blocked",
    completed: "done", COMPLETED: "done", IMPLEMENTED: "done", VERIFIED: "done", DEPRECATED: "done", ROLLED_BACK: "done"
  };
  var COLUMN_IDX = { backlog: 0, ready: 1, in_progress: 2, blocked: 3, done: 4 };
  var PRIORITY_IDX = { critical: 0, high: 1, medium: 2, low: 3 };
  var INT_IDX = { pending: 0, manual: 1, integrated: 2 };
  var FILTER_KEY = "sdd-kanban-filters";
  var LINK_FILTERS = ["all", "linked", "unlinked", "project", "feature", "requirement", "entity", "test"];
  var INTEGRATION_FILTERS = ["all", "pending", "manual", "integrated"];
  var PRIORITY_FILTERS = ["all", "critical", "high", "medium", "low"];
  var COLUMN_FILTERS = ["all", "backlog", "ready", "in_progress", "blocked", "done"];
  var SCOPE_FILTERS = ["all", "target", "source"];
  var SORT_FILTERS = ["column", "priority", "name", "updated", "created", "links", "integration"];
  var allTasks = [];
  var taskRequestId = 0;
  var tasksError = null;
  var currentTask = null;
  var initialForm = null;
  var modalTrigger = null;
  var busy = false;

  function el(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function columnForStatus(status) { return STATUS_COLUMN[status] || "backlog"; }
  function taskColumn(task) { return task.column || columnForStatus(task.status); }
  function isTargetBacklog(task) {
    var meta = task.metadata || {};
    return meta.execution_scope === "target" || meta.purpose === "reverse_engineering";
  }
  function splitList(value) {
    return String(value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function sameList(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text || ("HTTP " + res.status) }; }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function pick(value, allowed, fallback) { return allowed.indexOf(value) === -1 ? fallback : value; }
  function getFilters() {
    try {
      var raw = JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") || {};
      return {
        search: typeof raw.search === "string" && raw.search !== "all" ? raw.search : "",
        link: pick(raw.link, LINK_FILTERS, "all"),
        integration: pick(raw.integration, INTEGRATION_FILTERS, "all"),
        priority: pick(raw.priority, PRIORITY_FILTERS, "all"),
        column: pick(raw.column, COLUMN_FILTERS, "all"),
        scope: pick(raw.scope, SCOPE_FILTERS, "all"),
        sort: pick(raw.sort, SORT_FILTERS, "column"),
        order: raw.order === "desc" ? "desc" : "asc"
      };
    } catch (e) { return { search: "", link: "all", integration: "all", priority: "all", column: "all", scope: "all", sort: "column", order: "asc" }; }
  }
  function saveFilters(f) { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch (e) {} }
  function setText(id, value) { var node = el(id); if (node) node.value = value == null ? "" : value; }
  function setSelect(id, value) { var node = el(id); if (node) node.value = value || "all"; }

  function renderToolbar() {
    var f = getFilters();
    setText("kanban-search", f.search);
    setSelect("kanban-filter-link", f.link);
    setSelect("kanban-filter-integration", f.integration);
    setSelect("kanban-filter-priority", f.priority);
    setSelect("kanban-filter-column", f.column);
    setSelect("kanban-filter-scope", f.scope);
    setSelect("kanban-sort", f.sort);
    setSelect("kanban-order", f.order);
  }
  function readToolbar() {
    var f = getFilters();
    f.search = el("kanban-search") ? el("kanban-search").value : "";
    f.link = el("kanban-filter-link") ? el("kanban-filter-link").value : "all";
    f.integration = el("kanban-filter-integration") ? el("kanban-filter-integration").value : "all";
    f.priority = el("kanban-filter-priority") ? el("kanban-filter-priority").value : "all";
    f.column = el("kanban-filter-column") ? el("kanban-filter-column").value : "all";
    f.scope = el("kanban-filter-scope") ? el("kanban-filter-scope").value : "all";
    f.sort = el("kanban-sort") ? el("kanban-sort").value : "column";
    f.order = el("kanban-order") ? el("kanban-order").value : "asc";
    saveFilters(f);
    return f;
  }

  function taskMatches(task, f) {
    var q = (f.search || "").trim().toLowerCase();
    if (q) {
      var meta = task.metadata || {};
      var hay = [task.id, task.name, task.description || "", meta.goal || ""]
        .concat(Array.isArray(meta.files) ? meta.files : [])
        .concat(Array.isArray(meta.acceptance) ? meta.acceptance : [])
        .concat(Array.isArray(meta.legacy_acceptance) ? meta.legacy_acceptance : [])
        .concat((task.links || []).map(function (link) { return (link.node_id || "") + " " + (link.node_type || "") + " " + (link.node_name || ""); }))
        .join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    var links = task.links || [];
    if (f.link === "linked" && links.length === 0) return false;
    if (f.link === "unlinked" && links.length > 0) return false;
    if (f.link !== "all" && f.link !== "linked" && f.link !== "unlinked" && !links.some(function (link) { return link.node_type === f.link; })) return false;
    if (f.integration !== "all" && task.integration_status !== f.integration) return false;
    if (f.priority !== "all" && task.priority !== f.priority) return false;
    if (f.column !== "all" && taskColumn(task) !== f.column) return false;
    if (f.scope === "target" && !isTargetBacklog(task)) return false;
    if (f.scope === "source" && isTargetBacklog(task)) return false;
    return true;
  }

  function compareText(a, b) { return String(a || "").localeCompare(String(b || "")); }
  function applyFilters() {
    var f = getFilters();
    var result = allTasks.filter(function (task) { return taskMatches(task, f); });
    var dir = f.order === "desc" ? -1 : 1;
    result.sort(function (a, b) {
      var cmp = 0;
      if (f.sort === "priority") cmp = PRIORITY_IDX[a.priority || "medium"] - PRIORITY_IDX[b.priority || "medium"];
      else if (f.sort === "name") cmp = compareText(a.name, b.name);
      else if (f.sort === "created") cmp = compareText(a.created_at, b.created_at);
      else if (f.sort === "updated") cmp = compareText(a.updated_at, b.updated_at);
      else if (f.sort === "integration") cmp = INT_IDX[a.integration_status || "manual"] - INT_IDX[b.integration_status || "manual"];
      else if (f.sort === "links") cmp = (a.links || []).length - (b.links || []).length;
      else {
        cmp = COLUMN_IDX[taskColumn(a)] - COLUMN_IDX[taskColumn(b)];
        if (cmp === 0) cmp = PRIORITY_IDX[a.priority || "medium"] - PRIORITY_IDX[b.priority || "medium"];
        if (cmp === 0) cmp = compareText(a.name, b.name);
        return cmp;
      }
      if (cmp !== 0) return cmp * dir;
      var colCmp = COLUMN_IDX[taskColumn(a)] - COLUMN_IDX[taskColumn(b)];
      if (colCmp !== 0) return colCmp;
      return compareText(a.name, b.name);
    });
    return result;
  }

  function filterSummary(f, visible) {
    var parts = [];
    if (f.search) parts.push("search: " + f.search);
    if (f.link !== "all") parts.push("link: " + f.link);
    if (f.integration !== "all") parts.push("integration: " + f.integration);
    if (f.priority !== "all") parts.push("priority: " + f.priority);
    if (f.column !== "all") parts.push("column: " + f.column);
    if (f.scope !== "all") parts.push("scope: " + f.scope);
    var text = "Showing " + visible + " of " + allTasks.length + " task(s)";
    if (parts.length) text += " · " + parts.join(" · ");
    return text;
  }

  function setAlert(message, kind) {
    var node = el("kanban-alert");
    if (!node) return;
    node.className = message ? "board-alert" : "";
    node.textContent = message || "";
  }

  function renderBoardError() {
    var board = el("kanban-board");
    if (!board) return;
    if (allTasks.length > 0) { renderKanban(); return; }
    board.innerHTML = '<div class="board-alert" role="alert"><span>' + escapeHtml(tasksError || "Could not load tasks.") + '</span><button class="btn" id="kanban-retry">Retry</button></div>';
    var retry = el("kanban-retry");
    if (retry) retry.addEventListener("click", function () { loadTasks(true); });
  }

  function loadTasks(showLoading) {
    var requestId = ++taskRequestId;
    var board = el("kanban-board");
    if (showLoading && board && allTasks.length === 0) board.innerHTML = '<div class="kempty">Loading tasks...</div>';
    return fetch("/api/tasks", { headers: { "Accept": "application/json" } })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = {};
          try { data = text ? JSON.parse(text) : {}; } catch (e) { throw new Error("Invalid task response"); }
          if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
          if (!Array.isArray(data.tasks)) throw new Error("Task response has no tasks array");
          if (requestId !== taskRequestId) return false;
          allTasks = data.tasks;
          tasksError = null;
          renderKanban();
          return true;
        });
      })
      .catch(function (error) {
        if (requestId !== taskRequestId) return false;
        tasksError = error && error.message ? error.message : String(error);
        renderBoardError();
        return false;
      });
  }

  function badge(label, className, title) {
    return '<span class="kbadge ' + escapeHtml(className || "") + '"' + (title ? ' title="' + escapeHtml(title) + '"' : "") + '>' + escapeHtml(label) + '</span>';
  }

  function renderKanban() {
    var board = el("kanban-board");
    if (!board) return;
    var f = getFilters();
    var visible = applyFilters();
    var pending = allTasks.filter(function (task) { return task.integration_status === "pending"; }).length;
    var awaitingChange = allTasks.filter(function (task) {
      return task.change_id && (task.change_status === "DRAFT" || task.change_status === "PROPOSED");
    }).length;
    var counter = el("task-pending");
    if (counter) {
      var parts = [];
      if (pending > 0) parts.push(pending + " task(s) pending integration");
      if (awaitingChange > 0) parts.push(awaitingChange + " Change(s) awaiting approval");
      counter.textContent = parts.join(" · ");
    }
    var resultNode = el("kanban-result");
    if (resultNode) resultNode.textContent = filterSummary(f, visible.length);
    var summaryNode = el("kanban-filter-summary");
    if (summaryNode) summaryNode.textContent = f.search || f.link !== "all" || f.integration !== "all" || f.priority !== "all" || f.column !== "all" || f.scope !== "all" ? filterSummary(f, visible.length) : "";

    var html = "";
    if (tasksError) {
      html += '<div class="board-alert" role="alert"><span>' + escapeHtml(tasksError) + '</span><button class="btn" id="kanban-retry">Retry</button></div>';
    }
    html += '<div class="kanban">';
    COLUMN_ORDER.forEach(function (column) {
      var items = visible.filter(function (task) { return taskColumn(task) === column; });
      html += '<div class="kcol" data-column="' + column + '">';
      html += '<div class="kcol-head"><span>' + COLUMN_LABEL[column] + '</span><span class="kcol-count">' + items.length + '</span></div>';
      html += '<div class="kcol-body" data-column="' + column + '">';
      if (items.length === 0) html += '<div class="kempty">No tasks<br><button class="btn link" data-add-task="' + column + '">+ Add task</button></div>';
      items.forEach(function (task) {
        var meta = task.metadata || {};
        var integration = task.integration_status || "manual";
        var priority = task.priority || "medium";
        var approval = task.approval && task.approval.status ? task.approval.status : "PENDING";
        var description = task.description || meta.goal || "";
        html += '<div class="kcard" draggable="true" tabindex="0" role="button" aria-label="' + escapeHtml(task.name + " (" + priority + ", " + columnForStatus(task.status) + ")") + '" data-id="' + escapeHtml(task.id) + '">';
        html += '<div class="kcard-title">' + escapeHtml(task.name) + '</div>';
        html += '<div class="kcard-id">' + escapeHtml(task.id) + '</div>';
        if (description) html += '<div class="kcard-desc">' + escapeHtml(String(description).slice(0, 180)) + '</div>';
        html += '<div class="kcard-meta">';
        html += badge(priority, "", "Priority");
        html += badge(integration === "manual" ? "not requested" : integration, integration, "AI integration status");
        html += badge(approval.toLowerCase(), approval === "APPROVED" ? "approved" : approval === "REJECTED" ? "rejected" : "pending", "Task approval (write gate)");
        if (isTargetBacklog(task)) html += badge("target backlog", "target-backlog", "Backlog to implement in the target project after the stack is chosen");
        if (task.change_id) {
          var draft = !task.change_status || task.change_status === "DRAFT" || task.change_status === "PROPOSED";
          html += badge(task.change_id + " · " + (task.change_status || "DRAFT"), draft ? "change-draft" : "change-approved", "SDD Change (evolution)");
        }
        if (meta.files && meta.files.length) html += badge(meta.files.length + " file(s)", "", "Declared files");
        if ((task.links || []).length) html += badge((task.links || []).length + " link(s)", "", "Linked nodes");
        html += '</div></div>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    board.innerHTML = html;
    wireKanban();
  }

  function wireKanban() {
    var addButtons = document.querySelectorAll("[data-add-task]");
    addButtons.forEach(function (button) {
      button.addEventListener("click", function (e) { e.stopPropagation(); openTaskModal(null); });
    });
    var retry = el("kanban-retry");
    if (retry) retry.addEventListener("click", function () { loadTasks(true); });
    document.querySelectorAll(".kcard").forEach(function (card) {
      card.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", card.getAttribute("data-id"));
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
      card.addEventListener("click", function () {
        var task = allTasks.filter(function (t) { return t.id === card.getAttribute("data-id"); })[0];
        if (task) openTaskModal(task);
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.click();
        }
      });
    });
    document.querySelectorAll(".kcol-body").forEach(function (body) {
      body.addEventListener("dragover", function (e) { e.preventDefault(); body.parentElement.classList.add("drop-target"); });
      body.addEventListener("dragleave", function () { body.parentElement.classList.remove("drop-target"); });
      body.addEventListener("drop", function (e) {
        e.preventDefault();
        body.parentElement.classList.remove("drop-target");
        var id = e.dataTransfer.getData("text/plain");
        var column = body.getAttribute("data-column");
        if (id && column) moveTask(id, column);
      });
    });
  }

  function moveTask(id, column) {
    setAlert("Moving task...", null);
    api("POST", "/api/tasks/" + encodeURIComponent(id), { column: column }).then(function (res) {
      if (!res.ok) { setAlert((res.data && res.data.error) || "Could not move task.", "error"); return; }
      setAlert("", null);
      loadTasks(false);
    }).catch(function (e) { setAlert("Could not move task: " + e, "error"); });
  }

  function showStatus(message, kind) {
    var node = el("task-modal-status");
    if (!node) return;
    node.textContent = message || "";
    node.className = "modal-status" + (kind ? " " + kind : "");
  }

  function updateChangeUi(task) {
    var field = el("task-change-field");
    var button = el("task-change");
    var info = el("task-change-info");
    if (!field || !button || !info) return;
    if (!task) { field.style.display = "none"; button.style.display = "none"; return; }
    button.style.display = "";
    if (!task.change_id) {
      field.style.display = "none";
      info.innerHTML = "";
      button.textContent = "Open SDD Change";
      return;
    }
    var status = task.change_status || "DRAFT";
    var draft = status === "DRAFT" || status === "PROPOSED";
    field.style.display = "";
    info.innerHTML = badge(task.change_id + " · " + status, draft ? "change-draft" : "change-approved");
    button.textContent = draft ? "Approve Change" : "Open Change";
  }

  function formatLinks(task) {
    var node = el("task-links");
    if (!node) return;
    var links = task.links || [];
    if (links.length === 0) { node.textContent = "No linked nodes."; return; }
    node.innerHTML = links.map(function (link) {
      return '<span>' + escapeHtml(link.type) + " " + (link.direction === "incoming" ? "←" : "→") + " " +
        '<a href="#" data-link-node="' + escapeHtml(link.node_id) + '">' + escapeHtml(link.node_id) + '</a>' +
        (link.node_name ? " · " + escapeHtml(link.node_name) : "") + "</span>";
    }).join("");
    node.querySelectorAll("[data-link-node]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var id = this.getAttribute("data-link-node");
        closeTaskModal(true);
        switchView("graph");
        if (typeof selectNode === "function") selectNode(id);
      });
    });
  }

  function snapshotForm() {
    return JSON.stringify({
      name: el("task-name") ? el("task-name").value : "",
      description: el("task-description") ? el("task-description").value : "",
      goal: el("task-goal") ? el("task-goal").value : "",
      files: el("task-files") ? el("task-files").value : "",
      priority: el("task-priority") ? el("task-priority").value : "medium",
      column: el("task-column") ? el("task-column").value : "backlog",
      link: el("task-link") ? el("task-link").value : ""
    });
  }
  function isDirty() { return initialForm !== null && snapshotForm() !== initialForm; }
  function confirmDiscard() {
    return !isDirty() || window.confirm("You have unsaved changes. Continue and discard them?");
  }

  function refreshCurrentTask() {
    return loadTasks(false).then(function (loaded) {
      if (!loaded || !currentTask) return;
      var latest = allTasks.filter(function (task) { return task.id === currentTask.id; })[0];
      if (!latest) return;
      currentTask = latest;
      var version = el("task-version");
      if (version) version.textContent = "v" + latest.version;
      updateChangeUi(latest);
      initialForm = snapshotForm();
    });
  }

  function openTaskModal(task) {
    var modal = el("task-modal");
    if (!modal) return;
    currentTask = task || null;
    modalTrigger = document.activeElement;
    el("task-modal-title").textContent = task ? "Edit task" : "New task";
    el("task-version").textContent = task ? "v" + task.version : "";
    el("task-id").value = task ? task.id : "";
    el("task-name").value = task ? task.name : "";
    el("task-description").value = task && task.description ? task.description : "";
    var meta = (task && task.metadata) || {};
    el("task-goal").value = meta.goal || "";
    var acceptance = meta.acceptance_summary;
    el("task-acceptance").value = acceptance
      ? "Total: " + acceptance.total + " | Pending: " + acceptance.pending + " | Accepted: " + acceptance.accepted + " | Rejected: " + acceptance.rejected
      : "No derived criteria. Link the Task to a Requirement.";
    el("task-files").value = Array.isArray(meta.files) ? meta.files.join(", ") : "";
    el("task-priority").value = task && task.priority ? task.priority : "medium";
    el("task-column").value = task ? taskColumn(task) : "backlog";
    el("task-link").value = "";
    el("task-link-field").style.display = task ? "none" : "";
    el("task-links-field").style.display = task ? "" : "none";
    el("task-integrate").style.display = task ? "" : "none";
    el("task-approve").style.display = task ? "" : "none";
    el("task-reject").style.display = task ? "" : "none";
    el("task-delete").style.display = task ? "" : "none";
    if (task) formatLinks(task); else el("task-links").innerHTML = "";
    updateChangeUi(task);
    showStatus("", null);
    initialForm = snapshotForm();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    var focusTarget = el("task-name");
    if (focusTarget) focusTarget.focus();
  }

  function closeTaskModal(force) {
    var modal = el("task-modal");
    if (!modal || !modal.classList.contains("open")) return;
    if (!force && isDirty() && !window.confirm("Discard unsaved changes?")) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    currentTask = null;
    initialForm = null;
    if (modalTrigger && typeof modalTrigger.focus === "function") modalTrigger.focus();
    modalTrigger = null;
  }

  function taskPayload() {
    if (!currentTask) return null;
    var payload = { expected_version: currentTask.version };
    var changed = false;
    var name = el("task-name").value.trim();
    if (name !== currentTask.name) { payload.name = name; changed = true; }
    var description = el("task-description").value.trim();
    if (description !== (currentTask.description || "")) { payload.description = description; changed = true; }
    var goal = el("task-goal").value.trim();
    if (goal !== String((currentTask.metadata || {}).goal || "")) { payload.goal = goal; changed = true; }
    var files = splitList(el("task-files").value);
    var currentFiles = Array.isArray((currentTask.metadata || {}).files) ? currentTask.metadata.files : [];
    if (!sameList(files, currentFiles)) { payload.files = files; changed = true; }
    if (el("task-priority").value !== (currentTask.priority || "medium")) { payload.priority = el("task-priority").value; changed = true; }
    if (el("task-column").value !== taskColumn(currentTask)) { payload.column = el("task-column").value; changed = true; }
    return changed ? payload : null;
  }

  function setBusy(value) {
    busy = value;
    ["task-save", "task-integrate", "task-approve", "task-reject", "task-change", "task-delete", "task-cancel", "task-close"].forEach(function (id) {
      var node = el(id);
      if (node) node.disabled = value;
    });
  }

  function saveTask() {
    if (busy) return;
    var nameInput = el("task-name");
    var name = nameInput.value.trim();
    if (!name) {
      nameInput.setAttribute("aria-invalid", "true");
      showStatus("Name is required.", "error");
      nameInput.focus();
      return;
    }
    nameInput.removeAttribute("aria-invalid");
    var id = el("task-id").value;
    if (id && !isDirty()) { closeTaskModal(true); return; }
    var payload = id ? taskPayload() : {
      name: name,
      description: el("task-description").value.trim(),
      goal: el("task-goal").value.trim(),
      files: splitList(el("task-files").value),
      priority: el("task-priority").value,
      column: el("task-column").value
    };
    if (id && !payload) { closeTaskModal(true); return; }
    if (!id) {
      var link = el("task-link").value.trim();
      if (link) payload.link_to = link;
    }
    setBusy(true);
    showStatus("Saving...", null);
    api("POST", id ? "/api/tasks/" + encodeURIComponent(id) : "/api/tasks", payload).then(function (res) {
      if (!res.ok) {
        if (res.status === 409) {
          return refreshCurrentTask().then(function () {
            showStatus("This task was updated elsewhere. The latest version was loaded; review your changes and save again.", "error");
          });
        }
        showStatus((res.data && res.data.error) || ("Error " + res.status), "error");
        return;
      }
      return refreshCurrentTask().then(function () {
        showStatus("Saved.", "ok");
      });
    }).catch(function (e) { showStatus("Failed to save: " + e, "error"); })
      .finally(function () { setBusy(false); });
  }

  function deleteTask() {
    var id = el("task-id").value;
    if (!id || busy) return;
    if (!window.confirm("Delete " + id + "? This cannot be undone.")) return;
    setBusy(true);
    showStatus("Deleting...", null);
    api("DELETE", "/api/tasks/" + encodeURIComponent(id)).then(function (res) {
      if (!res.ok) { showStatus((res.data && res.data.error) || "Delete failed", "error"); return; }
      return loadTasks(false).then(function () { closeTaskModal(true); setAlert("Task deleted.", null); });
    }).catch(function (e) { showStatus("Failed: " + e, "error"); })
      .finally(function () { setBusy(false); });
  }

  function openChange() {
    var id = el("task-id").value;
    if (!id || busy) return;
    if (!confirmDiscard()) return;
    var meta = (currentTask && currentTask.metadata) || {};
    var status = (currentTask && currentTask.change_status) || "DRAFT";
    var approve = !!currentTask.change_id && (status === "DRAFT" || status === "PROPOSED");
    if (approve && !window.confirm("Approve this Change? It records evolution/audit; task approval remains the write gate.")) return;
    setBusy(true);
    showStatus(approve ? "Approving Change..." : "Opening Change...", null);
    api("POST", "/api/tasks/" + encodeURIComponent(id) + "/change", approve ? { approve: true } : {}).then(function (res) {
      if (!res.ok) { showStatus((res.data && res.data.error) || ("Error " + res.status), "error"); return; }
      var change = (res.data && res.data.change) || {};
      var integration = (res.data && res.data.integration) || {};
      var blockers = (res.data && res.data.blockers) || [];
      var detail = blockers.length ? blockers[0] : (integration.reason || "");
      showStatus((change.id ? change.id + " · " + change.status + ". " : "") + detail, blockers.length ? "error" : "ok");
      return refreshCurrentTask();
    }).catch(function (e) { showStatus("Failed: " + e, "error"); })
      .finally(function () { setBusy(false); });
  }

  function approveCurrentTask(approve) {
    var id = el("task-id").value;
    if (!id || busy) return;
    if (!confirmDiscard()) return;
    if (!approve && !window.confirm("Reject this task? Its files remain blocked.")) return;
    setBusy(true);
    showStatus(approve ? "Approving task..." : "Rejecting task...", null);
    api("POST", "/api/tasks/" + encodeURIComponent(id) + (approve ? "/approve" : "/reject"), {}).then(function (res) {
      if (!res.ok) { showStatus((res.data && res.data.error) || ("Error " + res.status), "error"); return; }
      return refreshCurrentTask().then(function () {
        showStatus(approve ? "Task approved. Declared files are writable." : "Task rejected.", "ok");
      });
    }).catch(function (e) { showStatus("Failed: " + e, "error"); })
      .finally(function () { setBusy(false); });
  }

  function integrateTask() {
    var id = el("task-id").value;
    if (!id || busy) return;
    if (!confirmDiscard()) return;
    setBusy(true);
    showStatus("Requesting integration...", null);
    api("POST", "/api/tasks/" + encodeURIComponent(id) + "/integrate", {}).then(function (res) {
      var integration = (res.data && res.data.integration) || {};
      showStatus(integration.reason || "Integration requested.", integration.queued ? "ok" : null);
      return refreshCurrentTask();
    }).catch(function (e) { showStatus("Failed: " + e, "error"); })
      .finally(function () { setBusy(false); });
  }

  function onFilterChange() { readToolbar(); renderKanban(); }
  var debounceTimer = null;
  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { readToolbar(); renderKanban(); }, 200);
  }

  function switchView(view) {
    var graph = el("graph-view");
    var kanban = el("kanban-view");
    if (!graph || !kanban) return;
    var showKanban = view === "kanban";
    graph.style.display = showKanban ? "none" : "";
    kanban.style.display = showKanban ? "block" : "none";
    document.querySelectorAll(".tab").forEach(function (tab) {
      var active = tab.getAttribute("data-view") === view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
    if (showKanban) loadTasks(false);
    else if (typeof fg !== "undefined" && fg) {
      var container = el("graph-container");
      if (container) { fg.width(container.offsetWidth); fg.height(container.offsetHeight); }
    }
  }

  function trapFocus(event) {
    var modal = el("task-modal");
    if (!modal || !modal.classList.contains("open")) return;
    if (event.key === "Escape") { event.preventDefault(); closeTaskModal(false); return; }
    if (event.key !== "Tab") return;
    var focusable = modal.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  window.renderKanban = renderKanban;
  window.loadTasks = loadTasks;
  window.switchView = switchView;

  document.addEventListener("DOMContentLoaded", function () {
    renderToolbar();
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", tab.classList.contains("active") ? "true" : "false");
      tab.tabIndex = tab.classList.contains("active") ? 0 : -1;
      tab.addEventListener("click", function () { switchView(tab.getAttribute("data-view")); });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
        var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
        var index = tabs.indexOf(tab);
        if (e.key === "ArrowRight") index = (index + 1) % tabs.length;
        else if (e.key === "ArrowLeft") index = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") index = 0;
        else index = tabs.length - 1;
        e.preventDefault();
        tabs[index].focus();
        switchView(tabs[index].getAttribute("data-view"));
      });
    });
    var add = el("kanban-add");
    if (add) add.addEventListener("click", function () { openTaskModal(null); });
    var save = el("task-save");
    if (save) save.addEventListener("click", saveTask);
    var cancel = el("task-cancel");
    if (cancel) cancel.addEventListener("click", function () { closeTaskModal(false); });
    var close = el("task-close");
    if (close) close.addEventListener("click", function () { closeTaskModal(false); });
    var del = el("task-delete");
    if (del) del.addEventListener("click", deleteTask);
    var integrate = el("task-integrate");
    if (integrate) integrate.addEventListener("click", integrateTask);
    var approve = el("task-approve");
    if (approve) approve.addEventListener("click", function () { approveCurrentTask(true); });
    var reject = el("task-reject");
    if (reject) reject.addEventListener("click", function () { approveCurrentTask(false); });
    var change = el("task-change");
    if (change) change.addEventListener("click", openChange);
    var backdrop = el("task-modal");
    if (backdrop) {
      backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeTaskModal(false); });
      backdrop.addEventListener("keydown", trapFocus);
    }
    var search = el("kanban-search");
    if (search) search.addEventListener("input", onSearchInput);
    ["kanban-filter-link", "kanban-filter-integration", "kanban-filter-priority", "kanban-filter-column", "kanban-filter-scope", "kanban-sort", "kanban-order"].forEach(function (id) {
      var node = el(id);
      if (node) node.addEventListener("change", onFilterChange);
    });
    var reset = el("kanban-reset-filters");
    if (reset) reset.addEventListener("click", function () {
      saveFilters({});
      renderToolbar();
      renderKanban();
    });
    loadTasks(true);
  });
})();
`
