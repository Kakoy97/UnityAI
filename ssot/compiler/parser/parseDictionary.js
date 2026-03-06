"use strict";

const { parseSimpleYaml } = require("./simpleYamlParser");

function parseJson(raw, sourceLabel) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON dictionary at ${sourceLabel}: ${error.message}`);
  }
}

function parseDictionary(filePayload) {
  const source = filePayload && typeof filePayload === "object" ? filePayload : {};
  const ext = typeof source.ext === "string" ? source.ext.toLowerCase() : "";
  if (ext === ".json") {
    return parseJson(source.raw, source.absolutePath || "<unknown>");
  }
  if (ext === ".yaml" || ext === ".yml") {
    try {
      return parseSimpleYaml(source.raw);
    } catch (error) {
      throw new Error(
        `Invalid YAML dictionary at ${source.absolutePath || "<unknown>"}: ${error.message}`
      );
    }
  }
  throw new Error(`Unsupported dictionary extension: ${ext || "<none>"}`);
}

module.exports = {
  parseDictionary,
};
