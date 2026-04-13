import type { SendLogEntry } from "../types.js";
import { appendSendLog, updateSendLog } from "./send-log.js";
import { generateId } from "weixin/src/util/random.js";

export interface RetrySendOptions {
  /** Max retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms before first retry (default: 1000) */
  baseDelayMs?: number;
  /** Max delay cap in ms (default: 15000) */
  maxDelayMs?: number;
}

const DEFAULT_RETRY: Required<RetrySendOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15_000,
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown, httpStatus?: number): boolean {
  if (httpStatus && httpStatus >= 500) return true;
  if (httpStatus === 429) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (err.name === "AbortError") return true;
    if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("econnrefused")) return true;
    if (msg.includes("fetch failed") || msg.includes("network")) return true;
  }
  return false;
}

export interface SendAttemptResult {
  ok: boolean;
  httpStatus?: number;
  retCode?: number;
  error?: string;
  rawBody?: string;
}

/**
 * Wrap an async send function with retry + JSONL logging.
 *
 * `sendFn` should perform the actual HTTP call and return a structured result
 * that includes httpStatus and business retCode so we can decide whether to retry.
 */
export async function sendWithRetry(
  meta: {
    toUserId: string;
    contextToken: string;
    contentType: SendLogEntry["contentType"];
    payload: string;
  },
  sendFn: () => Promise<SendAttemptResult>,
  opts?: RetrySendOptions,
): Promise<SendLogEntry> {
  const cfg = { ...DEFAULT_RETRY, ...opts };
  const logId = generateId("slog");
  const entry: SendLogEntry = {
    id: logId,
    ts: new Date().toISOString(),
    toUserId: meta.toUserId,
    contextToken: meta.contextToken,
    contentType: meta.contentType,
    payload: meta.payload,
    status: "pending",
    attempts: 0,
  };
  appendSendLog(entry);

  let lastResult: SendAttemptResult = { ok: false, error: "not attempted" };

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    entry.attempts = attempt;
    entry.status = attempt > 1 ? "retrying" : "pending";
    entry.lastAttemptTs = new Date().toISOString();

    try {
      lastResult = await sendFn();
      entry.httpStatus = lastResult.httpStatus;
      entry.retCode = lastResult.retCode;
      entry.error = lastResult.error;

      if (lastResult.ok) {
        entry.status = "sent";
        updateSendLog(logId, entry);
        return entry;
      }

      // Business-level errors that should NOT be retried
      if (lastResult.retCode === -14) {
        entry.status = "failed";
        entry.error = "Session expired (ret=-14)";
        updateSendLog(logId, entry);
        return entry;
      }
      if (lastResult.retCode === -2) {
        entry.status = "failed";
        entry.error = "Invalid parameter (ret=-2)";
        updateSendLog(logId, entry);
        return entry;
      }

      if (!isRetryable(null, lastResult.httpStatus) && attempt < cfg.maxAttempts) {
        entry.status = "failed";
        updateSendLog(logId, entry);
        return entry;
      }
    } catch (err) {
      lastResult = { ok: false, error: (err as Error).message };
      entry.error = lastResult.error;

      if (!isRetryable(err) && attempt < cfg.maxAttempts) {
        entry.status = "failed";
        updateSendLog(logId, entry);
        return entry;
      }
    }

    if (attempt < cfg.maxAttempts) {
      const delayMs = Math.min(cfg.baseDelayMs * 2 ** (attempt - 1), cfg.maxDelayMs);
      console.log(`[send-retry] attempt ${attempt}/${cfg.maxAttempts} failed, retrying in ${delayMs}ms...`);
      updateSendLog(logId, { ...entry, status: "retrying" });
      await delay(delayMs);
    }
  }

  entry.status = "failed";
  updateSendLog(logId, entry);
  return entry;
}

/**
 * Resend a previously failed message. Caller provides the original entry
 * and a fresh sendFn (with possibly updated context token).
 */
export async function resendEntry(
  original: SendLogEntry,
  sendFn: () => Promise<SendAttemptResult>,
  opts?: RetrySendOptions,
): Promise<SendLogEntry> {
  return sendWithRetry(
    {
      toUserId: original.toUserId,
      contextToken: original.contextToken,
      contentType: original.contentType,
      payload: original.payload,
    },
    sendFn,
    opts,
  );
}
