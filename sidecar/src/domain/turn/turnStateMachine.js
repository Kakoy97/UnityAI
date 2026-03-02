"use strict";

function startTurn(store, requestId, autoCompleteMs, deps) {
  const { clearEntryTimer, cloneVisualActions } = deps;
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
    codex_deadline_at: now + store.codexSoftTimeoutMs,
    codex_hard_deadline_at: now + store.codexHardTimeoutMs,
    compile_deadline_at: 0,
    visual_layer_actions: [],
    pending_action_index: 0,
    events: [],
    next_event_seq: 1,
    auto_fix_attempts: 0,
    max_auto_fix_attempts: store.maxAutoFixAttempts,
    last_failure_code: "",
    last_failure_message: "",
    execution_report: null,
    expires_at: 0,
    timer: null,
  };

  const autoComplete = Number(autoCompleteMs);
  if (Number.isFinite(autoComplete) && autoComplete > 0) {
    entry.timer = setTimeout(() => {
      store.completeTurn(requestId, "Turn completed");
    }, autoComplete);
  }

  store.turns.set(requestId, entry);
  store.appendEventToEntry(entry, "turn.running", {
    phase: "planning",
    message: "Turn accepted and running",
    stage: entry.stage,
  });
  store.currentActiveRequestId = requestId;
  store.persist();
  return entry;
}

function setCompilePending(store, requestId, visualLayerActions, deps) {
  const { clearEntryTimer, cloneVisualActions } = deps;
  const entry = store.turns.get(requestId);
  if (!entry || entry.state !== "running") {
    return false;
  }

  clearEntryTimer(entry);
  entry.stage = "compile_pending";
  entry.phase = "planning";
  entry.event = "turn.running";
  entry.message = "Waiting for compile result";
  entry.error_code = "";
  entry.compile_deadline_at = Date.now() + store.compileTimeoutMs;
  entry.visual_layer_actions = cloneVisualActions(visualLayerActions);
  entry.pending_action_index = 0;
  entry.updated_at = Date.now();
  store.appendEventToEntry(entry, "turn.running", {
    phase: entry.phase,
    message: entry.message,
    stage: entry.stage,
  });
  store.persist();
  return true;
}

function setCodexPending(store, requestId, options) {
  const entry = store.turns.get(requestId);
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
    Number.isFinite(opts.codex_hard_deadline_at) && opts.codex_hard_deadline_at > now
      ? Number(opts.codex_hard_deadline_at)
      : now + store.codexHardTimeoutMs;
  const softDeadlineCandidate =
    Number.isFinite(opts.codex_soft_deadline_at) && opts.codex_soft_deadline_at > now
      ? Number(opts.codex_soft_deadline_at)
      : Number.isFinite(opts.codex_deadline_at) && opts.codex_deadline_at > now
        ? Number(opts.codex_deadline_at)
        : now + store.codexSoftTimeoutMs;
  entry.codex_hard_deadline_at = hardDeadline;
  entry.codex_deadline_at =
    softDeadlineCandidate > hardDeadline ? hardDeadline : softDeadlineCandidate;
  entry.updated_at = now;
  store.appendEventToEntry(entry, "turn.running", {
    phase: entry.phase,
    message: entry.message,
    stage: entry.stage,
  });
  store.persist();
  return true;
}

function touchCodexHeartbeat(store, requestId, options) {
  const entry = store.turns.get(requestId);
  if (!entry || entry.state !== "running" || entry.stage !== "codex_pending") {
    return false;
  }

  const opts = options && typeof options === "object" ? options : {};
  const now = Date.now();
  const hardDeadline =
    Number.isFinite(entry.codex_hard_deadline_at) && entry.codex_hard_deadline_at > now
      ? Number(entry.codex_hard_deadline_at)
      : now + store.codexHardTimeoutMs;
  const softTimeoutMs =
    Number.isFinite(opts.softTimeoutMs) && opts.softTimeoutMs > 0
      ? Number(opts.softTimeoutMs)
      : store.codexSoftTimeoutMs;
  const nextSoft = now + softTimeoutMs;
  entry.codex_deadline_at = nextSoft > hardDeadline ? hardDeadline : nextSoft;
  entry.updated_at = now;
  if (opts.persist === true) {
    store.persist();
  }
  return true;
}

