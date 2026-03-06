"use strict";

function fallbackSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetSceneSnapshotForWrite =
    typeof source.validateGetSceneSnapshotForWrite === "function"
      ? source.validateGetSceneSnapshotForWrite
      : null;
  const getSsotInputSchemaForTool =
    typeof source.getSsotInputSchemaForTool === "function"
      ? source.getSsotInputSchemaForTool
      : null;

  return {
    name: "get_scene_snapshot_for_write",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_scene_snapshot_for_write",
      source: "body",
    },
    turnServiceMethod: "getSceneSnapshotForWriteForMcp",
    validate: validateGetSceneSnapshotForWrite,
    mcp: {
      expose: true,
      description:
        "Return scene roots summary and a write-token candidate from the SSOT isolated query pipeline.",
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_scene_snapshot_for_write")
        : fallbackSchema(),
    },
  };
};
