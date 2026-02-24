"use strict";

class FakeUnityQueryPlanner {
  /**
   * @param {{ targetPath?: string, mode?: string, keepComponentShortName?: string, ignoreComponents?: string[] }} [options]
   */
  constructor(options) {
    const opts = options && typeof options === "object" ? options : {};
    this.targetPath =
      typeof opts.targetPath === "string" && opts.targetPath.trim()
        ? opts.targetPath.trim()
        : "Scene/Canvas/Image";
    this.mode =
      typeof opts.mode === "string" && opts.mode.trim()
        ? opts.mode.trim().toLowerCase()
        : "chat_only";
    this.keepComponentShortName =
      typeof opts.keepComponentShortName === "string" &&
      opts.keepComponentShortName.trim()
        ? opts.keepComponentShortName.trim()
        : "KeepComponent";
    this.ignoreComponentSet = new Set(
      Array.isArray(opts.ignoreComponents) && opts.ignoreComponents.length > 0
        ? opts.ignoreComponents
            .filter((item) => typeof item === "string" && item.trim())
            .map((item) => item.trim())
        : ["Transform", "RectTransform"]
    );
    this.enabled = true;
  }

  /**
   * @param {{
   *  queryUnityComponents?: (arg: { targetPath: string }) => Promise<{ components?: Array<{ short_name: string, assembly_qualified_name: string }>, error_code?: string, error_message?: string }>,
   *  signal?: AbortSignal
   * }} input
   */
  async planTurn(input) {
    const targetPath = this.targetPath;
    const queryUnityComponents =
      input && typeof input.queryUnityComponents === "function"
        ? input.queryUnityComponents
        : null;
    let probeResult = {
      components: [],
      error_code: "query_bridge_missing",
      error_message: "query_unity_components bridge is not configured",
    };

    if (queryUnityComponents) {
      try {
        const value = await queryUnityComponents({ targetPath });
        probeResult = normalizeProbeResult(value);
      } catch (error) {
        probeResult = {
          components: [],
          error_code: "query_bridge_failed",
          error_message:
            error && typeof error.message === "string"
              ? error.message
              : "query_unity_components bridge failed",
        };
      }
    }

    const componentCount = Array.isArray(probeResult.components)
      ? probeResult.components.length
      : 0;
    const summary = probeResult.error_code
      ? `Probe ${probeResult.error_code}: ${probeResult.error_message || "no details"}`
      : `Probe OK: ${componentCount} component(s)`;
    const visualActions = this.buildVisualActionsFromProbe(probeResult);
    const actionSummary =
      visualActions.length > 0
        ? ` Generated ${visualActions.length} remove_component action(s).`
        : " No file or visual actions should be executed.";

    return {
      assistant_text: `[fake-query-planner] ${summary}`,
      task_allocation: {
        reasoning_and_plan:
          `Smoke planner probe target=${targetPath}. ${summary}.` +
          actionSummary,
        file_actions: [],
        visual_layer_actions: visualActions,
      },
    };
  }

  /**
   * @returns {Promise<string>}
   */
  async finalizeTurn() {
    return "";
  }

  recordExecutionMemory() {
    // no-op for smoke planner
  }

  async close() {
    // no-op for smoke planner
  }

  buildVisualActionsFromProbe(probeResult) {
    if (this.mode !== "remove_except_keep") {
      return [];
    }
    if (probeResult.error_code) {
      return [];
    }
    const components = Array.isArray(probeResult.components)
      ? probeResult.components
      : [];
    const actions = [];
    for (const item of components) {
      const shortName =
        item && typeof item.short_name === "string" ? item.short_name.trim() : "";
      if (!shortName) {
        continue;
      }
      if (shortName === this.keepComponentShortName) {
        continue;
      }
      if (this.ignoreComponentSet.has(shortName)) {
        continue;
      }
      actions.push({
        type: "remove_component",
        target: "selection",
        target_object_path: this.targetPath,
        component_name: shortName,
      });
    }
    return actions;
  }
}

function normalizeProbeResult(value) {
  const raw = value && typeof value === "object" ? value : {};
  const components = Array.isArray(raw.components)
    ? raw.components
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          short_name:
            typeof item.short_name === "string" ? item.short_name.trim() : "",
          assembly_qualified_name:
            typeof item.assembly_qualified_name === "string"
              ? item.assembly_qualified_name.trim()
              : "",
        }))
        .filter((item) => item.short_name && item.assembly_qualified_name)
    : [];
  const errorCode =
    typeof raw.error_code === "string" ? raw.error_code.trim() : "";
  const errorMessage =
    typeof raw.error_message === "string" ? raw.error_message.trim() : "";
  return {
    components,
    error_code: errorCode,
    error_message: errorMessage,
  };
}

module.exports = {
  FakeUnityQueryPlanner,
};
