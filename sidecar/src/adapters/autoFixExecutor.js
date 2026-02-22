"use strict";

const fs = require("fs");
const path = require("path");

class AutoFixExecutor {
  /**
   * @param {{
   *  workspaceRoot: string,
   *  allowedWriteRoots: string[],
   *  maxFileBytes: number
   * }} options
   */
  constructor(options) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.allowedWriteRoots = (options.allowedWriteRoots || [])
      .map(normalizeRoot)
      .filter(Boolean);
    this.maxFileBytes = Number(options.maxFileBytes) > 0
      ? Number(options.maxFileBytes)
      : 102400;
  }

  /**
   * @param {Array<{file?: string}>} errors
   */
  attemptCompileFix(errors, dryRun) {
    const fileCandidates = collectCandidateFiles(errors);
    /** @type {Array<{type: string, path: string}>} */
    const changes = [];
    const isDryRun = dryRun === true;

    for (const candidate of fileCandidates) {
      const normalized = this.normalizePath(candidate);
      if (!normalized.ok) {
        continue;
      }

      const relativePath = normalized.relativePath;
      if (!this.isAllowedPath(relativePath)) {
        continue;
      }

      const absolutePath = path.resolve(this.workspaceRoot, relativePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      let beforeContent = "";
      try {
        beforeContent = fs.readFileSync(absolutePath, "utf8");
      } catch {
        continue;
      }

      const fixResult = tryFixEscapedScriptFile(beforeContent);
      if (!fixResult.changed) {
        continue;
      }

      const byteSize = Buffer.byteLength(fixResult.content, "utf8");
      if (byteSize > this.maxFileBytes) {
        return {
          ok: false,
          errorCode: "E_FILE_SIZE_EXCEEDED",
          message: `Auto-fix output exceeds ${this.maxFileBytes} bytes: ${relativePath}`,
          changes,
        };
      }

      if (!isDryRun) {
        try {
          fs.writeFileSync(absolutePath, fixResult.content, { encoding: "utf8" });
        } catch (error) {
          return {
            ok: false,
            errorCode: "E_FILE_WRITE_FAILED",
            message: error instanceof Error ? error.message : String(error),
            changes,
          };
        }
      }

      changes.push({
        type: "update_file",
        path: relativePath,
      });
    }

    if (changes.length === 0) {
      return {
        ok: false,
        errorCode: "E_AUTO_FIX_UNAVAILABLE",
        message: "No compile auto-fix rule matched current errors.",
        changes,
      };
    }

    return {
      ok: true,
      reason: "normalized_escaped_script_content",
      changes,
    };
  }

  /**
   * @param {{type?: string, target?: string, component_assembly_qualified_name?: string}} pendingAction
   * @param {{error_code?: string}} actionPayload
   */
  attemptActionFix(pendingAction, actionPayload) {
    if (!pendingAction || pendingAction.type !== "add_component") {
      return {
        ok: false,
        errorCode: "E_AUTO_FIX_UNAVAILABLE",
        message: "No pending add_component action to auto-fix.",
      };
    }

    const errorCode =
      actionPayload && typeof actionPayload.error_code === "string"
        ? actionPayload.error_code.trim()
        : "";
    const currentAqn = pendingAction.component_assembly_qualified_name || "";

    if (
      errorCode === "E_ACTION_COMPONENT_RESOLVE_FAILED" ||
      errorCode === "E_ACTION_EXECUTION_FAILED"
    ) {
      const normalizedAqn = normalizeComponentAssemblyQualifiedName(currentAqn);
      if (normalizedAqn && normalizedAqn !== currentAqn) {
        return {
          ok: true,
          reason: "normalized_component_assembly_name",
          patchedAction: {
            ...pendingAction,
            component_assembly_qualified_name: normalizedAqn,
          },
        };
      }
    }

    if (errorCode === "E_ACTION_EXECUTION_FAILED") {
      return {
        ok: true,
        reason: "retry_same_action_once",
        patchedAction: {
          ...pendingAction,
        },
      };
    }

    return {
      ok: false,
      errorCode: "E_AUTO_FIX_UNAVAILABLE",
      message: "No action auto-fix rule matched current error.",
    };
  }

  isAllowedPath(relativePath) {
    if (this.allowedWriteRoots.length === 0) {
      return false;
    }
    return this.allowedWriteRoots.some((root) => startsWithRoot(relativePath, root));
  }

  normalizePath(inputPath) {
    if (typeof inputPath !== "string" || !inputPath.trim()) {
      return {
        ok: false,
      };
    }

    const unixPath = inputPath.replace(/\\/g, "/").trim();
    let relativePath = "";

    if (/^[A-Za-z]:\//.test(unixPath)) {
      const absolutePath = path.resolve(unixPath);
      const workspacePrefix = this.workspaceRoot.endsWith(path.sep)
        ? this.workspaceRoot
        : this.workspaceRoot + path.sep;
      if (!(absolutePath + path.sep).startsWith(workspacePrefix) && absolutePath !== this.workspaceRoot) {
        return { ok: false };
      }
      relativePath = path.relative(this.workspaceRoot, absolutePath).replace(/\\/g, "/");
    } else {
      if (unixPath.startsWith("/")) {
        return { ok: false };
      }
      relativePath = path.posix.normalize(unixPath);
    }

    if (!relativePath || relativePath === "." || relativePath.startsWith("../") || relativePath.includes("/../")) {
      return { ok: false };
    }

    return {
      ok: true,
      relativePath,
    };
  }
}

