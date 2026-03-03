"use strict";

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_TOP_N = 10;
const DEFAULT_MAX_PROPERTY_PATH_KEYS = 2048;
const METRICS_SCHEMA_VERSION = "v1_polish_metrics.v1";
const OVERFLOW_PROPERTY_PATH_KEY = "__overflow__";
const ROLLBACK_CODE_PATTERN = /ROLLBACK/i;
const ROLLBACK_TEXT_PATTERN = /\brollback\b/i;
const READ_TOKEN_EXPIRY_PATTERN = /(expired|hard_max_age|exceeded)/i;

const WRITE_KIND = "write";
const GENERALIZED_CLASS = "generalized";
const PRIMITIVE_CLASS = "primitive";
const COMPOSITE_VISUAL_ACTION_TYPE = "composite_visual_action";
const SET_SERIALIZED_PROPERTY_ACTION_TYPE = "set_serialized_property";

const EMPTY_COUNTERS = Object.freeze({
  tool_calls_total: 0,
  write_tool_calls_total: 0,
  task_requests_total: 0,
  generalized_write_total: 0,
  primitive_write_total: 0,
  dry_run_total: 0,
  read_token_checks_total: 0,
  read_token_fail_total: 0,
  read_token_expiry_total: 0,
  write_jobs_finalized_total: 0,
  write_jobs_failed_total: 0,
  write_jobs_rollback_inferred_total: 0,
  property_path_samples_total: 0,
});

function toNonEmptyString(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}

function toPositiveInteger(value, fallback, minValue) {
  const n = Number(value);
  const min = Number.isFinite(Number(minValue)) ? Math.floor(Number(minValue)) : 1;
  if (!Number.isFinite(n) || n < min) {
    return Math.floor(Number(fallback));
  }
  return Math.floor(n);
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = toNonEmptyString(key);
    if (!name) {
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      continue;
    }
    next[name] = Math.floor(n);
  }
  return next;
}

