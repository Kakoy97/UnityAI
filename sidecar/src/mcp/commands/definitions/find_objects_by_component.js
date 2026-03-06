"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateFindObjectsByComponent =
    typeof source.validateFindObjectsByComponent === "function"
      ? source.validateFindObjectsByComponent
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
    "Find scene objects by component query and return explicit anchors via SSOT isolated query pipeline.";

  return {
    name: "find_objects_by_component",
    kind: "read",
    lifecycle: "stable",
    http: {
      method: "POST",
      path: "/mcp/find_objects_by_component",
      source: "body",
    },
    turnServiceMethod: "findObjectsByComponentForMcp",
    validate: validateFindObjectsByComponent,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("find_objects_by_component", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("find_objects_by_component")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
