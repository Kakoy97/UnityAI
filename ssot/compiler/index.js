#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readDictionaryFile } = require("./io/readDictionaryFile");
const { validateDictionaryShape } = require("./parser/validateDictionaryShape");
const { parseDictionary } = require("./parser/parseDictionary");
const { applyMixins } = require("./parser/applyMixins");
const { normalizeEnums } = require("./parser/normalizeEnums");
const { expandBusinessOnlyExamples } = require("./examples/expandBusinessOnlyExamples");
const { emitMcpToolsJson } = require("./emitters/l2/emitMcpToolsJson");
const { emitAjvSchemas } = require("./emitters/l2/emitAjvSchemas");
const {
  emitSidecarCommandManifest,
} = require("./emitters/l2/emitSidecarCommandManifest");
const {
  emitVisibilityPolicyManifest,
} = require("./emitters/l2/emitVisibilityPolicyManifest");
const {
  emitTokenPolicyManifest,
} = require("./emitters/l2/emitTokenPolicyManifest");
const { emitDtosCs } = require("./emitters/l3/emitDtosCs");
const { emitBindingsCs } = require("./emitters/l3/emitBindingsCs");
const {
  emitDispatcherBindingsCs,
} = require("./emitters/l3/emitDispatcherBindingsCs");
const { writeArtifacts } = require("./io/writeArtifacts");

function parseArgs(argv) {
  const args = {
    dictionaryPath: path.resolve(__dirname, "../dictionary/tools.json"),
    outDir: path.resolve(__dirname, "../artifacts"),
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dictionary" && argv[i + 1]) {
      args.dictionaryPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--out-dir" && argv[i + 1]) {
      args.outDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function buildArtifacts(ssot) {
  const sidecarCommandManifest = emitSidecarCommandManifest(ssot);
  const visibilityPolicyManifest = emitVisibilityPolicyManifest(
    ssot,
    sidecarCommandManifest
  );
  const tokenPolicyManifest = emitTokenPolicyManifest(ssot, sidecarCommandManifest);
  return {
    "l2/mcp-tools.generated.json": JSON.stringify(emitMcpToolsJson(ssot), null, 2) + "\n",
    "l2/ajv-schemas.generated.json": JSON.stringify(emitAjvSchemas(ssot), null, 2) + "\n",
    "l2/sidecar-command-manifest.generated.json":
      JSON.stringify(sidecarCommandManifest, null, 2) + "\n",
    "l2/visibility-policy.generated.json":
      JSON.stringify(visibilityPolicyManifest, null, 2) + "\n",
    "l2/token-policy.generated.json":
      JSON.stringify(tokenPolicyManifest, null, 2) + "\n",
    "l3/SsotDtos.generated.cs": emitDtosCs(ssot),
    "l3/SsotBindings.generated.cs": emitBindingsCs(ssot),
    "l3/SsotDispatchBindings.generated.cs": emitDispatcherBindingsCs(ssot),
  };
}

function syncUnityGeneratedL3(artifacts) {
  const source = artifacts && typeof artifacts === "object" ? artifacts : {};
  const unityTargetDir = path.resolve(
    __dirname,
    "../../Assets/Editor/Codex/Generated/Ssot"
  );
  fs.mkdirSync(unityTargetDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(source)) {
    if (!String(relativePath).startsWith("l3/")) {
      continue;
    }
    const fileName = path.basename(relativePath);
    const targetPath = path.resolve(unityTargetDir, fileName);
    fs.writeFileSync(targetPath, content, "utf8");
  }
}

function compile(options) {
  const dictionaryFile = readDictionaryFile(options.dictionaryPath);
  const parsed = parseDictionary(dictionaryFile);
  validateDictionaryShape(parsed);
  const withMixins = applyMixins(parsed);
  const normalized = normalizeEnums(withMixins);
  const expanded = expandBusinessOnlyExamples(normalized);
  const artifacts = buildArtifacts(expanded);
  if (options.dryRun) {
    return { ok: true, artifacts };
  }
  writeArtifacts(options.outDir, artifacts);
  syncUnityGeneratedL3(artifacts);
  return { ok: true, artifacts };
}

function main() {
  const options = parseArgs(process.argv);
  const result = compile(options);
  const files = Object.keys(result.artifacts);
  // eslint-disable-next-line no-console
  console.log(
    `[ssot] compiled dictionary=${options.dictionaryPath} out=${options.outDir} files=${files.length} dry_run=${options.dryRun}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ssot] compile failed:", error && error.message ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  compile,
  parseArgs,
};
