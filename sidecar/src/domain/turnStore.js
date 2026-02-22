"use strict";

const DEFAULT_CODEX_SOFT_TIMEOUT_MS = 60000;
const DEFAULT_CODEX_HARD_TIMEOUT_MS = 200000;
const DEFAULT_COMPILE_TIMEOUT_MS = 120000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 10000;
const DEFAULT_MAX_AUTO_FIX_ATTEMPTS = 1;
const MAX_TURN_EVENTS = 200;

class TurnStore {
  /**
   * @param {{
   *  codexSoftTimeoutMs?: number,
   *  codexHardTimeoutMs?: number,
   *  compileTimeoutMs?: number,
   *  cacheTtlMs?: number,
   *  maintenanceIntervalMs?: number,
   *  maxAutoFixAttempts?: number,
   *  snapshotStore?: { loadSnapshot: () => any, saveSnapshot: (snapshot: any) => boolean }
   * }} [options]
   */
  constructor(options) {
    const opts = options || {};
    this.codexSoftTimeoutMs = toPositiveNumber(
      opts.codexSoftTimeoutMs,
      DEFAULT_CODEX_SOFT_TIMEOUT_MS
    );
    this.codexHardTimeoutMs = toPositiveNumber(
      opts.codexHardTimeoutMs,
      DEFAULT_CODEX_HARD_TIMEOUT_MS
    );
    if (this.codexHardTimeoutMs < this.codexSoftTimeoutMs) {
      this.codexHardTimeoutMs = this.codexSoftTimeoutMs;
    }
    // Legacy alias used by older call sites/options.
    this.codexTimeoutMs = this.codexSoftTimeoutMs;
    this.compileTimeoutMs = toPositiveNumber(
      opts.compileTimeoutMs,
      DEFAULT_COMPILE_TIMEOUT_MS
    );
    this.cacheTtlMs = toPositiveNumber(opts.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.maintenanceIntervalMs = toPositiveNumber(
      opts.maintenanceIntervalMs,
      DEFAULT_MAINTENANCE_INTERVAL_MS
    );
    this.maxAutoFixAttempts = toNonNegativeNumber(
      opts.maxAutoFixAttempts,
      DEFAULT_MAX_AUTO_FIX_ATTEMPTS
    );
    this.snapshotStore = opts.snapshotStore || null;

    /** @type {string | null} */
    this.currentActiveRequestId = null;

    /** @type {Map<string, TurnEntry>} */
    this.turns = new Map();

    /** @type {NodeJS.Timeout | null} */
    this.maintenanceTimer = null;
    /** @type {((details: { requestId: string, stage: string, phase: string, errorCode: string, reason: string, message: string, timestamp: number }) => void) | null} */
    this.timeoutAbortHandler = null;

    this.restoreFromSnapshot();
  }

  startMaintenance() {
    if (this.maintenanceTimer) {
      return;
    }
    this.maintenanceTimer = setInterval(() => {
      this.sweep();
    }, this.maintenanceIntervalMs);
  }

  stopMaintenance() {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
  }

  setTimeoutAbortHandler(handler) {
    this.timeoutAbortHandler = typeof handler === "function" ? handler : null;
    return this.timeoutAbortHandler !== null;
  }

  sweep() {
    const now = Date.now();
    let changed = false;

    /** @type {string[]} */
    const removeIds = [];
    for (const [requestId, entry] of this.turns.entries()) {
      if (entry.state === "running") {
        if (
          entry.stage === "codex_pending" &&
          entry.phase !== "final"
        ) {
          if (isExpired(entry.codex_hard_deadline_at, now)) {
            this.notifyTimeoutAbort(requestId, entry, {
              errorCode: "E_CODEX_TIMEOUT",
              reason: "codex_hard_timeout",
              message: `Codex request timed out after ${this.codexHardTimeoutMs}ms`,
              timestamp: now,
            });
            this.failTurn(
              requestId,
              "E_CODEX_TIMEOUT",
              `Codex request timed out after ${this.codexHardTimeoutMs}ms`
            );
            changed = true;
            continue;
          }
          if (isExpired(entry.codex_deadline_at, now)) {
            this.notifyTimeoutAbort(requestId, entry, {
              errorCode: "E_CODEX_TIMEOUT",
              reason: "codex_soft_timeout",
              message: `Codex request timed out after ${this.codexSoftTimeoutMs}ms without progress`,
              timestamp: now,
            });
            this.failTurn(
              requestId,
              "E_CODEX_TIMEOUT",
              `Codex request timed out after ${this.codexSoftTimeoutMs}ms without progress`
            );
            changed = true;
            continue;
          }
        }

        if (
          entry.stage === "compile_pending" &&
          isExpired(entry.compile_deadline_at, now)
        ) {
          this.notifyTimeoutAbort(requestId, entry, {
            errorCode: "E_COMPILE_TIMEOUT",
            reason: "compile_timeout",
            message: `Compile wait timed out after ${this.compileTimeoutMs}ms`,
            timestamp: now,
          });
          this.failTurn(
            requestId,
            "E_COMPILE_TIMEOUT",
            `Compile wait timed out after ${this.compileTimeoutMs}ms`
          );
          changed = true;
          continue;
        }
      }

      if (isTerminalState(entry.state) && isExpired(entry.expires_at, now)) {
        if (this.currentActiveRequestId === requestId) {
          this.currentActiveRequestId = null;
        }
        removeIds.push(requestId);
        changed = true;
      }
    }

    for (const requestId of removeIds) {
      this.turns.delete(requestId);
    }

    if (changed) {
      this.persist();
    }
  }

  notifyTimeoutAbort(requestId, entry, details) {
    if (typeof this.timeoutAbortHandler !== "function") {
      return;
    }
    const payload = details && typeof details === "object" ? details : {};
    try {
      this.timeoutAbortHandler({
        requestId: requestId || "",
        stage: entry && typeof entry.stage === "string" ? entry.stage : "",
        phase: entry && typeof entry.phase === "string" ? entry.phase : "",
        errorCode: payload.errorCode || "E_INTERNAL",
        reason: payload.reason || "timeout",
        message: payload.message || "turn timed out",
        timestamp:
          Number.isFinite(payload.timestamp) && payload.timestamp > 0
            ? Number(payload.timestamp)
            : Date.now(),
      });
    } catch {
      // ignore callback errors from upper layers
    }
  }

  getActiveRequestId() {
    return this.currentActiveRequestId;
  }

  getActiveState() {
    if (!this.currentActiveRequestId) {
      return "idle";
    }
    const entry = this.turns.get(this.currentActiveRequestId);
    if (!entry) {
      return "unknown";
    }
    return entry.stage || entry.state;
  }

  getTurn(requestId) {
    if (!requestId) {
      return null;
    }

    const entry = this.turns.get(requestId) || null;
    if (!entry) {
      return null;
    }

    if (isTerminalState(entry.state) && isExpired(entry.expires_at, Date.now())) {
      this.turns.delete(requestId);
      if (this.currentActiveRequestId === requestId) {
        this.currentActiveRequestId = null;
      }
      this.persist();
      return null;
    }

    return entry;
  }

  hasOtherActiveTurn(requestId) {
    return !!(
      this.currentActiveRequestId && this.currentActiveRequestId !== requestId
    );
  }

  appendEvent(requestId, eventName, payload, options) {
    const entry = this.turns.get(requestId);
    if (!entry) {
      return 0;
    }
    const seq = this.appendEventToEntry(entry, eventName, payload);
    if (!options || options.persist !== false) {
      this.persist();
    }
    return seq;
  }

  buildTurnStatus(entry, options) {
    const cursor = options && Number.isFinite(options.cursor) ? Number(options.cursor) : 0;
    const events = cloneTurnEventsSince(entry.events, cursor);
    const latestEventSeq = getLatestEventSeq(entry.events);
    return {
      request_id: entry.request_id,
      state: entry.state,
      event: entry.event,
      message: entry.message,
      error_code: entry.error_code || "",
      stage: entry.stage || "",
      phase: entry.phase || "",
      pending_visual_action_count: getPendingVisualActionCount(entry),
      pending_visual_action: getPendingVisualAction(entry),
      execution_report: cloneExecutionReport(entry.execution_report),
      events,
      latest_event_seq: latestEventSeq,
      auto_fix_attempts: entry.auto_fix_attempts || 0,
      max_auto_fix_attempts: entry.max_auto_fix_attempts || this.maxAutoFixAttempts,
      updated_at: new Date(entry.updated_at).toISOString(),
    };
  }

  startTurn(requestId, autoCompleteMs) {
    const now = Date.now();
    const entry = {
      request_id: requestId,
      state: "running",
      event: "turn.running",
      message: "Turn accepted and running",
      error_code: "",
      stage: "codex_pending",
      phase: "planning",
      started_at: now,
      updated_at: now,
      codex_deadline_at: now + this.codexSoftTimeoutMs,
      codex_hard_deadline_at: now + this.codexHardTimeoutMs,
      compile_deadline_at: 0,
      visual_layer_actions: [],
      pending_action_index: 0,
      events: [],
      next_event_seq: 1,
      auto_fix_attempts: 0,
      max_auto_fix_attempts: this.maxAutoFixAttempts,
      last_failure_code: "",
      last_failure_message: "",
      execution_report: null,
      expires_at: 0,
      timer: null,
    };

    const autoComplete = Number(autoCompleteMs);
    if (Number.isFinite(autoComplete) && autoComplete > 0) {
      entry.timer = setTimeout(() => {
        this.completeTurn(requestId, "Turn completed");
      }, autoComplete);
    }

    this.turns.set(requestId, entry);
    this.appendEventToEntry(entry, "turn.running", {
      phase: "planning",
      message: "Turn accepted and running",
      stage: entry.stage,
    });
    this.currentActiveRequestId = requestId;
    this.persist();
    return entry;
  }

  setCompilePending(requestId, visualLayerActions) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return false;
    }

