"use strict";

const fs = require("fs");
const path = require("path");

class FileStateSnapshotStore {
  /**
   * @param {{ filePath: string }} options
   */
  constructor(options) {
    this.filePath = options.filePath;
  }

  loadSnapshot() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      if (!raw) {
        return null;
      }
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  saveSnapshot(snapshot) {
    try {
      const directory = path.dirname(this.filePath);
      fs.mkdirSync(directory, { recursive: true });
      const tempPath = this.filePath + ".tmp";
      const json = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(tempPath, json, { encoding: "utf8" });
      fs.renameSync(tempPath, this.filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  FileStateSnapshotStore,
};

