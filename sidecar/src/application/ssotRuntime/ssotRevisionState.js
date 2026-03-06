"use strict";

const { SSOT_UNKNOWN_SCENE_REVISION } = require("./tokenContract");

const REVISION_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

let ssotRevisionStateSingleton = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compareSceneRevision(nextRevision, currentRevision) {
  if (nextRevision === currentRevision) {
    return 0;
  }
  return REVISION_COLLATOR.compare(nextRevision, currentRevision);
}

class SsotRevisionState {
  constructor(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    this.nowMs =
      typeof opts.nowMs === "function" ? opts.nowMs : () => Date.now();
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date(this.nowMs()).toISOString();
    this.latestKnownSceneRevision = "";
    this.latestUpdateMeta = null;
  }

  getLatestKnownSceneRevision() {
    return this.latestKnownSceneRevision;
  }

  getLatestStateSnapshot() {
    return {
      latest_known_scene_revision: this.latestKnownSceneRevision,
      latest_update_meta:
        this.latestUpdateMeta && typeof this.latestUpdateMeta === "object"
          ? { ...this.latestUpdateMeta }
          : null,
    };
  }

  updateLatestKnownSceneRevision(newRevision, metadata = {}) {
    const normalizedRevision = normalizeString(newRevision);
    if (
      !normalizedRevision ||
      normalizedRevision === SSOT_UNKNOWN_SCENE_REVISION
    ) {
      return {
        ok: false,
        updated: false,
        reason: "invalid_revision",
        latest_known_scene_revision: this.latestKnownSceneRevision,
      };
    }

    const currentRevision = this.latestKnownSceneRevision;
    if (currentRevision) {
      const compare = compareSceneRevision(normalizedRevision, currentRevision);
      if (compare <= 0) {
        if (compare < 0) {
          console.warn(
            `[ssotRevisionState] drop stale scene_revision '${normalizedRevision}' (current='${currentRevision}')`
          );
        }
        return {
          ok: true,
          updated: false,
          reason: compare === 0 ? "duplicate_revision" : "stale_revision",
          latest_known_scene_revision: currentRevision,
          ignored_scene_revision: normalizedRevision,
        };
      }
    }

    const nowMs = this.nowMs();
    const source =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata
        : {};
    this.latestKnownSceneRevision = normalizedRevision;
    this.latestUpdateMeta = {
      updated_at: this.nowIso(),
      updated_at_ms: nowMs,
      source_tool_name: normalizeString(source.source_tool_name),
      source_query_type: normalizeString(source.source_query_type),
      source_request_id: normalizeString(source.source_request_id),
      source_thread_id: normalizeString(source.source_thread_id),
      source_turn_id: normalizeString(source.source_turn_id),
    };

    return {
      ok: true,
      updated: true,
      reason: "updated",
      latest_known_scene_revision: this.latestKnownSceneRevision,
      latest_update_meta: { ...this.latestUpdateMeta },
    };
  }

  clearForTests() {
    this.latestKnownSceneRevision = "";
    this.latestUpdateMeta = null;
  }
}

function getSsotRevisionStateSingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return new SsotRevisionState(options);
  }
  if (!ssotRevisionStateSingleton) {
    ssotRevisionStateSingleton = new SsotRevisionState();
  }
  return ssotRevisionStateSingleton;
}

function resetSsotRevisionStateSingletonForTests() {
  ssotRevisionStateSingleton = null;
}

module.exports = {
  SsotRevisionState,
  getSsotRevisionStateSingleton,
  resetSsotRevisionStateSingletonForTests,
  compareSceneRevision,
};