    clearEntryTimer(entry);
    entry.stage = "compile_pending";
    entry.phase = "planning";
    entry.event = "turn.running";
    entry.message = "Waiting for compile result";
    entry.error_code = "";
    entry.compile_deadline_at = Date.now() + this.compileTimeoutMs;
    entry.visual_layer_actions = cloneVisualActions(visualLayerActions);
    entry.pending_action_index = 0;
    entry.updated_at = Date.now();
    this.appendEventToEntry(entry, "turn.running", {
      phase: entry.phase,
      message: entry.message,
      stage: entry.stage,
    });
    this.persist();
    return true;
  }

  setCodexPending(requestId, options) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return false;
    }

    const opts = options && typeof options === "object" ? options : {};
    const now = Date.now();
    entry.stage = "codex_pending";
    entry.phase =
      opts.phase === "final" || opts.phase === "planning"
        ? opts.phase
        : entry.phase || "planning";
    entry.event = "turn.running";
    entry.message =
      typeof opts.message === "string" && opts.message
        ? opts.message
        : "Waiting for Codex response";
    entry.error_code = "";
    const hardDeadline =
      Number.isFinite(opts.codex_hard_deadline_at) &&
      opts.codex_hard_deadline_at > now
        ? Number(opts.codex_hard_deadline_at)
        : now + this.codexHardTimeoutMs;
    const softDeadlineCandidate =
      Number.isFinite(opts.codex_soft_deadline_at) &&
      opts.codex_soft_deadline_at > now
        ? Number(opts.codex_soft_deadline_at)
        : Number.isFinite(opts.codex_deadline_at) && opts.codex_deadline_at > now
          ? Number(opts.codex_deadline_at)
          : now + this.codexSoftTimeoutMs;
    entry.codex_hard_deadline_at = hardDeadline;
    entry.codex_deadline_at =
      softDeadlineCandidate > hardDeadline ? hardDeadline : softDeadlineCandidate;
    entry.updated_at = now;
    this.appendEventToEntry(entry, "turn.running", {
      phase: entry.phase,
      message: entry.message,
      stage: entry.stage,
    });
    this.persist();
    return true;
  }

  touchCodexHeartbeat(requestId, options) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running" || entry.stage !== "codex_pending") {
      return false;
    }

    const opts = options && typeof options === "object" ? options : {};
    const now = Date.now();
    const hardDeadline =
      Number.isFinite(entry.codex_hard_deadline_at) &&
      entry.codex_hard_deadline_at > now
        ? Number(entry.codex_hard_deadline_at)
        : now + this.codexHardTimeoutMs;
    const softTimeoutMs =
      Number.isFinite(opts.softTimeoutMs) && opts.softTimeoutMs > 0
        ? Number(opts.softTimeoutMs)
        : this.codexSoftTimeoutMs;
    const nextSoft = now + softTimeoutMs;
    entry.codex_deadline_at = nextSoft > hardDeadline ? hardDeadline : nextSoft;
    entry.updated_at = now;
    if (opts.persist === true) {
      this.persist();
    }
    return true;
  }

  setActionConfirmPending(requestId, visualLayerActions) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return false;
    }

    if (Array.isArray(visualLayerActions)) {
      entry.visual_layer_actions = cloneVisualActions(visualLayerActions);
      entry.pending_action_index = 0;
    }

    entry.stage = "action_confirm_pending";
    entry.phase = "planning";
    entry.event = "turn.running";
    entry.message = "Waiting for action confirmation";
    entry.error_code = "";
    entry.updated_at = Date.now();
    this.appendEventToEntry(entry, "turn.running", {
      phase: entry.phase,
      message: entry.message,
      stage: entry.stage,
    });
    this.persist();
    return true;
  }

  setActionExecuting(requestId) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return false;
    }

    entry.stage = "action_executing";
    entry.phase = "planning";
    entry.event = "turn.running";
    entry.message = "Executing visual action";
    entry.error_code = "";
    entry.updated_at = Date.now();
    this.appendEventToEntry(entry, "turn.running", {
      phase: entry.phase,
      message: entry.message,
      stage: entry.stage,
    });
    this.persist();
    return true;
  }

  beginAutoFixAttempt(requestId, errorCode, message) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return {
        ok: false,
        reachedLimit: false,
        attempts: entry ? entry.auto_fix_attempts || 0 : 0,
        maxAttempts: entry ? entry.max_auto_fix_attempts || this.maxAutoFixAttempts : this.maxAutoFixAttempts,
      };
    }

    const currentAttempts = numberOrZero(entry.auto_fix_attempts);
    const maxAttempts = toNonNegativeNumber(entry.max_auto_fix_attempts, this.maxAutoFixAttempts);
    if (currentAttempts >= maxAttempts) {
      return {
        ok: false,
        reachedLimit: true,
        attempts: currentAttempts,
        maxAttempts,
      };
    }

    entry.auto_fix_attempts = currentAttempts + 1;
    entry.stage = "auto_fix_pending";
    entry.phase = "planning";
    entry.event = "turn.running";
    entry.message = message || "Auto-fix pending";
    entry.error_code = errorCode || "";
    entry.last_failure_code = errorCode || "";
    entry.last_failure_message = message || "";
    entry.updated_at = Date.now();
    this.appendEventToEntry(entry, "turn.running", {
      phase: entry.phase,
      message: entry.message,
      error_code: entry.error_code,
      stage: entry.stage,
    });
    this.persist();

    return {
      ok: true,
      reachedLimit: false,
      attempts: entry.auto_fix_attempts,
      maxAttempts,
    };
  }

  getPendingVisualAction(requestId) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return null;
    }
    if (!Array.isArray(entry.visual_layer_actions)) {
      return null;
    }
    return entry.visual_layer_actions[entry.pending_action_index] || null;
  }

  getRemainingVisualActions(requestId) {
    const entry = this.turns.get(requestId);
    if (!entry || !Array.isArray(entry.visual_layer_actions)) {
      return [];
    }
    const index = Number.isFinite(entry.pending_action_index)
      ? entry.pending_action_index
      : 0;
    return cloneVisualActions(entry.visual_layer_actions.slice(index));
  }

  replacePendingVisualAction(requestId, action) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running" || !action || typeof action !== "object") {
      return false;
    }
    if (!Array.isArray(entry.visual_layer_actions)) {
      return false;
    }
    const index = Number.isFinite(entry.pending_action_index)
      ? entry.pending_action_index
      : 0;
    if (index < 0 || index >= entry.visual_layer_actions.length) {
      return false;
    }

    entry.visual_layer_actions[index] = { ...action };
    entry.updated_at = Date.now();
    this.persist();
    return true;
  }

  markCurrentVisualActionHandled(requestId) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return false;
    }
    const current = this.getPendingVisualAction(requestId);
    if (!current) {
      return false;
    }

    entry.pending_action_index += 1;
    entry.updated_at = Date.now();
    this.persist();
    return true;
  }

  completeTurn(requestId, message, meta) {
    const entry = this.turns.get(requestId);
    if (!entry || entry.state !== "running") {
      return;
    }

    const extras = meta && typeof meta === "object" ? meta : {};
    clearEntryTimer(entry);
    entry.state = "completed";
    entry.event = "turn.completed";
    entry.message = message || "Turn completed";
    entry.error_code = "";
    entry.stage = "completed";
    entry.phase = "final";
    entry.visual_layer_actions = [];
    entry.pending_action_index = 0;
    entry.execution_report = cloneExecutionReport(extras.execution_report);
    entry.updated_at = Date.now();
    entry.expires_at = Date.now() + this.cacheTtlMs;
    this.appendEventToEntry(entry, "turn.completed", {
      phase: "final",
      message: entry.message,
      stage: entry.stage,
      execution_report: entry.execution_report,
    });

    if (this.currentActiveRequestId === requestId) {
      this.currentActiveRequestId = null;
    }
    this.persist();
  }

  cancelTurn(requestId, message) {
    const entry = this.turns.get(requestId);
    if (!entry) {
      return false;
    }

    clearEntryTimer(entry);
    entry.state = "cancelled";
    entry.event = "turn.cancelled";
    entry.message = message || "Turn cancelled by user";
    entry.error_code = "E_TURN_CANCELLED";
    entry.stage = "cancelled";
    entry.phase = "final";
    entry.visual_layer_actions = [];
    entry.pending_action_index = 0;
    entry.updated_at = Date.now();
    entry.expires_at = Date.now() + this.cacheTtlMs;
    this.appendEventToEntry(entry, "turn.cancelled", {
      phase: "final",
      message: entry.message,
      error_code: entry.error_code,
      stage: entry.stage,
    });

    if (this.currentActiveRequestId === requestId) {
      this.currentActiveRequestId = null;
    }

    this.persist();
    return true;
  }

  failTurn(requestId, errorCode, message, meta) {
    const entry = this.turns.get(requestId);
    if (!entry) {
      return false;
    }

    const extras = meta && typeof meta === "object" ? meta : {};
    clearEntryTimer(entry);
    entry.state = "error";
    entry.event = "turn.error";
    entry.message = message || "Turn failed";
    entry.error_code = errorCode || "E_INTERNAL";
    entry.stage = "error";
    entry.phase = "final";
    entry.visual_layer_actions = [];
    entry.pending_action_index = 0;
    entry.last_failure_code = entry.error_code;
    entry.last_failure_message = entry.message;
    entry.execution_report = cloneExecutionReport(extras.execution_report);
    entry.updated_at = Date.now();
    entry.expires_at = Date.now() + this.cacheTtlMs;
    this.appendEventToEntry(entry, "turn.error", {
      phase: "final",
      message: entry.message,
      error_code: entry.error_code,
      stage: entry.stage,
      execution_report: entry.execution_report,
    });

    if (this.currentActiveRequestId === requestId) {
      this.currentActiveRequestId = null;
    }

    this.persist();
    return true;
  }

  appendEventToEntry(entry, eventName, payload) {
    if (!entry || typeof eventName !== "string" || !eventName) {
      return 0;
    }
    if (!Array.isArray(entry.events)) {
      entry.events = [];
    }
    const nextSeq = Number.isFinite(entry.next_event_seq) && entry.next_event_seq > 0
      ? entry.next_event_seq
      : getLatestEventSeq(entry.events) + 1;
    const data = payload && typeof payload === "object" ? payload : {};
    const event = {
      seq: nextSeq,
      event: eventName,
      timestamp: new Date().toISOString(),
      phase: data.phase || "",
      message: data.message || "",
      delta: data.delta || "",
      role: data.role || "",
      error_code: data.error_code || "",
      stage: data.stage || "",
      task_allocation: cloneTaskAllocation(data.task_allocation),
      files_changed: cloneFileChanges(data.files_changed),
      compile_request: cloneCompileRequest(data.compile_request),
      unity_action_request: cloneUnityActionRequest(data.unity_action_request),
      unity_query_components_request: cloneUnityQueryComponentsRequest(
        data.unity_query_components_request
      ),
      unity_query_components_result: cloneUnityQueryComponentsResult(
        data.unity_query_components_result
      ),
      execution_report: cloneExecutionReport(data.execution_report),
    };
    entry.events.push(event);
    if (entry.events.length > MAX_TURN_EVENTS) {
      entry.events = entry.events.slice(entry.events.length - MAX_TURN_EVENTS);
    }
    entry.next_event_seq = nextSeq + 1;
    entry.updated_at = Date.now();
    return nextSeq;
  }

  getSnapshot() {
    return {
      ok: true,
      timestamp: new Date().toISOString(),
      active_request_id: this.currentActiveRequestId,
      active_state: this.getActiveState(),
      turn_count: this.turns.size,
      turns: Array.from(this.turns.values())
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, 100)
        .map((entry) => this.buildTurnSnapshotItem(entry)),
    };
  }

  persist() {
    if (!this.snapshotStore || typeof this.snapshotStore.saveSnapshot !== "function") {
      return;
    }
    const snapshot = {
      version: 1,
      saved_at: new Date().toISOString(),
      current_active_request_id: this.currentActiveRequestId,
      turns: Array.from(this.turns.values()).map((entry) =>
        this.buildPersistableEntry(entry)
      ),
    };
    this.snapshotStore.saveSnapshot(snapshot);
  }

  restoreFromSnapshot() {
    if (!this.snapshotStore || typeof this.snapshotStore.loadSnapshot !== "function") {
      return;
    }
    const snapshot = this.snapshotStore.loadSnapshot();
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.turns)) {
      return;
    }

    this.turns.clear();
    for (const item of snapshot.turns) {
      if (!item || typeof item !== "object") {
        continue;
      }
      if (typeof item.request_id !== "string" || !item.request_id) {
        continue;
      }
      const entry = {
        request_id: item.request_id,
        state: item.state || "error",
        event: item.event || "turn.error",
        message: item.message || "Recovered turn state",
        error_code: item.error_code || "",
        stage: item.stage || "",
        phase:
          item.phase ||
          (item.state === "running" ? "planning" : "final"),
        started_at: numberOrZero(item.started_at),
        updated_at: numberOrNow(item.updated_at),
        codex_deadline_at: numberOrZero(item.codex_deadline_at),
        codex_hard_deadline_at: numberOrZero(item.codex_hard_deadline_at),
        compile_deadline_at: numberOrZero(item.compile_deadline_at),
        visual_layer_actions: cloneVisualActions(item.visual_layer_actions),
        pending_action_index: numberOrZero(item.pending_action_index),
        events: cloneTurnEvents(item.events),
        next_event_seq: toPositiveNumberOrFallback(item.next_event_seq, getLatestEventSeq(item.events) + 1),
        auto_fix_attempts: numberOrZero(item.auto_fix_attempts),
        max_auto_fix_attempts: toNonNegativeNumber(
          item.max_auto_fix_attempts,
          this.maxAutoFixAttempts
        ),
        last_failure_code: item.last_failure_code || "",
        last_failure_message: item.last_failure_message || "",
        execution_report: cloneExecutionReport(item.execution_report),
        expires_at: numberOrZero(item.expires_at),
        timer: null,
      };
      if (entry.codex_hard_deadline_at <= 0 && entry.codex_deadline_at > 0) {
        entry.codex_hard_deadline_at =
          entry.codex_deadline_at + this.codexHardTimeoutMs;
      }
      this.turns.set(entry.request_id, entry);
    }

    const activeId =
      typeof snapshot.current_active_request_id === "string"
        ? snapshot.current_active_request_id
        : null;
    this.currentActiveRequestId = activeId && this.turns.has(activeId) ? activeId : null;

    const now = Date.now();
    let repaired = false;
    for (const entry of this.turns.values()) {
      if (
        entry &&
        entry.state === "running" &&
        entry.request_id !== this.currentActiveRequestId
      ) {
        entry.state = "error";
        entry.event = "turn.error";
        entry.message = "Recovered stale running turn without active lock";
        entry.error_code = "E_RECOVERY_INCONSISTENT_STATE";
        entry.stage = "error";
        entry.phase = "final";
        entry.visual_layer_actions = [];
        entry.pending_action_index = 0;
        entry.last_failure_code = entry.error_code;
        entry.last_failure_message = entry.message;
        entry.updated_at = now;
        entry.expires_at = now + this.cacheTtlMs;
        this.appendEventToEntry(entry, "turn.error", {
          phase: "final",
          message: entry.message,
          error_code: entry.error_code,
          stage: entry.stage,
        });
        repaired = true;
      }
    }

    if (repaired) {
      this.persist();
    }

    this.sweep();
  }

  buildPersistableEntry(entry) {
    return {
      request_id: entry.request_id,
      state: entry.state,
      event: entry.event,
      message: entry.message,
      error_code: entry.error_code,
      stage: entry.stage,
      phase: entry.phase || "",
      started_at: entry.started_at,
      updated_at: entry.updated_at,
      codex_deadline_at: entry.codex_deadline_at,
      codex_hard_deadline_at: entry.codex_hard_deadline_at,
      compile_deadline_at: entry.compile_deadline_at,
      visual_layer_actions: cloneVisualActions(entry.visual_layer_actions),
      pending_action_index: entry.pending_action_index,
      events: cloneTurnEvents(entry.events),
      next_event_seq: toPositiveNumberOrFallback(
        entry.next_event_seq,
        getLatestEventSeq(entry.events) + 1
      ),
      auto_fix_attempts: numberOrZero(entry.auto_fix_attempts),
      max_auto_fix_attempts: toNonNegativeNumber(
        entry.max_auto_fix_attempts,
        this.maxAutoFixAttempts
      ),
      last_failure_code: entry.last_failure_code || "",
      last_failure_message: entry.last_failure_message || "",
      execution_report: cloneExecutionReport(entry.execution_report),
      expires_at: entry.expires_at,
    };
  }

  buildTurnSnapshotItem(entry) {
    return {
      request_id: entry.request_id,
      state: entry.state,
      event: entry.event,
      message: entry.message,
      error_code: entry.error_code,
      stage: entry.stage,
      phase: entry.phase || "",
      pending_visual_action_count: getPendingVisualActionCount(entry),
      latest_event_seq: getLatestEventSeq(entry.events),
      auto_fix_attempts: numberOrZero(entry.auto_fix_attempts),
      max_auto_fix_attempts: toNonNegativeNumber(
        entry.max_auto_fix_attempts,
        this.maxAutoFixAttempts
      ),
      updated_at: new Date(entry.updated_at).toISOString(),
      expires_at: entry.expires_at
        ? new Date(entry.expires_at).toISOString()
        : "",
    };
  }
}

