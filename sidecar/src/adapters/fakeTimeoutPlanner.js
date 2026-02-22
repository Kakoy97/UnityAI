"use strict";

class FakeTimeoutPlanner {
  constructor() {
    this.enabled = true;
  }

  /**
   * @param {{ signal?: AbortSignal }} input
   * @returns {Promise<any>}
   */
  async planTurn(input) {
    return waitUntilAbort(input && input.signal, "fake timeout planner aborted");
  }

  /**
   * @param {{ signal?: AbortSignal }} input
   * @returns {Promise<string>}
   */
  async finalizeTurn(input) {
    await waitUntilAbort(
      input && input.signal,
      "fake timeout finalize planner aborted"
    );
    return "";
  }

  recordExecutionMemory() {
    // no-op for timeout planner.
  }

  async close() {
    // no-op for timeout planner.
  }
}

function waitUntilAbort(signal, message) {
  return new Promise((resolve, reject) => {
    if (!signal) {
      // Keep pending forever in this testing-only planner.
      return;
    }
    if (signal.aborted) {
      reject(new Error(message || "aborted"));
      return;
    }
    const onAbort = () => {
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {
        // ignore remove listener errors
      }
      reject(new Error(message || "aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

module.exports = {
  FakeTimeoutPlanner,
};

