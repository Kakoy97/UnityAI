"use strict";

const fs = require("fs");
const path = require("path");

class FileActionExecutor {
  /**
   * @param {{
   *  workspaceRoot: string,
   *  allowedWriteRoots: string[],
   *  forbiddenWriteRoots: string[],
   *  maxFileBytes: number
   * }} options
   */
  constructor(options) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.allowedWriteRoots = (options.allowedWriteRoots || [])
      .map(normalizeRoot)
      .filter(Boolean);
    this.forbiddenWriteRoots = (options.forbiddenWriteRoots || [])
      .map(normalizeRoot)
      .filter(Boolean);
    this.maxFileBytes = Number(options.maxFileBytes) > 0
      ? Number(options.maxFileBytes)
      : 102400;
  }

  /**
   * @param {Array<{
   *  type: string,
   *  path?: string,
   *  content?: string,
   *  overwrite_if_exists?: boolean,
   *  old_path?: string,
   *  new_path?: string
   * }>} actions
   */
  execute(actions) {
    /** @type {Array<{type: string, path: string}>} */
    const changes = [];

    for (const action of actions) {
      if (!action || typeof action !== "object") {
        return this.error("E_SCHEMA_INVALID", "file action must be an object", changes);
      }

      const actionType = String(action.type || "").trim();
      if (
        actionType !== "create_file" &&
        actionType !== "update_file" &&
        actionType !== "rename_file" &&
        actionType !== "delete_file"
      ) {
        return this.error("E_SCHEMA_INVALID", `Unsupported file action: ${actionType}`, changes);
      }

      if (actionType === "rename_file") {
        const normalizedOldPath = this.normalizeAndValidatePath(action.old_path);
        if (!normalizedOldPath.ok) {
          return this.error(
            normalizedOldPath.errorCode,
            normalizedOldPath.message,
            changes
          );
        }
        const normalizedNewPath = this.normalizeAndValidatePath(action.new_path);
        if (!normalizedNewPath.ok) {
          return this.error(
            normalizedNewPath.errorCode,
            normalizedNewPath.message,
            changes
          );
        }
        const oldRelativePath = normalizedOldPath.relativePath;
        const newRelativePath = normalizedNewPath.relativePath;
        if (!this.isAllowedPath(oldRelativePath) || !this.isAllowedPath(newRelativePath)) {
          return this.error(
            "E_FILE_PATH_FORBIDDEN",
            `Path is not allowed: ${oldRelativePath} -> ${newRelativePath}`,
            changes
          );
        }
        if (this.isForbiddenPath(oldRelativePath) || this.isForbiddenPath(newRelativePath)) {
          return this.error(
            "E_FILE_PATH_FORBIDDEN",
            `Path is forbidden: ${oldRelativePath} -> ${newRelativePath}`,
            changes
          );
        }

        const oldAbsolutePath = path.resolve(this.workspaceRoot, oldRelativePath);
        const newAbsolutePath = path.resolve(this.workspaceRoot, newRelativePath);
        const allowRenameOverwrite = action.overwrite_if_exists === true;
        if (!fs.existsSync(oldAbsolutePath)) {
          return this.error(
            "E_FILE_NOT_FOUND",
            `rename_file source does not exist: ${oldRelativePath}`,
            changes
          );
        }
        if (fs.existsSync(newAbsolutePath) && !allowRenameOverwrite) {
          return this.error(
            "E_FILE_EXISTS_BLOCKED",
            `rename_file target already exists: ${newRelativePath}`,
            changes
          );
        }

        try {
          fs.mkdirSync(path.dirname(newAbsolutePath), { recursive: true });
          if (allowRenameOverwrite && fs.existsSync(newAbsolutePath)) {
            fs.rmSync(newAbsolutePath, { force: false });
          }
          fs.renameSync(oldAbsolutePath, newAbsolutePath);
        } catch (error) {
          return this.error(
            "E_FILE_WRITE_FAILED",
            error instanceof Error ? error.message : String(error),
            changes
          );
        }

        changes.push({
          type: actionType,
          path: `${oldRelativePath} -> ${newRelativePath}`.replace(/\\/g, "/"),
        });
        continue;
      }

      const normalizedPath = this.normalizeAndValidatePath(action.path);
      if (!normalizedPath.ok) {
        return this.error(normalizedPath.errorCode, normalizedPath.message, changes);
      }
      const relativePath = normalizedPath.relativePath;

      if (!this.isAllowedPath(relativePath)) {
        return this.error(
          "E_FILE_PATH_FORBIDDEN",
          `Path is not allowed: ${relativePath}`,
          changes
        );
      }
      if (this.isForbiddenPath(relativePath)) {
        return this.error(
          "E_FILE_PATH_FORBIDDEN",
          `Path is forbidden: ${relativePath}`,
          changes
        );
      }

      const absolutePath = path.resolve(this.workspaceRoot, relativePath);
      const exists = fs.existsSync(absolutePath);

      if (actionType === "delete_file") {
        if (!exists) {
          return this.error(
            "E_FILE_NOT_FOUND",
            `delete_file target does not exist: ${relativePath}`,
            changes
          );
        }
        try {
          fs.rmSync(absolutePath, { force: false });
        } catch (error) {
          return this.error(
            "E_FILE_WRITE_FAILED",
            error instanceof Error ? error.message : String(error),
            changes
          );
        }
        changes.push({
          type: actionType,
          path: relativePath.replace(/\\/g, "/"),
        });
        continue;
      }

      if (exists && action.overwrite_if_exists === false) {
        return this.error(
          "E_FILE_EXISTS_BLOCKED",
          `File already exists and overwrite is false: ${relativePath}`,
          changes
        );
      }
      if (actionType === "update_file" && !exists) {
        return this.error(
          "E_FILE_NOT_FOUND",
          `update_file target does not exist: ${relativePath}`,
          changes
        );
      }

      const normalizedContent = normalizeLineEndings(action.content);
      const byteSize = Buffer.byteLength(normalizedContent, "utf8");
      if (byteSize > this.maxFileBytes) {
        return this.error(
          "E_FILE_SIZE_EXCEEDED",
          `File exceeds max size ${this.maxFileBytes} bytes: ${relativePath}`,
          changes
        );
      }

      try {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, normalizedContent, { encoding: "utf8" });
      } catch (error) {
        return this.error(
          "E_FILE_WRITE_FAILED",
          error instanceof Error ? error.message : String(error),
          changes
        );
      }

      changes.push({
        type: actionType,
        path: relativePath.replace(/\\/g, "/"),
      });
    }

    return {
      ok: true,
      changes,
    };
  }

  normalizeAndValidatePath(inputPath) {
    if (typeof inputPath !== "string" || !inputPath.trim()) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "file path is required",
      };
    }

    const unixPath = inputPath.replace(/\\/g, "/").trim();
    if (unixPath.startsWith("/") || /^[A-Za-z]:\//.test(unixPath)) {
      return {
        ok: false,
        errorCode: "E_FILE_PATH_FORBIDDEN",
        message: "absolute paths are not allowed",
      };
    }

    const safeRelative = path.posix.normalize(unixPath);
    if (safeRelative === "." || safeRelative.startsWith("../") || safeRelative.includes("/../")) {
      return {
        ok: false,
        errorCode: "E_FILE_PATH_FORBIDDEN",
        message: "path traversal is not allowed",
      };
    }

    const absolutePath = path.resolve(this.workspaceRoot, safeRelative);
    const workspacePrefix = this.workspaceRoot.endsWith(path.sep)
      ? this.workspaceRoot
      : this.workspaceRoot + path.sep;
    if (!(absolutePath + path.sep).startsWith(workspacePrefix) && absolutePath !== this.workspaceRoot) {
      return {
        ok: false,
        errorCode: "E_FILE_PATH_FORBIDDEN",
        message: "resolved path escapes workspace root",
      };
    }

    return {
      ok: true,
      relativePath: safeRelative.replace(/\\/g, "/"),
    };
  }

  isAllowedPath(relativePath) {
    if (this.allowedWriteRoots.length === 0) {
      return false;
    }
    return this.allowedWriteRoots.some((root) => startsWithRoot(relativePath, root));
  }

  isForbiddenPath(relativePath) {
    return this.forbiddenWriteRoots.some((root) => startsWithRoot(relativePath, root));
  }

  error(errorCode, message, changes) {
    return {
      ok: false,
      errorCode,
      message,
      changes: Array.isArray(changes) ? changes : [],
    };
  }
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

module.exports = {
  FileActionExecutor,
};