/**
 * @typedef {{
 *  request_id: string,
 *  state: "running"|"completed"|"cancelled"|"error",
 *  event: string,
 *  message: string,
 *  error_code: string,
 *  stage: string,
 *  phase: string,
 *  started_at: number,
 *  updated_at: number,
 *  codex_deadline_at: number,
 *  codex_hard_deadline_at: number,
 *  compile_deadline_at: number,
 *  visual_layer_actions: Array<any>,
 *  pending_action_index: number,
 *  events: Array<any>,
 *  next_event_seq: number,
 *  auto_fix_attempts: number,
 *  max_auto_fix_attempts: number,
 *  last_failure_code: string,
 *  last_failure_message: string,
 *  execution_report: any,
 *  expires_at: number,
 *  timer: NodeJS.Timeout | null
 * }} TurnEntry
 */

function isTerminalState(state) {
  return state === "completed" || state === "cancelled" || state === "error";
}

function isExpired(deadline, now) {
  return Number.isFinite(deadline) && deadline > 0 && now > deadline;
}

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function toPositiveNumberOrFallback(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function toNonNegativeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return n;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNow(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Date.now();
}

function clearEntryTimer(entry) {
  if (entry && entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function cloneVisualActions(actions) {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }));
}

function cloneTaskAllocation(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    file_actions: cloneFileActions(value.file_actions),
    visual_layer_actions: cloneVisualActions(value.visual_layer_actions),
  };
}

