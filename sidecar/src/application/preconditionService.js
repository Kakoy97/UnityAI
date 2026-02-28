"use strict";

const {
  resolveSnapshotTarget,
  mapTargetResolveReasonToPreconditionReason,
} = require("../utils/turnUtils");

/**
 * PreconditionService handles precondition evaluation for split MCP write APIs.
 * Phase 6 contract: preconditions use target_anchor only (object_id + path).
 */
class PreconditionService {
  /**
   * @param {{
   *   turnStore: import("../domain/turnStore").TurnStore,
   *   unitySnapshotService: import("./unitySnapshotService").UnitySnapshotService,
   * }} deps
   */
  constructor(deps) {
    this.turnStore = deps.turnStore;
    this.unitySnapshotService = deps.unitySnapshotService;
    this.mcpGateway = deps.mcpGateway || null;
    this.isCompilePendingResolver =
      typeof deps.isCompilePending === "function" ? deps.isCompilePending : null;
  }

  evaluateWritePreconditions(preconditions) {
    const list = Array.isArray(preconditions) ? preconditions : [];
    if (list.length === 0) {
      return {
        ok: true,
        total: 0,
        passed: 0,
        failed: 0,
        checks: [],
      };
    }

    const checks = [];
    const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
    for (let i = 0; i < list.length; i += 1) {
      const raw = list[i];
      const item = raw && typeof raw === "object" ? raw : {};
      const type = typeof item.type === "string" ? item.type.trim() : "";
      if (type === "compile_idle") {
        const pass = !this.isCompilePendingNow();
        checks.push({
          index: i,
          type,
          pass,
          reason: pass ? "" : "compile_pending",
        });
        continue;
      }

      const resolvedTarget = this.resolvePreconditionTarget(item, snapshot);
      if (!resolvedTarget.ok) {
        checks.push({
          index: i,
          type,
          pass: false,
          reason: resolvedTarget.reason || "target_missing",
          error_code: resolvedTarget.error_code || "",
        });
        continue;
      }
      const targetPath = resolvedTarget.target_path;
      const targetObjectId = resolvedTarget.target_object_id;

      if (type === "object_exists") {
        checks.push({
          index: i,
          type,
          target_object_id: targetObjectId || "",
          target_path: targetPath,
          pass: true,
          reason: "",
        });
        continue;
      }

      if (type === "component_exists") {
        const expectedComponentRaw =
          typeof item.component === "string" && item.component.trim()
            ? item.component.trim()
            : typeof item.component_name === "string" && item.component_name.trim()
              ? item.component_name.trim()
              : typeof item.component_assembly_qualified_name === "string" &&
                  item.component_assembly_qualified_name.trim()
                ? item.component_assembly_qualified_name.trim()
                : "";
        const components = this.unitySnapshotService.readSelectionComponentsForPath(
          targetPath,
          snapshot
        );
        const hasComponent = this.unitySnapshotService.matchComponentInList(
          components,
          expectedComponentRaw
        );
        checks.push({
          index: i,
          type,
          target_object_id: targetObjectId || "",
          target_path: targetPath,
          component: expectedComponentRaw,
          pass: hasComponent,
          reason: hasComponent ? "" : "component_not_found",
        });
        continue;
      }

      checks.push({
        index: i,
        type,
        pass: false,
        reason: "unsupported_type",
      });
    }

    const failedChecks = checks.filter((item) => item && item.pass !== true);
    return {
      ok: failedChecks.length === 0,
      total: checks.length,
      passed: checks.length - failedChecks.length,
      failed: failedChecks.length,
      checks,
    };
  }

  isCompilePendingNow() {
    if (typeof this.isCompilePendingResolver === "function") {
      try {
        return this.isCompilePendingResolver() === true;
      } catch {
        // ignore resolver errors and fallback to local checks
      }
    }

    if (this.mcpGateway && typeof this.mcpGateway.getRunningJob === "function") {
      const runningJob = this.mcpGateway.getRunningJob();
      if (
        runningJob &&
        runningJob.status === "pending" &&
        runningJob.stage === "compile_pending"
      ) {
        return true;
      }
    }

    if (
      !this.turnStore ||
      typeof this.turnStore.getActiveRequestId !== "function" ||
      typeof this.turnStore.getTurn !== "function"
    ) {
      return false;
    }

    const activeRequestId = this.turnStore.getActiveRequestId() || "";
    if (!activeRequestId) {
      return false;
    }
    const activeTurn = this.turnStore.getTurn(activeRequestId);
    return !!(
      activeTurn &&
      activeTurn.state === "running" &&
      activeTurn.stage === "compile_pending"
    );
  }

  resolvePreconditionTarget(item, snapshot) {
    const obj = item && typeof item === "object" ? item : {};
    const targetAnchor =
      obj.target_anchor && typeof obj.target_anchor === "object"
        ? obj.target_anchor
        : null;
    if (!targetAnchor) {
      return {
        ok: false,
        reason: "target_missing",
        error_code: "E_SCHEMA_INVALID",
      };
    }

    const resolved = resolveSnapshotTarget(
      snapshot,
      {
        target_anchor: targetAnchor,
      },
      {
        allowSelectionFallback: false,
        requireInTree: false,
        requireInComponentIndex: false,
      }
    );
    if (!resolved.ok) {
      return {
        ok: false,
        reason: mapTargetResolveReasonToPreconditionReason(resolved.errorCode),
        error_code: resolved.errorCode || "E_TARGET_NOT_FOUND",
      };
    }
    return {
      ok: true,
      target_object_id: resolved.targetObjectId || "",
      target_path: resolved.targetPath || "",
    };
  }
}

module.exports = { PreconditionService };
