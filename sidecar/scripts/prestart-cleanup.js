"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const LISTEN_PORT = 46321;

function normalize(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .toLowerCase();
}

function runPowerShell(command) {
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8" }
  );
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function readNodeProcesses() {
  const command =
    "$items = Get-CimInstance Win32_Process -Filter \"name='node.exe'\" " +
    "| Select-Object ProcessId,CommandLine; " +
    "$items | ConvertTo-Json -Compress";
  const result = runPowerShell(command);
  if (result.status !== 0) {
    throw new Error(
      `Failed to query Node processes: ${result.stderr || result.stdout}`.trim()
    );
  }
  const raw = String(result.stdout || "").trim();
  if (!raw) {
    return [];
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse process list JSON: ${error.message}`);
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object") {
    return [parsed];
  }
  return [];
}

function isStaleSidecarProcess(processInfo) {
  if (!processInfo || typeof processInfo !== "object") {
    return false;
  }

  const pid = Number(processInfo.ProcessId);
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) {
    return false;
  }

  const commandLine = normalize(processInfo.CommandLine);
  if (!commandLine) {
    return false;
  }

  const sidecarRoot = normalize(SIDECAR_ROOT);
  if (!commandLine.includes(sidecarRoot)) {
    return false;
  }

  const isSidecarIndex = commandLine.includes(
    normalize(path.join(SIDECAR_ROOT, "index.js"))
  );

  return isSidecarIndex;
}

function stopProcess(pid) {
  const safePid = Number(pid);
  if (!Number.isFinite(safePid) || safePid <= 0) {
    return false;
  }
  const command = `Stop-Process -Id ${safePid} -Force -ErrorAction SilentlyContinue`;
  const result = runPowerShell(command);
  return result.status === 0;
}

function readPortListeners(port) {
  const safePort = Number(port);
  if (!Number.isFinite(safePort) || safePort <= 0) {
    return [];
  }
  const command = `netstat -ano | findstr LISTENING | findstr :${safePort}`;
  const result = runPowerShell(command);
  const output = String(result.stdout || "").trim();
  if (!output) {
    return [];
  }
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const listeners = [];
  for (const line of lines) {
    const cols = line.split(/\s+/);
    if (cols.length < 5) {
      continue;
    }
    const localAddress = cols[1] || "";
    const state = cols[3] || "";
    const pidText = cols[4] || "";
    const pid = Number(pidText);
    if (!localAddress.endsWith(`:${safePort}`)) {
      continue;
    }
    if (state.toUpperCase() !== "LISTENING") {
      continue;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
      continue;
    }
    listeners.push(pid);
  }
  return Array.from(new Set(listeners));
}

function main() {
  const processes = readNodeProcesses();
  const stale = processes.filter(isStaleSidecarProcess);
  if (stale.length <= 0) {
    console.log("[prestart] no stale sidecar node processes found.");
  } else {
    for (const item of stale) {
      const pid = Number(item.ProcessId);
      const commandLine = String(item.CommandLine || "").trim();
      const stopped = stopProcess(pid);
      console.log(
        `[prestart] ${stopped ? "stopped" : "failed"} pid=${pid} cmd=${commandLine}`
      );
    }
  }

  const listenersBefore = readPortListeners(LISTEN_PORT);
  const aliveBefore = listenersBefore.filter((pid) => pid !== process.pid);
  for (const pid of aliveBefore) {
    const stopped = stopProcess(pid);
    console.log(
      `[prestart] ${
        stopped ? "stopped" : "failed"
      } listener pid=${pid} on port ${LISTEN_PORT}`
    );
  }

  const listenersAfter = readPortListeners(LISTEN_PORT);
  const aliveListeners = listenersAfter.filter((pid) => pid !== process.pid);
  if (aliveListeners.length > 0) {
    throw new Error(
      `Port ${LISTEN_PORT} is still occupied by pid(s): ${aliveListeners.join(
        ", "
      )}.`
    );
  }
  console.log(`[prestart] port ${LISTEN_PORT} is ready.`);
}

try {
  main();
} catch (error) {
  const message =
    error && typeof error.message === "string" ? error.message : String(error);
  console.error(`[prestart] cleanup failed: ${message}`);
  process.exit(1);
}
