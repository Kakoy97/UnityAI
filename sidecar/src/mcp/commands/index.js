"use strict";

const { materializeCommandManifest } = require("./_shared/commandManifest");
const {
  MCP_COMMAND_DEFINITIONS: LEGACY_COMMAND_MANIFEST,
} = require("./legacyCommandManifest");

const MCP_COMMAND_DEFINITIONS = materializeCommandManifest(
  LEGACY_COMMAND_MANIFEST
);

module.exports = {
  MCP_COMMAND_DEFINITIONS,
};

