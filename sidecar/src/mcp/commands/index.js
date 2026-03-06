"use strict";

const { materializeCommandManifest } = require("./_shared/commandManifest");
const {
  MCP_COMMAND_DEFINITIONS: COMMAND_DEFINITION_MANIFEST,
} = require("./commandDefinitionManifest");

const MCP_COMMAND_DEFINITIONS = materializeCommandManifest(
  COMMAND_DEFINITION_MANIFEST
);

module.exports = {
  MCP_COMMAND_DEFINITIONS,
};