function cloneFileActions(actions) {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }));
}

function cloneFileChanges(changes) {
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }));
}

function cloneCompileRequest(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return { ...value };
}

function cloneUnityActionRequest(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    ...value,
    payload:
      value.payload && typeof value.payload === "object"
        ? {
            ...value.payload,
            action:
              value.payload.action && typeof value.payload.action === "object"
                ? { ...value.payload.action }
                : value.payload.action || null,
          }
        : value.payload || null,
  };
}

function cloneExecutionReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function cloneTurnEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }
  return events
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      seq: numberOrZero(item.seq),
      event: item.event || "",
      timestamp: item.timestamp || "",
      phase: item.phase || "",
      message: item.message || "",
      delta: item.delta || "",
      role: item.role || "",
      error_code: item.error_code || "",
      stage: item.stage || "",
      task_allocation: cloneTaskAllocation(item.task_allocation),
      files_changed: cloneFileChanges(item.files_changed),
      compile_request: cloneCompileRequest(item.compile_request),
      unity_action_request: cloneUnityActionRequest(item.unity_action_request),
      unity_query_components_request: cloneUnityQueryComponentsRequest(
        item.unity_query_components_request
      ),
      unity_query_components_result: cloneUnityQueryComponentsResult(
        item.unity_query_components_result
      ),
      execution_report: cloneExecutionReport(item.execution_report),
    }));
}

