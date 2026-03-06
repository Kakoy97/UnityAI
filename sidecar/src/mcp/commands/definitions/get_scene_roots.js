"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetSceneRoots =
    typeof source.validateGetSceneRoots === "function"
      ? source.validateGetSceneRoots
      : null;
  const getSsotInputSchemaForTool =
    typeof source.getSsotInputSchemaForTool === "function"
      ? source.getSsotInputSchemaForTool
      : null;
  const getSsotToolDescriptionForTool =
    typeof source.getSsotToolDescriptionForTool === "function"
      ? source.getSsotToolDescriptionForTool
      : null;
  const fallbackDescription =
    "Read root GameObjects from loaded scenes and return explicit anchors via SSOT isolated query pipeline.";

  return {
    name: "get_scene_roots",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_scene_roots", source: "body" },
    turnServiceMethod: "getSceneRootsForMcp",
    validate: validateGetSceneRoots,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_scene_roots", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_scene_roots")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