function setActionConfirmPending(store, requestId, visualLayerActions, deps) {
  const { cloneVisualActions } = deps;
  const entry = store.turns.get(requestId);
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
  store.appendEventToEntry(entry, "turn.running", {
    phase: entry.phase,
    message: entry.message,
    stage: entry.stage,
  });
  store.persist();
  return true;
}

function setActionExecuting(store, requestId) {
  const entry = store.turns.get(requestId);
  if (!entry || entry.state !== "running") {
    return false;
  }

  entry.stage = "action_executing";
  entry.phase = "planning";
  entry.event = "turn.running";
  entry.message = "Executing visual action";
  entry.error_code = "";
  entry.updated_at = Date.now();
  store.appendEventToEntry(entry, "turn.running", {
    phase: entry.phase,
    message: entry.message,
    stage: entry.stage,
  });
  store.persist();
  return true;
}

function beginAutoFixAttempt(store, requestId, errorCode, message, deps) {
  const { numberOrZero, toNonNegativeNumber } = deps;
  const entry = store.turns.get(requestId);
  if (!entry || entry.state !== "running") {
    return {
      ok: false,
      reachedLimit: false,
      attempts: entry ? entry.auto_fix_attempts || 0 : 0,
      maxAttempts: entry
        ? entry.max_auto_fix_attempts || store.maxAutoFixAttempts
        : store.maxAutoFixAttempts,
    };
  }

  const currentAttempts = numberOrZero(entry.auto_fix_attempts);
  const maxAttempts = toNonNegativeNumber(
    entry.max_auto_fix_attempts,
    store.maxAutoFixAttempts
  );
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
  store.appendEventToEntry(entry, "turn.running", {
    phase: entry.phase,
    message: entry.message,
    error_code: entry.error_code,
    stage: entry.stage,
  });
  store.persist();

  return {
    ok: true,
    reachedLimit: false,
    attempts: entry.auto_fix_attempts,
    maxAttempts,
  };
}

function replacePendingVisualAction(store, requestId, action) {
  const entry = store.turns.get(requestId);
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
  store.persist();
  return true;
}

function markCurrentVisualActionHandled(store, requestId, deps) {
  const { getPendingVisualAction } = deps;
  const entry = store.turns.get(requestId);
  if (!entry || entry.state !== "running") {
    return false;
  }
  const current = getPendingVisualAction(requestId);
  if (!current) {
    return false;
  }
  entry.pending_action_index += 1;
  entry.updated_at = Date.now();
  store.persist();
  return true;
}

function completeTurn(store, requestId, message, meta, deps) {
  const { clearEntryTimer, cloneExecutionReport } = deps;
  const entry = store.turns.get(requestId);
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
  entry.expires_at = Date.now() + store.cacheTtlMs;
  store.appendEventToEntry(entry, "turn.completed", {
    phase: "final",
    message: entry.message,
    stage: entry.stage,
    execution_report: entry.execution_report,
  });
  if (store.currentActiveRequestId === requestId) {
    store.currentActiveRequestId = null;
  }
  store.persist();
}

function cancelTurn(store, requestId, message, deps) {
  const { clearEntryTimer } = deps;
  const entry = store.turns.get(requestId);
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
  entry.expires_at = Date.now() + store.cacheTtlMs;
  store.appendEventToEntry(entry, "turn.cancelled", {
    phase: "final",
    message: entry.message,
    error_code: entry.error_code,
    stage: entry.stage,
  });
  if (store.currentActiveRequestId === requestId) {
    store.currentActiveRequestId = null;
  }
  store.persist();
  return true;
}

function failTurn(store, requestId, errorCode, message, meta, deps) {
  const { clearEntryTimer, cloneExecutionReport } = deps;
  const entry = store.turns.get(requestId);
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
  entry.expires_at = Date.now() + store.cacheTtlMs;
  store.appendEventToEntry(entry, "turn.error", {
    phase: "final",
    message: entry.message,
    error_code: entry.error_code,
    stage: entry.stage,
    execution_report: entry.execution_report,
  });
  if (store.currentActiveRequestId === requestId) {
    store.currentActiveRequestId = null;
  }
  store.persist();
  return true;
}

module.exports = {
  startTurn,
  setCompilePending,
  setCodexPending,
  touchCodexHeartbeat,
  setActionConfirmPending,
  setActionExecuting,
  beginAutoFixAttempt,
  replacePendingVisualAction,
  markCurrentVisualActionHandled,
  completeTurn,
  cancelTurn,
  failTurn,
};

