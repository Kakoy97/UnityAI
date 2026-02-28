"use strict";

/**
 * ResponseCacheService handles caching of session and file action receipts.
 * This service manages TTL-based caching for response receipts to avoid duplicate processing.
 */
class ResponseCacheService {
  /**
   * @param {{
   *   sessionCacheTtlMs?: number,
   * }} deps
   */
  constructor(deps) {
    const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;
    this.sessionCacheTtlMs =
      Number(deps.sessionCacheTtlMs) > 0
        ? Number(deps.sessionCacheTtlMs)
        : SESSION_CACHE_TTL_MS;

    /** @type {Map<string, {statusCode: number, body: Record<string, unknown>, expiresAt: number}>} */
    this.sessionReceiptByRequestId = new Map();
    /** @type {Map<string, {statusCode: number, body: Record<string, unknown>, expiresAt: number}>} */
    this.fileActionReceiptByRequestId = new Map();
  }

  getSessionReceipt(requestId) {
    if (!requestId) {
      return null;
    }
    const entry = this.sessionReceiptByRequestId.get(requestId);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.sessionReceiptByRequestId.delete(requestId);
      return null;
    }
    return entry;
  }

  cleanupSessionCache() {
    const now = Date.now();
    for (const [requestId, entry] of this.sessionReceiptByRequestId.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.sessionReceiptByRequestId.delete(requestId);
      }
    }
  }

  cacheSessionReceipt(requestId, statusCode, body) {
    this.sessionReceiptByRequestId.set(requestId, {
      statusCode,
      body,
      expiresAt: Date.now() + this.sessionCacheTtlMs,
    });
  }

  cacheFileActionReceipt(requestId, statusCode, body) {
    this.fileActionReceiptByRequestId.set(requestId, {
      statusCode,
      body,
      expiresAt: Date.now() + this.sessionCacheTtlMs,
    });
  }

  getFileActionReceipt(requestId) {
    if (!requestId) {
      return null;
    }
    const entry = this.fileActionReceiptByRequestId.get(requestId);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.fileActionReceiptByRequestId.delete(requestId);
      return null;
    }
    return entry;
  }

  cleanupFileActionCache() {
    const now = Date.now();
    for (const [requestId, entry] of this.fileActionReceiptByRequestId.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.fileActionReceiptByRequestId.delete(requestId);
      }
    }
  }
}

module.exports = { ResponseCacheService };