function cloneCounters(value) {
  const source = value && typeof value === "object" ? value : {};
  const next = {};
  for (const key of Object.keys(EMPTY_COUNTERS)) {
    const n = Number(source[key]);
    next[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return next;
}

function createEmptyBucket() {
  return {
    counters: cloneCounters(),
    by_tool: {},
    property_path_frequency: {},
    value_kind_frequency: {},
    array_op_frequency: {},
  };
}

function isValidDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toDayKey(nowMs) {
  const d = new Date(nowMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayKeyToMs(dayKey) {
  return Date.parse(`${dayKey}T00:00:00.000Z`);
}

function copyTopFrequency(map, topN) {
  const entries = Object.entries(map || {})
    .filter(([key, raw]) => toNonEmptyString(key) && Number(raw) > 0)
    .map(([key, raw]) => ({
      key: String(key),
      count: Math.floor(Number(raw)),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.key.localeCompare(b.key);
    });

  const limit = toPositiveInteger(topN, DEFAULT_TOP_N, 1);
  return entries.slice(0, limit);
}

function copyToolBreakdown(map) {
  const source = map && typeof map === "object" ? map : {};
  return Object.entries(source)
    .map(([toolName, raw]) => ({
      tool_name: String(toolName),
      total: Number(raw && raw.total) > 0 ? Math.floor(Number(raw.total)) : 0,
      write_calls:
        Number(raw && raw.write_calls) > 0 ? Math.floor(Number(raw.write_calls)) : 0,
      dry_run_calls:
        Number(raw && raw.dry_run_calls) > 0
          ? Math.floor(Number(raw.dry_run_calls))
          : 0,
      generalized_write_calls:
        Number(raw && raw.generalized_write_calls) > 0
          ? Math.floor(Number(raw.generalized_write_calls))
          : 0,
      primitive_write_calls:
        Number(raw && raw.primitive_write_calls) > 0
          ? Math.floor(Number(raw.primitive_write_calls))
          : 0,
    }))
    .filter((item) => toNonEmptyString(item.tool_name))
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return a.tool_name.localeCompare(b.tool_name);
    });
}

function safeRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function normalizeBucket(value) {
  const source = value && typeof value === "object" ? value : {};
  const counters = cloneCounters(source.counters);
  const byToolSource =
    source.by_tool && typeof source.by_tool === "object" ? source.by_tool : {};
  const byTool = {};
  for (const [toolName, raw] of Object.entries(byToolSource)) {
    const normalizedToolName = toNonEmptyString(toolName);
    if (!normalizedToolName) {
      continue;
    }
    byTool[normalizedToolName] = {
      total: Number(raw && raw.total) > 0 ? Math.floor(Number(raw.total)) : 0,
      write_calls:
        Number(raw && raw.write_calls) > 0 ? Math.floor(Number(raw.write_calls)) : 0,
      dry_run_calls:
        Number(raw && raw.dry_run_calls) > 0
          ? Math.floor(Number(raw.dry_run_calls))
          : 0,
      generalized_write_calls:
        Number(raw && raw.generalized_write_calls) > 0
          ? Math.floor(Number(raw.generalized_write_calls))
          : 0,
      primitive_write_calls:
        Number(raw && raw.primitive_write_calls) > 0
          ? Math.floor(Number(raw.primitive_write_calls))
          : 0,
    };
  }
  return {
    counters,
    by_tool: byTool,
    property_path_frequency: clonePlainObject(source.property_path_frequency),
    value_kind_frequency: clonePlainObject(source.value_kind_frequency),
    array_op_frequency: clonePlainObject(source.array_op_frequency),
  };
}

function aggregateDailyBuckets(dailyBuckets) {
  const source = dailyBuckets && typeof dailyBuckets === "object" ? dailyBuckets : {};
  const counters = cloneCounters();
  const byTool = {};
  const propertyPathFrequency = {};
  const valueKindFrequency = {};
  const arrayOpFrequency = {};

  let windowStartDate = "";
  let windowEndDate = "";

  const keys = Object.keys(source).filter((key) => isValidDayKey(key)).sort();
  for (const dayKey of keys) {
    const bucket = normalizeBucket(source[dayKey]);
    if (!windowStartDate) {
      windowStartDate = dayKey;
    }
    windowEndDate = dayKey;

    for (const key of Object.keys(counters)) {
      counters[key] += Number(bucket.counters[key]) || 0;
    }

    for (const [toolName, item] of Object.entries(bucket.by_tool)) {
      if (!byTool[toolName]) {
        byTool[toolName] = {
          total: 0,
          write_calls: 0,
          dry_run_calls: 0,
          generalized_write_calls: 0,
          primitive_write_calls: 0,
        };
      }
      byTool[toolName].total += Number(item.total) || 0;
      byTool[toolName].write_calls += Number(item.write_calls) || 0;
      byTool[toolName].dry_run_calls += Number(item.dry_run_calls) || 0;
      byTool[toolName].generalized_write_calls +=
        Number(item.generalized_write_calls) || 0;
      byTool[toolName].primitive_write_calls +=
        Number(item.primitive_write_calls) || 0;
    }

    mergeFrequencyMap(propertyPathFrequency, bucket.property_path_frequency);
    mergeFrequencyMap(valueKindFrequency, bucket.value_kind_frequency);
    mergeFrequencyMap(arrayOpFrequency, bucket.array_op_frequency);
  }

  return {
    counters,
    by_tool: byTool,
    property_path_frequency: propertyPathFrequency,
    value_kind_frequency: valueKindFrequency,
    array_op_frequency: arrayOpFrequency,
    window_start_date: windowStartDate,
    window_end_date: windowEndDate,
  };
}

function mergeFrequencyMap(target, source) {
  const nextTarget = target && typeof target === "object" ? target : {};
  const nextSource = source && typeof source === "object" ? source : {};
  for (const [key, raw] of Object.entries(nextSource)) {
    const name = toNonEmptyString(key);
    const n = Number(raw);
    if (!name || !Number.isFinite(n) || n <= 0) {
      continue;
    }
    nextTarget[name] = (Number(nextTarget[name]) || 0) + Math.floor(n);
  }
  return nextTarget;
}

function buildDefaultV1PolishMetricsSnapshot(options) {
  const opts = options && typeof options === "object" ? options : {};
  const nowMs =
    Number.isFinite(Number(opts.nowMs)) && Number(opts.nowMs) > 0
      ? Math.floor(Number(opts.nowMs))
      : Date.now();
  const retentionDays = toPositiveInteger(
    opts.retentionDays,
    DEFAULT_RETENTION_DAYS,
    1
  );
  const enabled = opts.enabled !== false;
  const storageMode = toNonEmptyString(opts.storageMode) || "memory";
  const storagePath = toNonEmptyString(opts.storagePath);

  return {
    schema_version: METRICS_SCHEMA_VERSION,
    enabled,
    retention_days: retentionDays,
    window_start_date: "",
    window_end_date: "",
    updated_at: new Date(nowMs).toISOString(),
    storage: {
      mode: storageMode,
      path: storagePath,
    },
    counters: cloneCounters(),
    derived: {
      avg_tool_calls_per_task: 0,
      write_rollback_rate: 0,
      read_token_expiry_rate: 0,
      dry_run_usage_rate: 0,
    },
    by_tool: [],
    top_property_paths: [],
    top_value_kinds: [],
    top_array_ops: [],
  };
}

function buildV1PolishMetricsSnapshot(input) {
  const source = input && typeof input === "object" ? input : {};
  const nowMs =
    Number.isFinite(Number(source.nowMs)) && Number(source.nowMs) > 0
      ? Math.floor(Number(source.nowMs))
      : Date.now();
  const enabled = source.enabled !== false;
  const retentionDays = toPositiveInteger(
    source.retentionDays,
    DEFAULT_RETENTION_DAYS,
    1
  );
  const storageMode = toNonEmptyString(source.storageMode) || "memory";
  const storagePath = toNonEmptyString(source.storagePath);
  const topN = toPositiveInteger(source.topN, DEFAULT_TOP_N, 1);
  const aggregate = aggregateDailyBuckets(source.dailyBuckets);

  const counters = cloneCounters(aggregate.counters);
  const snapshot = buildDefaultV1PolishMetricsSnapshot({
    nowMs,
    enabled,
    retentionDays,
    storageMode,
    storagePath,
  });
  snapshot.window_start_date = aggregate.window_start_date || "";
  snapshot.window_end_date = aggregate.window_end_date || "";
  snapshot.counters = counters;
  snapshot.derived = {
    avg_tool_calls_per_task: safeRatio(
      counters.tool_calls_total,
      counters.task_requests_total
    ),
    write_rollback_rate: safeRatio(
      counters.write_jobs_rollback_inferred_total,
      counters.write_jobs_finalized_total
    ),
    read_token_expiry_rate: safeRatio(
      counters.read_token_expiry_total,
      counters.read_token_checks_total
    ),
    dry_run_usage_rate: safeRatio(
      counters.dry_run_total,
      counters.write_tool_calls_total
    ),
  };
  snapshot.by_tool = copyToolBreakdown(aggregate.by_tool);
  snapshot.top_property_paths = copyTopFrequency(
    aggregate.property_path_frequency,
    topN
  ).map((item) => ({
    property_path: item.key,
    count: item.count,
  }));
  snapshot.top_value_kinds = copyTopFrequency(
    aggregate.value_kind_frequency,
    topN
  ).map((item) => ({
    value_kind: item.key,
    count: item.count,
  }));
  snapshot.top_array_ops = copyTopFrequency(aggregate.array_op_frequency, topN).map(
    (item) => ({
      op: item.key,
      count: item.count,
    })
  );
  return snapshot;
}

function resolveWriteClass(commandName, payload) {
  const name = toNonEmptyString(commandName);
  if (!name) {
    return "";
  }
  if (name === "set_serialized_property") {
    return GENERALIZED_CLASS;
  }
  if (
    name === "apply_visual_actions" ||
    name === "submit_unity_task"
  ) {
    const actions =
      name === "apply_visual_actions"
        ? (payload && Array.isArray(payload.actions) ? payload.actions : [])
        : payload && Array.isArray(payload.visual_layer_actions)
          ? payload.visual_layer_actions
          : [];
    if (actions.length > 0 && actions.every(isSerializedPropertyAction)) {
      return GENERALIZED_CLASS;
    }
    return PRIMITIVE_CLASS;
  }
  if (
    name === "apply_script_actions" ||
    name === "set_ui_properties" ||
    name === "submit_unity_task"
  ) {
    return PRIMITIVE_CLASS;
  }
  return PRIMITIVE_CLASS;
}

function isSerializedPropertyAction(action) {
  if (!action || typeof action !== "object") {
    return false;
  }
  return toNonEmptyString(action.type) === SET_SERIALIZED_PROPERTY_ACTION_TYPE;
}

function extractSerializedPatches(commandName, payload) {
  const name = toNonEmptyString(commandName);
  const body = payload && typeof payload === "object" ? payload : {};

  if (name === "set_serialized_property") {
    return Array.isArray(body.patches) ? body.patches : [];
  }

  if (name === "apply_visual_actions") {
    return collectPatchesFromVisualActions(body.actions);
  }

  if (name === "submit_unity_task") {
    return collectPatchesFromVisualActions(body.visual_layer_actions);
  }

  return [];
}

function collectPatchesFromVisualActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  const patches = [];
  for (const action of list) {
    if (!isSerializedPropertyAction(action)) {
      continue;
    }
    const actionData =
      action && action.action_data && typeof action.action_data === "object"
        ? action.action_data
        : {};
    const actionPatches = Array.isArray(actionData.patches) ? actionData.patches : [];
    for (const patch of actionPatches) {
      if (!patch || typeof patch !== "object") {
        continue;
      }
      patches.push(patch);
    }
  }
  return patches;
}

function sanitizePropertyPath(value) {
  return toNonEmptyString(value);
}

function sanitizeValueKind(value) {
  return toNonEmptyString(value).toLowerCase();
}

function sanitizeArrayOp(value) {
  return toNonEmptyString(value).toLowerCase();
}

function isReadTokenExpiryFailure(errorCode, message) {
  const code = toNonEmptyString(errorCode).toUpperCase();
  if (code !== "E_STALE_SNAPSHOT") {
    return false;
  }
  return READ_TOKEN_EXPIRY_PATTERN.test(String(message || ""));
}

function inferRollbackFromFinalState(input) {
  const source = input && typeof input === "object" ? input : {};
  const status = toNonEmptyString(source.status);
  const errorCode = toNonEmptyString(source.error_code);
  const executionReport =
    source.execution_report && typeof source.execution_report === "object"
      ? source.execution_report
      : {};
  const actionError =
    executionReport.action_error && typeof executionReport.action_error === "object"
      ? executionReport.action_error
      : {};
  const actionErrorCode = toNonEmptyString(actionError.error_code);
  const reason = toNonEmptyString(executionReport.reason);
  const runtime = source.runtime && typeof source.runtime === "object" ? source.runtime : {};
  const visualActions = Array.isArray(runtime.visual_actions) ? runtime.visual_actions : [];
  const hasComposite = visualActions.some(
    (item) => toNonEmptyString(item && item.type) === COMPOSITE_VISUAL_ACTION_TYPE
  );

  if (ROLLBACK_CODE_PATTERN.test(errorCode) || ROLLBACK_CODE_PATTERN.test(actionErrorCode)) {
    return true;
  }
  if (ROLLBACK_TEXT_PATTERN.test(reason)) {
    return true;
  }
  if (status === "failed" && hasComposite) {
    return true;
  }
  return false;
}

class V1PolishMetricsCollector {
  constructor(options) {
    const opts = options && typeof options === "object" ? options : {};
    this.enabled = opts.enabled !== false;
    this.retentionDays = toPositiveInteger(
      opts.retentionDays,
      DEFAULT_RETENTION_DAYS,
      1
    );
    this.topN = toPositiveInteger(opts.topN, DEFAULT_TOP_N, 1);
    this.maxPropertyPathKeys = toPositiveInteger(
      opts.maxPropertyPathKeys,
      DEFAULT_MAX_PROPERTY_PATH_KEYS,
      8
    );
    this.storagePath = toNonEmptyString(opts.storagePath);
    this.snapshotStore =
      opts.snapshotStore && typeof opts.snapshotStore.saveSnapshot === "function"
        ? opts.snapshotStore
        : null;
    this.nowMs =
      typeof opts.nowMs === "function" ? opts.nowMs : () => Date.now();
    this.dailyBuckets = {};
    this.updatedAtMs = this.nowMs();

    this.restoreSnapshot();
    this.pruneExpiredBuckets(this.nowMs());
  }

  recordToolInvocation(input) {
    if (!this.enabled) {
      return;
    }
    const source = input && typeof input === "object" ? input : {};
    const commandName = toNonEmptyString(source.command_name);
    const commandKind = toNonEmptyString(source.command_kind).toLowerCase();
    const payload =
      source.payload && typeof source.payload === "object" ? source.payload : {};
    const bucket = this.getCurrentBucket();
    const counters = bucket.counters;
    const toolName = commandName || "unknown";

    counters.tool_calls_total += 1;
    this.bumpToolCounter(bucket.by_tool, toolName, "total");

    if (commandKind === WRITE_KIND) {
      counters.write_tool_calls_total += 1;
      counters.task_requests_total += 1;
      this.bumpToolCounter(bucket.by_tool, toolName, "write_calls");
      const writeClass = resolveWriteClass(commandName, payload);
      if (writeClass === GENERALIZED_CLASS) {
        counters.generalized_write_total += 1;
        this.bumpToolCounter(bucket.by_tool, toolName, "generalized_write_calls");
      } else if (writeClass === PRIMITIVE_CLASS) {
        counters.primitive_write_total += 1;
        this.bumpToolCounter(bucket.by_tool, toolName, "primitive_write_calls");
      }
      if (payload.dry_run === true) {
        counters.dry_run_total += 1;
        this.bumpToolCounter(bucket.by_tool, toolName, "dry_run_calls");
      }

      const patches = extractSerializedPatches(commandName, payload);
      for (const patch of patches) {
        if (!patch || typeof patch !== "object") {
          continue;
        }
        const propertyPath = sanitizePropertyPath(patch.property_path);
        if (propertyPath) {
          this.bumpFrequency(
            bucket.property_path_frequency,
            propertyPath,
            this.maxPropertyPathKeys,
            OVERFLOW_PROPERTY_PATH_KEY
          );
          counters.property_path_samples_total += 1;
        }
        const valueKind = sanitizeValueKind(patch.value_kind);
        if (valueKind) {
          this.bumpFrequency(bucket.value_kind_frequency, valueKind);
        }
        const op = sanitizeArrayOp(patch.op);
        if (op) {
          this.bumpFrequency(bucket.array_op_frequency, op);
        }
      }
    }

    this.persistSnapshot();
  }

  recordReadTokenValidation(input) {
    if (!this.enabled) {
      return;
    }
    const source = input && typeof input === "object" ? input : {};
    const ok = source.ok === true;
    const errorCode = toNonEmptyString(source.error_code);
    const message = toNonEmptyString(source.message);
    const bucket = this.getCurrentBucket();
    bucket.counters.read_token_checks_total += 1;
    if (!ok) {
      bucket.counters.read_token_fail_total += 1;
      if (isReadTokenExpiryFailure(errorCode, message)) {
        bucket.counters.read_token_expiry_total += 1;
      }
    }
    this.persistSnapshot();
  }

  recordWriteJobFinalized(input) {
    if (!this.enabled) {
      return;
    }
    const source = input && typeof input === "object" ? input : {};
    const status = toNonEmptyString(source.status).toLowerCase();
    const bucket = this.getCurrentBucket();
    bucket.counters.write_jobs_finalized_total += 1;
    if (status === "failed") {
      bucket.counters.write_jobs_failed_total += 1;
    }
    if (inferRollbackFromFinalState(source)) {
      bucket.counters.write_jobs_rollback_inferred_total += 1;
    }
    this.persistSnapshot();
  }

  getSnapshot() {
    const nowMs = this.nowMs();
    this.pruneExpiredBuckets(nowMs);
    if (!this.enabled) {
      const snapshot = buildDefaultV1PolishMetricsSnapshot({
        nowMs,
        enabled: false,
        retentionDays: this.retentionDays,
        storageMode: this.snapshotStore ? "file_snapshot" : "memory",
        storagePath: this.storagePath,
      });
      return snapshot;
    }
    return buildV1PolishMetricsSnapshot({
      nowMs,
      enabled: true,
      retentionDays: this.retentionDays,
      storageMode: this.snapshotStore ? "file_snapshot" : "memory",
      storagePath: this.storagePath,
      dailyBuckets: this.dailyBuckets,
      topN: this.topN,
    });
  }

  getPersistedState() {
    return this.buildPersistableState();
  }

  resetForTests() {
    this.dailyBuckets = {};
    this.updatedAtMs = this.nowMs();
  }

  getCurrentBucket() {
    const nowMs = this.nowMs();
    this.pruneExpiredBuckets(nowMs);
    const dayKey = toDayKey(nowMs);
    const existing = this.dailyBuckets[dayKey];
    if (existing && typeof existing === "object") {
      return existing;
    }
    const created = createEmptyBucket();
    this.dailyBuckets[dayKey] = created;
    return created;
  }

  pruneExpiredBuckets(nowMs) {
    const now = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
    const keepAfterMs = now - (this.retentionDays - 1) * 24 * 60 * 60 * 1000;
    for (const dayKey of Object.keys(this.dailyBuckets)) {
      if (!isValidDayKey(dayKey)) {
        delete this.dailyBuckets[dayKey];
        continue;
      }
      const dayMs = dayKeyToMs(dayKey);
      if (!Number.isFinite(dayMs) || dayMs < keepAfterMs) {
        delete this.dailyBuckets[dayKey];
      }
    }
  }

  bumpFrequency(map, key, maxKeys, overflowKey) {
    const target = map && typeof map === "object" ? map : null;
    const name = toNonEmptyString(key);
    if (!target || !name) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      target[name] += 1;
      return;
    }

    const hardLimit =
      Number.isFinite(Number(maxKeys)) && Number(maxKeys) > 0
        ? Math.floor(Number(maxKeys))
        : 0;
    if (hardLimit > 0 && Object.keys(target).length >= hardLimit) {
      const fallback = toNonEmptyString(overflowKey);
      if (fallback) {
        target[fallback] = (Number(target[fallback]) || 0) + 1;
      }
      return;
    }
    target[name] = 1;
  }

  bumpToolCounter(byTool, toolName, fieldName) {
    const map = byTool && typeof byTool === "object" ? byTool : null;
    const name = toNonEmptyString(toolName);
    if (!map || !name) {
      return;
    }
    if (!map[name]) {
      map[name] = {
        total: 0,
        write_calls: 0,
        dry_run_calls: 0,
        generalized_write_calls: 0,
        primitive_write_calls: 0,
      };
    }
    map[name][fieldName] = (Number(map[name][fieldName]) || 0) + 1;
  }

  buildPersistableState() {
    const nowMs = this.nowMs();
    return {
      schema_version: METRICS_SCHEMA_VERSION,
      updated_at: new Date(nowMs).toISOString(),
      enabled: this.enabled,
      retention_days: this.retentionDays,
      daily_buckets: this.dailyBuckets,
    };
  }

  persistSnapshot() {
    if (!this.snapshotStore || typeof this.snapshotStore.saveSnapshot !== "function") {
      return;
    }
    this.pruneExpiredBuckets(this.nowMs());
    this.snapshotStore.saveSnapshot(this.buildPersistableState());
  }

  restoreSnapshot() {
    if (!this.snapshotStore || typeof this.snapshotStore.loadSnapshot !== "function") {
      return;
    }
    const snapshot = this.snapshotStore.loadSnapshot();
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }
    const dailyRaw =
      snapshot.daily_buckets && typeof snapshot.daily_buckets === "object"
        ? snapshot.daily_buckets
        : {};
    const nextBuckets = {};
    for (const [dayKey, rawBucket] of Object.entries(dailyRaw)) {
      if (!isValidDayKey(dayKey)) {
        continue;
      }
      nextBuckets[dayKey] = normalizeBucket(rawBucket);
    }
    this.dailyBuckets = nextBuckets;
  }
}

module.exports = {
  V1PolishMetricsCollector,
  METRICS_SCHEMA_VERSION,
  OVERFLOW_PROPERTY_PATH_KEY,
  aggregateDailyBuckets,
  buildV1PolishMetricsSnapshot,
  buildDefaultV1PolishMetricsSnapshot,
  inferRollbackFromFinalState,
  extractSerializedPatches,
  resolveWriteClass,
};