function cloneUnityQueryComponentsRequest(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    ...value,
    payload:
      value.payload && typeof value.payload === "object"
        ? {
            ...value.payload,
          }
        : value.payload || null,
  };
}

function cloneUnityQueryComponentsResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    ...value,
    payload:
      value.payload && typeof value.payload === "object"
        ? {
            ...value.payload,
            components: Array.isArray(value.payload.components)
              ? value.payload.components
                  .filter((item) => item && typeof item === "object")
                  .map((item) => ({ ...item }))
              : [],
          }
        : value.payload || null,
  };
}

function cloneTurnEventsSince(events, cursor) {
  const normalized = cloneTurnEvents(events);
  const seq = Number.isFinite(cursor) ? Number(cursor) : 0;
  return normalized.filter((item) => item.seq > seq);
}

function getLatestEventSeq(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return 0;
  }
  let maxSeq = 0;
  for (const event of events) {
    const seq = numberOrZero(event && event.seq);
    if (seq > maxSeq) {
      maxSeq = seq;
    }
  }
  return maxSeq;
}

function getPendingVisualActionCount(entry) {
  if (!entry || !Array.isArray(entry.visual_layer_actions)) {
    return 0;
  }
  const index = Number.isFinite(entry.pending_action_index)
    ? entry.pending_action_index
    : 0;
  const pending = entry.visual_layer_actions.length - index;
  return pending > 0 ? pending : 0;
}

function getPendingVisualAction(entry) {
  if (!entry || !Array.isArray(entry.visual_layer_actions)) {
    return null;
  }
  const index = Number.isFinite(entry.pending_action_index)
    ? entry.pending_action_index
    : 0;
  const action = entry.visual_layer_actions[index];
  if (!action || typeof action !== "object") {
    return null;
  }
  return { ...action };
}

module.exports = {
  TurnStore,
};