function collectCandidateFiles(errors) {
  if (!Array.isArray(errors)) {
    return [];
  }

  const unique = new Set();
  for (const item of errors) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (typeof item.file !== "string" || !item.file.trim()) {
      continue;
    }
    unique.add(item.file.trim());
  }
  return Array.from(unique.values());
}

function tryFixEscapedScriptFile(content) {
  if (typeof content !== "string" || !content) {
    return {
      changed: false,
      content: content || "",
    };
  }

  const escapedNewlineCount = countMatches(content, /\\n/g);
  if (escapedNewlineCount < 2) {
    return {
      changed: false,
      content,
    };
  }

  const realNewlineCount = countMatches(content, /\n/g);
  const looksEscapedScript =
    realNewlineCount <= 2 || escapedNewlineCount > realNewlineCount * 2;

  if (!looksEscapedScript) {
    return {
      changed: false,
      content,
    };
  }

  let next = content;
  next = next.replace(/\\r\\n/g, "\n");
  next = next.replace(/\\n/g, "\n");
  next = next.replace(/\\"/g, "\"");
  next = next.replace(/\\t/g, "    ");
  next = normalizeLineEndings(next);

  if (next === content) {
    return {
      changed: false,
      content,
    };
  }

  return {
    changed: true,
    content: next,
  };
}

function normalizeComponentAssemblyQualifiedName(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const raw = value.trim();
  const commaIndex = raw.indexOf(",");
  if (commaIndex < 0) {
    return `${raw}, Assembly-CSharp`;
  }

  const typeName = raw.substring(0, commaIndex).trim();
  if (!typeName) {
    return raw;
  }
  if (raw.includes("Assembly-CSharp")) {
    return raw;
  }
  return `${typeName}, Assembly-CSharp`;
}

function normalizeLineEndings(content) {
  return String(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeRoot(root) {
  if (!root || typeof root !== "string") {
    return "";
  }
  const normalized = root.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : normalized + "/";
}

function startsWithRoot(relativePath, root) {
  const pathValue = relativePath.replace(/\\/g, "/");
  if (pathValue === root.slice(0, -1)) {
    return true;
  }
  return pathValue.startsWith(root);
}

function countMatches(content, regex) {
  const matches = content.match(regex);
  return Array.isArray(matches) ? matches.length : 0;
}

module.exports = {
  AutoFixExecutor,
};
